# **Lemni Core Engine: Technical Architecture & System Specification**

This document details the deterministic, highly resilient backend infrastructure for the Lemni Payment-as-a-Service (PaaS) engine. The system is designed to handle edge-case transaction failures, enforce ACID compliance across distributed billing states, and provide a seamless API boundary for integrating merchants.

## **1\. Global Infrastructure & Stack**

* **Framework:** NestJS (Node.js/TypeScript). Enforces strict dependency injection and modular boundaries, essential for isolating third-party provider failures.  
* **Database:** Turso (libSQL). Operating at the edge, providing ultra-low latency relational data storage. Connected via Drizzle ORM (using `@libsql/client`) to enforce strict schema validation and database actions.  
* **Queue Engine:** BullMQ backed by Redis (Upstash/Render free tier). Handles distributed task scheduling, delayed retries, and rate-limiting.  
* **Hosting Deployment:** Render Web Services.  
* **Contingency (Keep-Alive):** To bypass Render's 15-minute idle sleep on free tiers, an external cron service (e.g., UptimeRobot or GitHub Actions) will ping a lightweight GET /health endpoint every 10 minutes. This guarantees BullMQ workers and internal cron schedules never freeze.

## **2\. Module Segregation (NestJS Architecture)**

The backend is strictly decoupled into distinct operational domains.

### **A. AuthModule (Security & Access Control)**

* **API Key Strategy:** Guards developer-facing endpoints (/subscribe, /pay). Validates the Authorization: Bearer \<API\_KEY\> header. API keys are stored in Turso as bcrypt/Argon2 hashes; merchants only see the raw key once upon generation.  
* **JWT Strategy:** Guards the Merchant Dashboard (/admin/\*) endpoints, maintaining short-lived session states for no-code users.

### **B. CheckoutModule (The API Boundary)**

Exposes the entry points for developers. It does not process payments; it securely marshals data and generates hosted sessions.

* POST /api/v1/pay: For one-time transactions. Directly calls ProviderModule to generate a Nomba checkoutLink and returns a session\_id.  
* POST /api/v1/subscribe: For recurring setups. Accepts either a pre-configured plan\_id or dynamic interval data. Returns a secure checkout session URL.

### **C. ProviderModule (Nomba Integration & Circuit Breaker)**

The *only* module permitted to execute outbound HTTP calls to Nomba.

* **Nomba API Client:** Wraps POST /v1/checkout/order and POST /v1/checkout/tokenized-card-payment.  
* **Idempotency Engine:** Injects a unique, deterministic uuid into the header of every recurring charge request. If a network timeout occurs and the request is retried, Nomba's gateway recognizes the idempotency key and prevents double-charging.  
* **Circuit Breaker:** If the Nomba API returns 5xx errors consistently, this module trips the breaker and signals the SchedulerModule to halt queue processing.

### **D. BillingModule (State Machine & Logic)**

Manages the lifecycle of Plans, Subscriptions, and Customers.

* **Proration Engine:** Calculates exact pro-rata differences when users upgrade/downgrade mid-cycle.  
* **Grace Period Logic:** Evaluates subscription.next\_billing\_date against the merchant's configured grace period (e.g., \+3 days) to determine when a user transitions from active to past\_due.

### **E. SchedulerModule (BullMQ & Redis Workers)**

The asynchronous heart of the engine.

* **BillingWorker:** Wakes up every hour, queries Turso for subscriptions where next\_billing\_date \<= NOW(), and pushes jobs into the ChargeQueue.  
* **DunningWorker:** Processes failed charges. Implements exponential backoff or heuristic scheduling (e.g., shifting the next retry to 9:00 AM WAT the following day). If the max retries are hit, it triggers the lock-out webhook.  
* **HealthCron:** Pings Nomba's health endpoint. If down, it executes queue.pause(). When restored, it executes queue.resume().

### **F. WebhookModule (Inbound/Outbound Event Bus)**

* **Inbound (POST /api/v1/webhooks/nomba):** Verifies Nomba webhook signatures. Updates the local transaction state to success or failed.  
* **Outbound Dispatcher:** Pushes JSON payloads to the merchant's registered webhook\_url (e.g., informing BananaFitness to lock a user out).  
* **Notification Service:** Formats critical alerts and pushes them asynchronously to the merchant's Telegram Chat ID or WhatsApp API.

## **3\. Database Schema (Turso Relational Design)**

| Table | Core Columns | Relationships |
| :---- | :---- | :---- |
| **Merchants** | id, name, email, webhook\_url, telegram\_chat\_id | 1:N with API\_Keys, Plans, Customers |
| **API\_Keys** | id, merchant\_id, hashed\_key, environment (test/live), is\_active | Belongs to Merchant |
| **Customers** | id, merchant\_id, email, nomba\_token, metadata (JSON) | 1:N with Subscriptions |
| **Plans** | id, merchant\_id, name, amount, billing\_model (recurring/one\_time/custom\_input), interval (weekly/monthly/yearly/null), trial\_days, trial\_require\_card (boolean), grace\_period\_days (integer) | 1:N with Subscriptions |
| **Subscriptions** | id, customer\_id, plan\_id, status (trialing, active, past\_due, canceled), current\_period\_end, trial\_end | Belongs to Customer, Plan |
| **Transactions** | id, subscription\_id, amount, status (pending, success, failed), nomba\_ref | Log of all charge attempts |

## **4\. The Dunning Execution Flow (Unhappy Path)**

1. **Trigger:** BillingWorker attempts to charge a tokenized card via ProviderModule.  
2. **Failure:** Nomba returns insufficient\_funds.  
3. **State Update:** Transaction is marked failed. Subscription status becomes past\_due (if grace period allows) or canceled.  
4. **Queue Injection:** The job is pushed to the DunningQueue with a delay parameter: delay: calculateNextOptimalRetryTime().  
5. **Alerts Fired:** WebhookModule dispatches a subscription.past\_due event to BananaFitness, and a Telegram alert to the merchant: *"Charge failed for \[Customer Name\]. Retrying tomorrow."*  
6. **Resolution Loop:**  
   * *If success on retry:* Status returns to active, next billing date rolls forward.  
   * *If max retries exceeded:* Subscription is hard-canceled, final webhooks are fired, and the job is dropped into a Dead Letter Queue (DLQ).

## **5\. Security & Scale Considerations**

* **Session Polling vs. Webhooks:** To lower the barrier to entry, developers can optionally hit GET /api/v1/sessions/:session\_id/status. This prevents them from needing a public webhook URL just to verify a one-time /pay transaction.  
* **Idempotency Logging:** Every outbound request to Nomba is logged locally with its idempotency key before dispatch. In the event of a total container crash mid-request, the system checks the log on reboot to determine if the key was already transmitted, preventing blind re-executions.

