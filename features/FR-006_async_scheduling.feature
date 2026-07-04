@status-active
Feature: FR-006 Asynchronous Scheduling (SchedulerModule)

  As the LEMNI platform
  I want background workers to execute recurring billing, dunning retries, and health checks
  So that subscription charges and failures are handled reliably without user intervention.

  Scenario: Redis connection crash-fast at startup
    Given Redis is unavailable on startup
    When the NestJS application bootstraps
    Then the app crashes with a descriptive error and does not start

  Scenario: BillingWorker enqueues due subscriptions (active)
    Given subscriptions with status=active and currentPeriodEnd <= NOW()
    When the BillingWorker hourly cron runs
    Then each due subscription is pushed into the ChargeQueue as a BullMQ job

  Scenario: BillingWorker handles trial expiry (with card)
    Given a subscription with status=trialing, trialEnd <= NOW(), and nombaToken present
    When the BillingWorker hourly cron runs
    Then the subscription status is set to active
    And the subscription is pushed into ChargeQueue for immediate first charge

  Scenario: BillingWorker handles trial expiry (no card)
    Given a subscription with status=trialing, trialEnd <= NOW(), and nombaToken is null
    When the BillingWorker hourly cron runs
    Then the subscription status is set to past_due
    And a trial.ended_no_card webhook event is dispatched

  Scenario: DunningWorker retries a failed charge
    Given a past_due subscription with retry count within grace_period_days
    When the DunningWorker processes the job
    Then the charge is retried with exponential backoff delay

  Scenario: DunningWorker cancels subscription after grace period
    Given a past_due subscription whose retry count has exceeded grace_period_days
    When the DunningWorker processes the job
    Then the subscription is set to canceled
    And the job is moved to the Dead Letter Queue (DLQ)

  Scenario: DunningWorker skips stale job for reactivated subscription
    Given a past_due subscription that has since been manually reactivated by merchant
    When a dunning job for that subscription is processed
    Then the job is discarded without charging

  Scenario: HealthCron pauses ChargeQueue on circuit breaker trip
    Given the Nomba circuit breaker has tripped to OPEN state
    When the HealthCron runs its check
    Then the ChargeQueue is paused

  Scenario: DLQ admin endpoint lists dead jobs
    Given there are failed jobs in the Dead Letter Queue
    When an authenticated merchant calls GET /admin/dlq
    Then all DLQ entries are returned with jobId, subscriptionId, payload, error reason, and retry history

  Scenario: DLQ admin endpoint replays a dead job
    Given a specific DLQ entry by jobId
    When an authenticated merchant calls POST /admin/dlq/:jobId/replay
    Then the job is re-enqueued into the ChargeQueue for retry
