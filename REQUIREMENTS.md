# Lemni Core Engine - Implementation Requirements Checklist

This document outlines the sequential, step-by-step implementation tasks for the Lemni Core Engine. Tasks are ordered strictly by dependency, ensuring that database schemas, core providers, and authorization systems are built before routing, queueing, and webhook dispatching layers are introduced.

---

## 1. FOUNDATIONAL INFRASTRUCTURE & DATABASE CONFIGURATION
- [ ] **1.1. Environment Configuration & NestJS Configuration Setup**
  - Define all required environment variables in a `.env.example` file (including Turso/libSQL credentials, Nomba credentials [NOMBA_MODE, NOMBA_MAIN_ACCOUNT_ID, NOMBA_SUB_ACCOUNT_ID, NOMBA_LIVE_CLIENT_ID, NOMBA_LIVE_CLIENT_SECRET, NOMBA_TEST_CLIENT_ID, NOMBA_TEST_CLIENT_SECRET], Upstash Redis URL, API Key hash salt, Telegram Bot Token and Chat ID configurations).
  - Setup NestJS `ConfigModule` and a strongly-typed configuration service.
- [x] **1.2. Database & Drizzle Setup with Turso/libSQL**
  - Use Drizzle ORM dependencies (`drizzle-orm`, `@libsql/client`) and dev dependencies (`drizzle-kit`).
  - Configure Drizzle provider module in NestJS to establish connection to the Turso database using the `@libsql/client`.
  - Configure `drizzle.config.ts` specifying the Turso database URL, authToken, and schema paths.
- [x] **1.3. Database Schema Implementation**
  - Implement Drizzle schema definitions (`drizzle-orm/sqlite-core` or specific libSQL features) reflecting the relational design:
    - `merchants` (id, name, email, webhook_url, telegram_chat_id)
    - `api_keys` (id, merchant_id, hashed_key, environment [test/live], is_active)
    - `customers` (id, merchant_id, email, nomba_token, metadata [JSON])
    - `plans` (id, merchant_id, name, amount, billing_model [recurring/one_time/custom_input], interval [weekly/monthly/yearly/null], trial_days, trial_require_card [boolean], grace_period_days [integer])
    - `subscriptions` (id, customer_id, plan_id, status [trialing, active, past_due, canceled], current_period_end, trial_end)
    - `transactions` (id, subscription_id, amount, status [pending, success, failed], nomba_ref)
- [x] **1.4. Initial Database Migration**
  - Generate the initial schema migration using Drizzle Kit (`pnpm drizzle-kit generate` or `pnpm drizzle-kit push` for testing, but prefer generating migrations to follow agent rules).
  - Apply the migration using Drizzle Kit CLI or database driver migration runner (`pnpm drizzle-kit migrate`).

---

## 2. SECURITY & AUTHENTICATION (AuthModule)
- [x] **2.1. API Key Generation & Hashing Logic**
  - Build service method to generate a cryptographically secure random API key.
  - Implement bcrypt/Argon2 hashing for storing keys securely in the `ApiKey` table.
- [x] **2.2. API Key Authentication Guard**
  - Implement `ApiKeyGuard` validating the `Authorization: Bearer <API_KEY>` header against hashed database records.
  - Enforce check for the `environment` (test/live) and `is_active` status of the key.
  - **Unhappy paths:**
    - Missing `Authorization` header → return `401 Unauthorized` with `MISSING_API_KEY` code.
    - Key not found in DB or hash mismatch → return `401 Unauthorized` with `INVALID_API_KEY` code.
    - Key found but `is_active = false` (revoked) → return `403 Forbidden` with `REVOKED_API_KEY` code.
    - Key environment mismatch (e.g. live key against test route) → return `403 Forbidden` with `ENVIRONMENT_MISMATCH` code.
- [x] **2.3. JWT Authentication Guard**
  - Configure JWT module and strategy for merchant dashboard administrative endpoints (`/admin/*`).
  - Implement `JwtAuthGuard` protecting these administrative endpoints.
  - **Unhappy paths:**
    - Expired JWT → return `401 Unauthorized` with `TOKEN_EXPIRED` code.
    - Tampered/invalid JWT signature → return `401 Unauthorized` with `INVALID_TOKEN` code.
- [x] **2.4. API Key Revocation Endpoint**
  - Implement `DELETE /admin/api-keys/:id` to set `is_active = false` for a given key.
  - Ensure in-flight requests with that key are rejected by the guard immediately (stateless check on every request).

---

## 3. EXTERNAL GATEWAY INTEGRATION (ProviderModule)
- [x] **3.1. Nomba API Client Implementation**
  - Implement `NombaClient` wrapping the outward HTTP calls to Nomba.
  - Dynamically configure the base URL using `NOMBA_MODE` (if `live` -> `https://api.nomba.com`, else -> `https://sandbox.nomba.com`).
  - Resolve authentication credentials dynamically:
    - If `NOMBA_MODE` is `live`, exchange `NOMBA_LIVE_CLIENT_ID` and `NOMBA_LIVE_CLIENT_SECRET` for an `access_token`.
    - Otherwise (e.g. `sandbox`), exchange `NOMBA_TEST_CLIENT_ID` and `NOMBA_TEST_CLIENT_SECRET` for an `access_token`.
  - Ensure all outbound requests to Nomba endpoints (e.g. `POST /v1/checkout/order` and `POST /v1/checkout/tokenized-card-payment`) include the headers:
    - `Authorization: Bearer <access_token>`
    - `accountId: <NOMBA_MAIN_ACCOUNT_ID>` (Parent Account ID)
  - Ensure all calls (like checkout links or tokenized card payment orders) are scoped to the sub-account ID by including `<NOMBA_SUB_ACCOUNT_ID>` (e.g., mapping to the relevant sub-account parameter in the request payload or endpoint config as required by Nomba's API).
  - Ensure outbound requests log the request and response payloads, especially status codes and failure reasons.
  - **Unhappy paths:**
    - Nomba `4xx` (e.g. `invalid_token`, `card_expired`, `insufficient_funds`) → classify as **non-retryable** failure; mark `Transaction` as `failed`, do NOT re-enqueue to `ChargeQueue`, push to `DunningQueue` only if `grace_period_days > 0`.
    - Nomba `5xx` or network timeout → classify as **retryable** failure; re-enqueue with exponential backoff without immediately marking the subscription as `past_due`.
    - Nomba auth token expired → transparently refresh the Nomba access token by requesting a new one and retry once before surfacing the error.
    - Checkout link generation fails (Nomba 4xx on `POST /v1/checkout/order`) → return `502 Bad Gateway` to the caller; do NOT create a `Transaction` record.
- [x] **3.2. Idempotent Transaction Pattern**
  - Implement idempotency checks leveraging the `Transaction` table directly. Use `transaction.id` as the unique reference and idempotency key when communicating with Nomba.
  - Store the request payload and payment response metadata in the `payload` and `response` columns of the corresponding `Transaction` record.
  - **Unhappy paths:**
    - Duplicate charge attempt / duplicate BullMQ job delivery → check if the `Transaction` status is already `success` or `failed`. If so, skip the attempt and return the cached transaction details.
    - Container crash mid-request → on reboot, query the local `Transaction` table directly for `pending` rows and resolve state from there before deciding to retry (no external Nomba status reconciliation call).
- [x] **3.3. Circuit Breaker Pattern**
  - Implement a circuit breaker mechanism that monitors Nomba API failures (5xx responses).
  - If failure threshold is reached, trip the breaker and broadcast a signal to `SchedulerModule` to halt active worker queues.
  - **Unhappy paths:**
    - Breaker trips while a batch of jobs is mid-flight → jobs already dequeued must be re-queued with a delay so they are not lost.
    - Breaker stays open for an extended period → emit a `provider.outage` event via WebhookModule to notify all affected merchants.

---

## 4. BILLING & DOMAIN LOGIC (BillingModule)
- [x] **4.1. Customer & Plan Management Service**
  - Build services to register customers, tokenise card links (storing `nomba_token`), and create/manage plans.
  - **Unhappy paths:**
    - Customer attempts to subscribe to a plan that belongs to a different merchant → return `403 Forbidden`.
    - Plan is deleted/archived while a customer is actively subscribed → block deletion; require merchant to migrate or cancel affected subscriptions first.
    - Duplicate customer registration (same email under same merchant) → return `409 Conflict` and surface the existing customer record.
    - `nomba_token` tokenisation fails (e.g. card declined during setup) → do NOT create a subscription; return a descriptive error so the frontend can prompt the user to retry with a different card.
- [x] **4.2. Proration Engine**
  - Implement calculations for mid-cycle plan upgrades and downgrades.
  - Compute exact pro-rata differences and output adjusting invoice items or charge amounts.
  - **Unhappy paths:**
    - Upgrade/downgrade attempted when subscription is `past_due` or `canceled` → reject with `409 Conflict`; merchant must resolve the outstanding balance first.
    - Plan amount changes after prorated charge is already computed but before it is applied → lock the proration snapshot at calculation time; do not re-compute mid-transaction.
    - Custom-input billing model: merchant provides no amount at charge time → reject the charge job and notify via webhook with `custom_amount_missing` error.
- [x] **4.3. Grace Period & Trial Logic**
  - Write evaluator comparing `subscription.next_billing_date` plus the plan's custom configured `grace_period_days` to transition a subscription to `past_due` and eventually `canceled`.
  - Handle trial period expiration transitions:
    - `trial_require_card = true`: card token is already captured; immediately promote subscription to `active` and enqueue first charge.
    - `trial_require_card = false`: no card on file at trial end; set status to `past_due`, dispatch `trial.ended_no_card` webhook, and send merchant Telegram alert. Cancel after grace period if still no card.
  - **Unhappy paths:**
    - `trial_days = 0` and `trial_require_card = true` → treat as immediate paid subscription; skip trial state entirely.
    - BillingWorker misses a scheduled trial-end window (e.g. service outage) → on next hourly run, catch all `trialing` subscriptions where `trial_end < NOW()` and process them retroactively without resetting dates.
- [x] **4.4. Subscription Reactivation**
  - Allow merchant to reactivate a `canceled` subscription for a customer.
  - Reset billing period to start from reactivation date; do not carry forward old dunning retry counters.
  - **Unhappy paths:**
    - Customer's `nomba_token` has expired since cancellation → require re-tokenisation before reactivation.
    - Plan the subscription was on is archived → block reactivation; merchant must assign a new active plan.

---

## 5. API BOUNDARY (CheckoutModule)

### Checkout Architecture Overview

**Key Principle:** Lemni does NOT build a custom payment form. Nomba provides the hosted checkout UI. Lemni orchestrates checkout sessions and manages state transitions via webhooks.

**Two Checkout Flows:**

1. **Developer API Flow** (authenticated via API Key)
   - Developer calls `POST /api/v1/pay` or `POST /api/v1/subscribe` with email + amount/planId
   - Lemni creates a session (transaction/subscription record)
   - Lemni calls Nomba's API to generate a checkout URL
   - Lemni returns the checkout URL to the developer
   - Developer's frontend redirects the customer to Nomba's hosted checkout page
   - Customer enters card details on Nomba's page (we never see the card)
   - Nomba webhooks us with `payment_success` or `payment_failed`
   - Lemni updates the session state

2. **Public Plan Link Flow** (unauthenticated, merchant-shareable)
   - Merchant creates a public plan (e.g., a recurring subscription plan)
   - Merchant shares a shareable link (e.g., `https://merchant-app.com/checkout?plan=plan-abc`)
   - Customer lands on the merchant's page and sees a form: "Enter your email to proceed"
   - Customer enters their email and clicks "Pay"
   - Merchant's frontend calls `POST /api/v1/checkout/plans/:planId/sessions` with the customer's email
   - Lemni creates a session (subscription + transaction record)
   - Lemni calls Nomba's API to generate a checkout URL
   - Lemni returns the checkout URL to the merchant's frontend
   - Merchant's frontend redirects the customer to Nomba's hosted checkout page
   - Customer enters card details on Nomba's page (we never see the card)
   - Nomba webhooks us with `payment_success` or `payment_failed`
   - Lemni updates the session state

**Critical Constraint:** Nomba requires an email address for all checkout sessions. Email must be captured either by the developer (API flow) or the merchant's frontend (public plan flow) — we do not generate anonymous checkout URLs.

---

- [x] **5.1. One-Time Payment Endpoint (`POST /api/v1/pay`) — Developer API Flow**
  - **Purpose:** Developers call this to initiate a one-time charge on behalf of a customer.
  - **Auth:** Requires valid API Key (Bearer token) in `Authorization` header.
  - **Request payload:** `{ amount: number, email: string, callbackUrl?: string }`
  - **Developer responsibility:** Collect the customer's email on the developer's frontend, then POST to this endpoint.
  - **What Lemni does:**
    1. Create a customer record if it doesn't exist (keyed by email + merchant)
    2. Create a pending `Transaction` record
    3. Call Nomba's `POST /v1/checkout/order` API with the email and amount
    4. Return `{ sessionId, checkoutUrl }` to the developer
  - **Developer next step:** Redirect the customer to the `checkoutUrl` (Nomba's hosted checkout page).
  - **Return:** `{ sessionId: string, checkoutUrl: string }`
  - **Unhappy paths:**
    - Invalid or missing required fields (amount, email) → return `400 Bad Request` with field-level validation errors before hitting Nomba.
    - Missing or invalid API Key → return `401 Unauthorized`
    - Nomba checkout link generation fails → return `502 Bad Gateway`; do NOT persist a `Transaction` record.
    - Duplicate `sessionId` collision (extremely unlikely but must be handled) → regenerate and retry up to 3 times before returning `500`.

- [x] **5.2. Recurring Subscription Endpoint (`POST /api/v1/subscribe`) — Developer API Flow**
  - **Purpose:** Developers call this to initiate a recurring subscription on behalf of a customer.
  - **Auth:** Requires valid API Key (Bearer token) in `Authorization` header.
  - **Request payload:** `{ planId: string, email: string, callbackUrl?: string }`
  - **Developer responsibility:** Collect the customer's email on the developer's frontend, then POST to this endpoint.
  - **What Lemni does:**
    1. Look up the plan by ID; confirm it belongs to the authenticated merchant
    2. Create a customer record if it doesn't exist (keyed by email + merchant)
    3. Create a pending `Subscription` record (status: `trialing` if `plan.trialDays > 0`, else `active`)
    4. Create a pending `Transaction` record
    5. Call Nomba's `POST /v1/checkout/order` API with the email and plan amount
    6. Return `{ sessionId, subscriptionId, checkoutUrl }` to the developer
  - **Developer next step:** Redirect the customer to the `checkoutUrl` (Nomba's hosted checkout page).
  - **Return:** `{ sessionId: string, subscriptionId: string, checkoutUrl: string }`
  - **Unhappy paths:**
    - Missing or invalid API Key → return `401 Unauthorized`
    - `planId` not found or does not belong to the authenticated merchant → return `404 Not Found`.
    - Customer already has an `active` or `trialing` subscription to the same plan → return `409 Conflict`.
    - Plan `billing_model = one_time` but subscription endpoint is called → return `400 Bad Request` with clear message directing to `POST /api/v1/pay`.
    - Invalid or missing email → return `400 Bad Request`.
    - Nomba checkout link generation fails → return `502 Bad Gateway`; do NOT persist `Subscription` or `Transaction` records.

- [x] **5.3. Public Plan Checkout Endpoint (`POST /api/v1/checkout/plans/:planId/sessions`) — Public Plan Link Flow**
  - **Purpose:** Merchants expose this endpoint on their public-facing app to let anyone (without API Key) initiate a subscription to a published plan.
  - **Auth:** No authentication required (this is a public endpoint). The merchant's frontend calls this on behalf of the customer.
  - **Request payload:** `{ email: string, callbackUrl?: string }`
  - **Merchant's frontend responsibility:** Collect the customer's email (via a form), then POST to this endpoint.
  - **What Lemni does:**
    1. Look up the plan by ID (this is a public lookup — any plan ID works)
    2. Extract the merchant ID from the plan
    3. Create a customer record if it doesn't exist (keyed by email + merchant)
    4. Create a pending `Subscription` record (status: `trialing` if `plan.trialDays > 0`, else `active`)
    5. Create a pending `Transaction` record
    6. Call Nomba's `POST /v1/checkout/order` API with the email and plan amount
    7. Return `{ sessionId, subscriptionId, checkoutUrl }` to the merchant's frontend
  - **Merchant's frontend next step:** Redirect the customer to the `checkoutUrl` (Nomba's hosted checkout page).
  - **Return:** `{ sessionId: string, subscriptionId: string, checkoutUrl: string }`
  - **Unhappy paths:**
    - `planId` not found → return `404 Not Found`.
    - Missing or invalid email → return `400 Bad Request`.
    - Nomba checkout link generation fails → return `502 Bad Gateway`; do NOT persist `Subscription` or `Transaction` records.

- [x] **5.4. Session Status Polling Endpoint (`GET /api/v1/sessions/:session_id/status`)**
  - **Purpose:** Developers and merchants poll this endpoint to check if a checkout session has been completed (payment succeeded or failed).
  - **Auth:** No authentication required (session ID is opaque but specific; polling is idempotent).
  - **Response:** `{ sessionId, amount, status: 'pending' | 'success' | 'failed', nombaRef?, createdAt }`
  - **Unhappy paths:**
    - `session_id` does not exist → return `404 Not Found`.
    - Session belongs to a different merchant (auth context mismatch, if merchant context is available) → return `403 Forbidden`.
    - Session has expired without completion (TTL exceeded) → return status `expired` in response body, do not return `404`.

---

## 6. ASYNCHRONOUS SCHEDULING (SchedulerModule)
- [x] **6.1. Redis & BullMQ Integration**
  - Establish connection configurations to Upstash Redis.
  - Initialize the Redis client and BullMQ dashboard/module in NestJS.
  - **Unhappy paths:**
    - Redis connection lost at startup → crash-fast with a descriptive error; do NOT start the NestJS app without a working queue.
    - Redis connection drops mid-operation → BullMQ handles reconnect internally; log the disconnect event and alert via Telegram if downtime exceeds 5 minutes.
- [x] **6.2. BillingWorker (Hourly Cron)**
  - Implement worker querying Turso hourly for subscriptions where:
    - Status is `active` and `next_billing_date <= NOW()` (process charge)
    - Status is `trialing` and `trial_end <= NOW()` (promote to active, or transition to canceled/past_due based on card presence and `trial_require_card`)
  - Push matching jobs into the `ChargeQueue`.
  - **Unhappy paths:**
    - Turso DB query fails (connection error) → log error, skip the cron cycle, do NOT push partial job batches; retry on the next hourly tick.
    - Subscription's `nomba_token` is null when charge is attempted → skip charge, set status to `past_due`, dispatch `token_missing` webhook to merchant.
    - Large batch of subscriptions due simultaneously → use cursor-based pagination when querying to avoid memory spikes; push jobs in batches.
- [x] **6.3. DunningWorker (Failure Retries & Queue)**
  - Implement queue worker executing failed charge attempts.
  - Implement exponential backoff or WAT 9:00 AM heuristic retry scheduling.
  - Cancel subscription if retries fail after `grace_period_days` limit is reached, then drop jobs into Dead Letter Queue (DLQ).
  - **Unhappy paths:**
    - Max retries hit while circuit breaker is open (Nomba outage) → do NOT cancel the subscription; instead, hold in `past_due` until circuit closes, then resume dunning from current retry count.
    - DunningWorker crashes mid-retry → BullMQ job remains in active state; on worker restart the job is re-attempted; idempotency key prevents double-charge.
    - Subscription is manually reactivated by merchant while a dunning job is queued → worker must check current subscription status before attempting charge and discard the stale job if status is no longer `past_due`.
- [x] **6.4. HealthCron & Queue Management**
  - Regularly ping Nomba health endpoint.
  - Pause the `ChargeQueue` if Nomba returns error states (circuit breaker tripped) and resume when online.
  - **Unhappy paths:**
    - HealthCron itself fails to run (Render sleep, crash) → Keep-Alive ping will restart the service; circuit breaker in ProviderModule provides redundant protection.
    - Nomba health endpoint returns degraded (2xx but with partial outage body) → treat as operational; monitor for 5xx before tripping breaker.
- [x] **6.5. Dead Letter Queue (DLQ) Management**
  - Persist all DLQ jobs with their full payload, error reason, subscription ID, and retry history.
  - Expose an admin endpoint `GET /admin/dlq` for merchants to inspect dead jobs.
  - Expose `POST /admin/dlq/:jobId/replay` to allow manual re-trigger of a dead job after the underlying issue is resolved.

---

## 7. WEBHOOKS & NOTIFICATIONS (WebhookModule)
- [x] **7.1. Inbound Webhook Handler (`POST /api/v1/webhooks/nomba`)**
  - Implement webhook receiver to verify Nomba signature headers.
  - Match webhook event payload (success/failed payment) to the corresponding `Transaction` and update state.
  - Update `Subscription` status (e.g. roll forward `next_billing_date` on success).
  - **Unhappy paths:**
    - Signature verification fails → return `401 Unauthorized`, log the attempt with IP and payload hash; do NOT update any state.
    - Webhook payload references a `nomba_ref` that does not match any local `Transaction` → log as `orphaned_webhook`, return `200 OK` to Nomba to prevent retries, alert merchant.
    - Webhook received for a `Transaction` already in terminal state (`success` or `failed`) → deduplicate silently; return `200 OK`; do NOT re-process.
    - Nomba sends a `payment.pending` event followed later by `payment.success` → ensure state machine only advances forward (pending → success); reject backward transitions.
- [ ] **7.2. Outbound Webhook Dispatcher**
  - Build dispatch queue to send signed webhook payloads to the merchant's `webhook_url`.
  - Handle retries with backoff for merchant webhook endpoints that fail.
  - **Unhappy paths:**
    - Merchant `webhook_url` returns non-2xx on first attempt → re-enqueue with exponential backoff (3 retries: 1 min, 5 min, 30 min).
    - All retries exhausted → mark dispatch as `permanently_failed`; log to DB with full payload; surface in merchant dashboard as a missed event.
    - Merchant `webhook_url` is not configured → skip dispatch silently; still deliver Telegram alerts if configured.
    - Merchant webhook endpoint is unreachable (DNS failure, timeout) → treat as non-2xx and apply same retry logic.
- [ ] **7.3. Merchant Notification Service (Telegram)**
  - Implement Telegram Bot API integration to send alert notifications to the merchant's configured `telegram_chat_id`.
  - **Unhappy paths:**
    - Telegram chat ID is invalid or bot is blocked → log the failure; do NOT crash the webhook dispatch flow; mark notification as `undelivered`.
    - Telegram API is unavailable → log the notification as `undelivered`; surface in merchant dashboard.
    - Notification service is slow → dispatch notifications asynchronously via a separate BullMQ queue (`NotificationQueue`) so they never block the critical billing path.

---

## 8. OBSERVABILITY, TESTING & DEPLOYMENT
- [ ] **8.1. Health Endpoint (`GET /health`)**
  - Expose a lightweight endpoint returning system health and current database connection status.
  - Include Redis/BullMQ queue health and Nomba circuit breaker state in the response.
- [ ] **8.2. Structured Logging**
  - Log all critical operations (transactions, webhooks, authentication events, charge attempts) with a consistent structured format including `merchant_id`, `subscription_id`, `transaction_id`, and outcome status.
  - Do NOT log raw card data, Nomba tokens, or API key plaintext at any log level.
- [ ] **8.3. Integration & End-to-End Tests**
  - Implement route-to-database integration tests covering:
    - API authentication guards (valid key, revoked key, missing key, environment mismatch).
    - One-time checkout creation (happy path and Nomba 502 failure).
    - Recurring subscription billing worker execution.
    - Trial expiry flow: with card and without card.
    - Dunning retry execution loop through to DLQ.
    - Inbound webhook signature verification (valid and invalid).
    - Outbound webhook retry exhaustion.
