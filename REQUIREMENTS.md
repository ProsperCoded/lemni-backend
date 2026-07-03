# Lemni Core Engine - Implementation Requirements Checklist

This document outlines the sequential, step-by-step implementation tasks for the Lemni Core Engine. Tasks are ordered strictly by dependency, ensuring that database schemas, core providers, and authorization systems are built before routing, queueing, and webhook dispatching layers are introduced.

---

## 1. FOUNDATIONAL INFRASTRUCTURE & DATABASE CONFIGURATION
- [ ] **1.1. Environment Configuration & NestJS Configuration Setup**
  - Define all required environment variables in a `.env.example` file (including Turso/libSQL credentials, Nomba credentials, Upstash Redis URL, API Key hash salt, Telegram/WhatsApp configurations).
  - Setup NestJS `ConfigModule` and a strongly-typed configuration service.
- [ ] **1.2. Database & TypeORM Setup with Turso/libSQL**
  - Install dependencies for Turso (libSQL) driver and TypeORM (`@libsql/client`, `typeorm`, `@nestjs/typeorm`).
  - Configure TypeORM module to connect to the Turso database.
  - Setup CLI configuration for migrations (using `pnpm typeorm migration:generate` and `pnpm typeorm migration:run`).
- [ ] **1.3. Database Entities Implementation**
  - Implement TypeORM database entities reflecting the relational schema:
    - `Merchant` (id, name, email, webhook_url, telegram_chat_id)
    - `ApiKey` (id, merchant_id, hashed_key, environment [test/live], is_active)
    - `Customer` (id, merchant_id, email, nomba_token, metadata [JSON])
    - `Plan` (id, merchant_id, name, amount, interval [weekly, monthly, yearly], trial_days)
    - `Subscription` (id, customer_id, plan_id, status [active, past_due, canceled], current_period_end)
    - `Transaction` (id, subscription_id, amount, status [pending, success, failed], nomba_ref)
- [ ] **1.4. Initial Database Migration**
  - Generate the initial schema migration using TypeORM CLI.
  - Run the migration using the CLI to initialize the database tables in Turso.

---

## 2. SECURITY & AUTHENTICATION (AuthModule)
- [ ] **2.1. API Key Generation & Hashing Logic**
  - Build service method to generate a cryptographically secure random API key.
  - Implement bcrypt/Argon2 hashing for storing keys securely in the `ApiKey` table.
- [ ] **2.2. API Key Authentication Guard**
  - Implement `ApiKeyGuard` validating the `Authorization: Bearer <API_KEY>` header against hashed database records.
  - Enforce check for the `environment` (test/live) and `is_active` status of the key.
- [ ] **2.3. JWT Authentication Guard**
  - Configure JWT module and strategy for merchant dashboard administrative endpoints (`/admin/*`).
  - Implement `JwtAuthGuard` protecting these administrative endpoints.

---

## 3. EXTERNAL GATEWAY INTEGRATION (ProviderModule)
- [ ] **3.1. Nomba API Client Implementation**
  - Implement `NombaClient` wrapping the outward HTTP calls to:
    - `POST /v1/checkout/order` (generate checkout links)
    - `POST /v1/checkout/tokenized-card-payment` (charge saved cards)
  - Ensure outbound requests log the request and response payloads, especially status codes and failure reasons.
- [ ] **3.2. Idempotency Engine**
  - Build an idempotency service that generates and persists a unique, deterministic UUID in a local log before making any charging requests to Nomba.
  - Add logic to verify if the key was already transmitted in case of an app crash/retry.
- [ ] **3.3. Circuit Breaker Pattern**
  - Implement a circuit breaker mechanism that monitors Nomba API failures (5xx responses).
  - If failure threshold is reached, trip the breaker and broadcast a signal to `SchedulerModule` to halt active worker queues.

---

## 4. BILLING & DOMAIN LOGIC (BillingModule)
- [ ] **4.1. Customer & Plan Management Service**
  - Build services to register customers, tokenise card links (storing `nomba_token`), and create/manage plans.
- [ ] **4.2. Proration Engine**
  - Implement calculations for mid-cycle plan upgrades and downgrades.
  - Compute exact pro-rata differences and output adjusting invoice items or charge amounts.
- [ ] **4.3. Grace Period Logic**
  - Write evaluator comparing `subscription.next_billing_date` plus configured grace period (+X days) to mark subscriptions as `past_due` or `canceled`.

---

## 5. API BOUNDARY (CheckoutModule)
- [ ] **5.1. One-Time Payment Endpoint (`POST /api/v1/pay`)**
  - Implement route to accept payload for one-time payments.
  - Invoke `ProviderModule` to request a Nomba checkoutLink.
  - Return a unique `session_id` and checkout URL to the merchant.
- [ ] **5.2. Recurring Subscription Endpoint (`POST /api/v1/subscribe`)**
  - Implement route accepting a pre-configured `plan_id` or dynamic interval data.
  - Create a pending Subscription and Transaction in the database.
  - Return a checkout session URL.
- [ ] **5.3. Session Status Polling Endpoint (`GET /api/v1/sessions/:session_id/status`)**
  - Provide an endpoint to fetch the status of a specific checkout session so frontend applications can poll for success/failure.

---

## 6. ASYNCHRONOUS SCHEDULING (SchedulerModule)
- [ ] **6.1. Redis & BullMQ Integration**
  - Establish connection configurations to Upstash Redis.
  - Initialize the Redis client and BullMQ dashboard/module in NestJS.
- [ ] **6.2. BillingWorker (Hourly Cron)**
  - Implement worker querying Turso hourly for subscriptions where `next_billing_date <= NOW()`.
  - Push matching jobs into the `ChargeQueue`.
- [ ] **6.3. DunningWorker (Failure Retries & Queue)**
  - Implement queue worker executing failed charge attempts.
  - Implement exponential backoff or WAT 9:00 AM heuristic retry scheduling.
  - Drop jobs into Dead Letter Queue (DLQ) if max retries are exceeded.
- [ ] **6.4. HealthCron & Queue Management**
  - Regularly ping Nomba health endpoint.
  - Pause the `ChargeQueue` if Nomba returns error states (circuit breaker tripped) and resume when online.

---

## 7. WEBHOOKS & NOTIFICATIONS (WebhookModule)
- [ ] **7.1. Inbound Webhook Handler (`POST /api/v1/webhooks/nomba`)**
  - Implement webhook receiver to verify Nomba signature headers.
  - Match webhook event payload (success/failed payment) to the corresponding `Transaction` and update state.
  - Update `Subscription` status (e.g. roll forward `next_billing_date` on success).
- [ ] **7.2. Outbound Webhook Dispatcher**
  - Build dispatch queue to send signed webhook payloads to the merchant's `webhook_url`.
  - Handle retries with backoff for merchant webhook endpoints that fail.
- [ ] **7.3. Merchant Notification Service**
  - Implement Telegram/WhatsApp API integrations to send alert notifications (e.g., *"Charge failed for [Customer]. Retrying tomorrow."*).

---

## 8. OBSERVABILITY, TESTING & DEPLOYMENT
- [ ] **8.1. Health Endpoint (`GET /health`)**
  - Expose a lightweight endpoint returning system health and current database connection status.
- [ ] **8.2. Integration & End-to-End Tests**
  - Implement route-to-database integration tests covering:
    - API authentication guards.
    - One-time checkout creation.
    - Recurring subscription billing worker execution.
    - Dunning retry execution loop.
