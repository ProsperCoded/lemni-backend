# Lemni Core Engine — Unhappy Paths Reference

This document catalogues every identified failure scenario across the Lemni backend. Each entry states the **trigger**, the **exact system response**, and the **downstream effects** so that implementation agents and reviewers can verify complete coverage.

> **Convention:** "Terminal" means no further automated retry is attempted. "Retryable" means the system re-enqueues or reattempts automatically.

---

## UP-01 · Authentication & API Keys

### UP-01.1 Missing `Authorization` header
- **Trigger:** Request to a guarded endpoint arrives without an `Authorization` header.
- **Response:** `401 Unauthorized` · error code `MISSING_API_KEY`.
- **State change:** None. Request is rejected before reaching any service layer.

### UP-01.2 Invalid or unrecognised API key
- **Trigger:** Key provided does not match any active hash in `api_keys`.
- **Response:** `401 Unauthorized` · error code `INVALID_API_KEY`.
- **State change:** None.

### UP-01.3 Revoked API key
- **Trigger:** Key is found in DB but `is_active = false`.
- **Response:** `403 Forbidden` · error code `REVOKED_API_KEY`.
- **State change:** None. No grace window; rejection is immediate.

### UP-01.4 Environment mismatch
- **Trigger:** A live API key is used against a test endpoint, or vice versa.
- **Response:** `403 Forbidden` · error code `ENVIRONMENT_MISMATCH`.
- **State change:** None.

### UP-01.5 Expired JWT (dashboard)
- **Trigger:** A merchant dashboard request carries a JWT past its `exp` claim.
- **Response:** `401 Unauthorized` · error code `TOKEN_EXPIRED`.
- **State change:** None. Client must re-authenticate.

### UP-01.6 Tampered JWT
- **Trigger:** JWT signature verification fails.
- **Response:** `401 Unauthorized` · error code `INVALID_TOKEN`.
- **State change:** None. Log the attempt.

---

## UP-02 · Nomba Provider Errors

### UP-02.1 Nomba 4xx — non-retryable charge failure
- **Trigger:** `POST /v1/checkout/tokenized-card-payment` returns a 4xx (e.g. `insufficient_funds`, `card_expired`, `invalid_token`).
- **Response to caller:** Error surfaced to BillingWorker.
- **State change:**
  - `Transaction.status` → `failed`.
  - If `plan.grace_period_days > 0` and this is the first failure: `Subscription.status` → `past_due`; job injected into `DunningQueue`.
  - If `grace_period_days = 0`: `Subscription.status` → `canceled` immediately.
- **Classification:** **Terminal** for this attempt. DunningWorker owns retries.

### UP-02.2 Nomba 5xx or network timeout — retryable
- **Trigger:** `POST /v1/checkout/tokenized-card-payment` returns 5xx or times out.
- **State change:**
  - `Transaction.status` stays `pending`.
  - `Subscription.status` is **not** changed to `past_due` yet.
- **Action:** Re-enqueue job to `ChargeQueue` with exponential backoff delay. Circuit breaker failure counter increments.
- **Classification:** **Retryable**.

### UP-02.3 Nomba auth token expired
- **Trigger:** Nomba rejects request with auth expiry error.
- **Action:** Transparently refresh Nomba access credentials and retry the original request **once**. If the refreshed retry also fails, surface the error as UP-02.1 or UP-02.2 based on status code.

### UP-02.4 Checkout link generation failure (`POST /v1/checkout/order`)
- **Trigger:** Nomba returns 4xx when generating a hosted checkout link.
- **Response to API caller:** `502 Bad Gateway`.
- **State change:** **No `Transaction` record is created.** Session is not persisted.

### UP-02.5 Circuit breaker trips
- **Trigger:** Nomba returns consecutive 5xx responses beyond the configured threshold.
- **Action:**
  - Circuit breaker state → `OPEN`.
  - Signal sent to SchedulerModule to call `queue.pause()` on `ChargeQueue`.
  - Jobs already dequeued and mid-flight are re-enqueued with a delay so they are not lost.
  - `provider.outage` event dispatched via WebhookModule to all merchants with active subscriptions.
- **Recovery:** HealthCron detects Nomba recovery → circuit resets to `CLOSED` → `queue.resume()` called.

### UP-02.6 Circuit breaker open during extended outage
- **Trigger:** Breaker remains `OPEN` for an extended period.
- **Action:** Merchant-facing `provider.outage_extended` webhook event emitted with estimated impact (number of subscriptions paused).

---

## UP-03 · Idempotency & Crash Recovery

### UP-03.1 Container crash after idempotency key written but before Nomba responds
- **Trigger:** Process terminates between log write and Nomba HTTP response.
- **Recovery on reboot:**
  1. Detect all idempotency keys with status `transmitted_unconfirmed`.
  2. Query Nomba's order status endpoint for each unconfirmed key.
  3. Reconcile local `Transaction` state from Nomba's response.
  4. Re-enqueue only if Nomba confirms no charge was made.

### UP-03.2 Duplicate BullMQ job delivery
- **Trigger:** BullMQ at-least-once semantics causes the same job to be delivered twice.
- **Action:** Idempotency check at worker entry finds an existing confirmed key → skip job, emit a warning log.
- **State change:** None (no double-charge).

---

## UP-04 · Billing & Subscription Logic

### UP-04.1 Customer subscribes to another merchant's plan
- **Trigger:** `plan_id` in subscribe request belongs to a different merchant than the API key.
- **Response:** `403 Forbidden`.

### UP-04.2 Plan deletion with active subscribers
- **Trigger:** Merchant attempts to delete or archive a plan that has `active`, `trialing`, or `past_due` subscriptions.
- **Response:** `409 Conflict`. Deletion blocked until all affected subscriptions are migrated or canceled.

### UP-04.3 Duplicate customer registration
- **Trigger:** Same `email` submitted under the same `merchant_id`.
- **Response:** `409 Conflict`. Returns the existing customer record in the error body.

### UP-04.4 Card tokenisation failure during subscription setup
- **Trigger:** Nomba rejects the card during the initial hosted checkout (setup flow).
- **Action:** No `Subscription` record is created. Error returned to frontend with a user-actionable message to retry with a different card.

### UP-04.5 Plan upgrade/downgrade on non-active subscription
- **Trigger:** Merchant attempts proration change when `Subscription.status` is `past_due` or `canceled`.
- **Response:** `409 Conflict`. Merchant must resolve the outstanding balance or reactivate first.

### UP-04.6 Custom-input billing — missing amount at charge time
- **Trigger:** A `custom_input` plan job enters the `ChargeQueue` without a merchant-supplied charge amount.
- **Action:** Job is rejected (not retried). `custom_amount_missing` webhook event sent to merchant. Subscription remains `active`; next scheduled charge attempt picks up on the next billing cycle.

### UP-04.7 Trial ends — card required, charge fails immediately
- **Trigger:** `trial_require_card = true`; trial expires; first charge returns Nomba 4xx.
- **Action:** Treated as UP-02.1. Subscription moves to `past_due`; DunningWorker takes over.

### UP-04.8 Trial ends — no card on file
- **Trigger:** `trial_require_card = false`; trial expires; `nomba_token` is null.
- **Action:**
  - `Subscription.status` → `past_due`.
  - `trial.ended_no_card` webhook dispatched to merchant.
  - Telegram alert sent to merchant.
  - If card is not added within `grace_period_days`, subscription is canceled.

### UP-04.9 `trial_days = 0` with `trial_require_card = true`
- **Trigger:** Plan configured with zero trial days and card-required flag.
- **Action:** Skip the `trialing` status entirely. Create subscription as `active` immediately and enqueue first charge.

### UP-04.10 BillingWorker misses a trial-end window
- **Trigger:** Service outage prevents the hourly worker from running at the exact `trial_end` timestamp.
- **Action:** On the next successful hourly run, all `trialing` subscriptions where `trial_end < NOW()` are caught and processed retroactively. Dates are **not** reset; the effective trial end date remains the original.

### UP-04.11 Subscription reactivation — expired `nomba_token`
- **Trigger:** Merchant tries to reactivate a `canceled` subscription but the customer's card token has expired.
- **Response:** `422 Unprocessable Entity`. Merchant is instructed to initiate a new tokenisation flow for the customer before reactivating.

### UP-04.12 Subscription reactivation — plan is archived
- **Trigger:** Merchant tries to reactivate a subscription whose plan is archived.
- **Response:** `409 Conflict`. Merchant must assign the customer to an active plan.

---

## UP-05 · Checkout API

### UP-05.1 Missing required fields on `POST /api/v1/pay`
- **Trigger:** Request body is missing `amount`, `currency`, or customer reference.
- **Response:** `400 Bad Request` with field-level validation errors. Nomba is never called.

### UP-05.2 Duplicate `session_id` collision
- **Trigger:** Generated `session_id` already exists in the DB (astronomically rare UUID collision).
- **Action:** Regenerate up to 3 times. If all 3 collide, return `500 Internal Server Error` and alert via logging.

### UP-05.3 `plan_id` not found or cross-merchant access
- **Trigger:** `plan_id` on `POST /api/v1/subscribe` does not exist or belongs to another merchant.
- **Response:** `404 Not Found`.

### UP-05.4 Duplicate active subscription
- **Trigger:** Customer already has `active` or `trialing` subscription to the same plan.
- **Response:** `409 Conflict`. Returns the existing `subscription_id`.

### UP-05.5 Wrong endpoint for billing model
- **Trigger:** `billing_model = one_time` plan used against `POST /api/v1/subscribe`.
- **Response:** `400 Bad Request` with message directing the integrator to `POST /api/v1/pay`.

### UP-05.6 Session not found on status poll
- **Trigger:** `GET /api/v1/sessions/:session_id/status` with unknown ID.
- **Response:** `404 Not Found`.

### UP-05.7 Session belongs to different merchant
- **Trigger:** Auth context (API key merchant) does not match the session's owning merchant.
- **Response:** `403 Forbidden`.

### UP-05.8 Session expired without payment completion
- **Trigger:** Checkout session TTL has passed and no payment was made.
- **Response:** `200 OK` with `{ "status": "expired" }`. **Do not return `404`**; the session record exists.

---

## UP-06 · Scheduler & Queue

### UP-06.1 Redis unavailable at startup
- **Trigger:** NestJS boots but cannot connect to Upstash Redis.
- **Action:** **Crash-fast**. Process exits with a descriptive error. Do NOT start the app in a degraded, queue-less state.

### UP-06.2 Redis connection drops mid-operation
- **Trigger:** Redis drops after the app is running.
- **Action:** BullMQ's built-in reconnection logic handles the reconnect transparently. Disconnect event is logged. If downtime exceeds 5 minutes, Telegram alert fires to the operator.

### UP-06.3 Turso DB query failure in BillingWorker
- **Trigger:** The hourly cron cannot reach Turso.
- **Action:** Log the error. **Skip the entire cron cycle** — do not push partial job batches. Next hourly run will pick up all due subscriptions (retroactive catch-up is safe because dates are compared against `NOW()`).

### UP-06.4 Missing `nomba_token` at charge time
- **Trigger:** BillingWorker picks up a subscription whose `nomba_token` is `null`.
- **Action:**
  - Skip charge. Do NOT mark as `failed` in an error sense.
  - Set `Subscription.status` → `past_due`.
  - Dispatch `token_missing` webhook to merchant.
  - Log as a data-integrity warning.

### UP-06.5 Large batch of simultaneous due subscriptions
- **Trigger:** Many subscriptions share the same `next_billing_date` (e.g. end of month).
- **Action:** Use cursor-based pagination for the BillingWorker DB query. Push jobs in batches capped at a configured max concurrency.

### UP-06.6 Max dunning retries hit while circuit breaker is open
- **Trigger:** Nomba is down and the DunningWorker has exhausted all retries.
- **Action:** **Do NOT cancel the subscription.** Hold at `past_due`. Retry counter is frozen. When circuit breaker closes and the queue resumes, DunningWorker attempts one final charge. If that also fails, cancellation proceeds.

### UP-06.7 DunningWorker crashes mid-retry
- **Trigger:** Worker process crashes while a job is in `active` state in BullMQ.
- **Action:** BullMQ moves the job back to `waiting` on reconnect. Worker re-processes it. Idempotency key prevents double-charge.

### UP-06.8 Stale dunning job for reactivated subscription
- **Trigger:** Merchant manually reactivates a subscription while a DunningWorker job is queued.
- **Action:** Worker reads current `Subscription.status` before attempting charge. If status is no longer `past_due`, job is discarded with a log entry.

---

## UP-07 · Inbound Webhooks (Nomba → Lemni)

### UP-07.1 Webhook signature verification failure
- **Trigger:** Nomba sends a webhook but the HMAC/signature does not match.
- **Response:** `401 Unauthorized`. Log the IP, timestamp, and payload hash. **No state is updated.**

### UP-07.2 Orphaned webhook — unknown `nomba_ref`
- **Trigger:** Webhook references a `nomba_ref` that has no matching `Transaction` in the DB.
- **Response:** `200 OK` returned to Nomba (prevents Nomba from retrying infinitely). Log as `orphaned_webhook`. Merchant is alerted.

### UP-07.3 Duplicate webhook for terminal transaction
- **Trigger:** Nomba resends a webhook for a `Transaction` already in `success` or `failed` state.
- **Action:** Deduplicate silently. Return `200 OK`. **Do not re-process or alter state.**

### UP-07.4 Out-of-order webhook events
- **Trigger:** Nomba delivers `payment.success` before a `payment.pending` event, or delivers both but in wrong order.
- **Action:** State machine enforces forward-only transitions (`pending` → `success` or `pending` → `failed`). Any event attempting a backward transition is discarded with a warning log.

---

## UP-08 · Outbound Webhooks (Lemni → Merchant)

### UP-08.1 Merchant endpoint returns non-2xx
- **Trigger:** First dispatch attempt to merchant `webhook_url` fails.
- **Action:** Re-enqueue with exponential backoff: retry at +1 min, +5 min, +30 min.

### UP-08.2 All outbound webhook retries exhausted
- **Trigger:** All 3 retry attempts fail.
- **Action:**
  - Dispatch status → `permanently_failed`.
  - Full payload + error reason persisted to DB.
  - Event surfaced in merchant dashboard as a **missed event** requiring acknowledgement.

### UP-08.3 Merchant `webhook_url` not configured
- **Trigger:** Plan or merchant has no `webhook_url` set.
- **Action:** Skip webhook dispatch silently. Still deliver Telegram alerts if configured.

### UP-08.4 DNS or timeout failure on merchant endpoint
- **Trigger:** Merchant endpoint is unreachable (DNS failure, connection timeout).
- **Action:** Treated identically to UP-08.1 (non-2xx response); retry logic applies.

---

## UP-09 · Merchant Notifications (Telegram)

### UP-09.1 Invalid Telegram chat ID or bot blocked
- **Trigger:** Telegram API returns an error for the merchant's configured `telegram_chat_id`.
- **Action:** Log the failure. **Do not block or crash the webhook dispatch flow.** Mark the notification as `undelivered`; surface in merchant dashboard.

### UP-09.2 Telegram API unavailable
- **Trigger:** Telegram API is down or unreachable.
- **Action:** Log the notification as `undelivered`. Surface in merchant dashboard. Do not retry infinitely.

### UP-09.3 Notification service latency
- **Trigger:** Telegram API is slow.
- **Action:** Notifications are dispatched via a dedicated asynchronous BullMQ queue (`NotificationQueue`) so they never block the critical billing path.

---

## Summary Matrix

| ID | Module | Failure | Retryable | Terminal Action |
|---|---|---|---|---|
| UP-01.1–1.6 | Auth | Missing/invalid/revoked key, bad JWT | No | 401 / 403 |
| UP-02.1 | Provider | Nomba 4xx charge | No | → DunningQueue |
| UP-02.2 | Provider | Nomba 5xx charge | Yes | Backoff retry |
| UP-02.5 | Provider | Circuit breaker trips | — | Pause queue, notify |
| UP-03.1 | Idempotency | Crash post-write | — | Reconcile on reboot |
| UP-03.2 | Idempotency | Duplicate job | No | Skip silently |
| UP-04.6 | Billing | Custom amount missing | No | Webhook to merchant |
| UP-04.8 | Billing | Trial end, no card | No | → `past_due`, then cancel |
| UP-05.5 | Checkout | Wrong billing model endpoint | No | 400 |
| UP-05.8 | Checkout | Session expired | No | 200 `{ status: expired }` |
| UP-06.1 | Scheduler | Redis down at boot | — | Crash-fast |
| UP-06.6 | Scheduler | Max retries + open breaker | — | Hold `past_due` |
| UP-07.1 | Webhook in | Bad signature | No | 401, log |
| UP-07.2 | Webhook in | Unknown ref | No | 200, alert merchant |
| UP-07.3 | Webhook in | Duplicate event | No | 200, deduplicate |
| UP-08.2 | Webhook out | All retries failed | No | `permanently_failed`, dashboard |
| UP-09.2 | Notifications | Telegram unavailable | No | `undelivered`, dashboard |
