@status-done
Feature: FR-004 Billing & Domain Logic (BillingModule)

  As a billing engine
  I want to manage plans, customers, subscriptions, and handle proration, trial states, and grace periods
  So that transactions are calculated accurately and subscription transitions are handled reliably.

  Scenario: Register customer and tokenize card
    Given customer details with merchant_id and email
    When a customer is registered in the database
    Then a `nomba_token` can be stored to support card charging
    And customer records are successfully retrieved

  Scenario: Plan creation and restriction
    Given a merchant attempts to create a billing plan
    When the plan is saved in the database
    Then it must belong to the correct merchant context
    And active subscriptions must prevent plan deletion to preserve billing states

  Scenario: Plan upgrade/downgrade proration calculation
    Given a customer with an active subscription on a $30/month plan
    And 15 days have elapsed in a 30-day billing cycle
    When upgrading mid-cycle to a $60/month plan
    Then the proration engine should compute the exact remaining credit of $15
    And the new charge should be adjusted by deducting the credit ($45 total for the new period)

  Scenario: Subscription grace period evaluation
    Given a subscription whose period ends
    When the period end plus `grace_period_days` is exceeded without payment
    Then the subscription status must transition to `past_due`
    And eventually transition to `canceled` when the grace period limit expires

  Scenario: Trial period expiration transitions
    Given a subscription in the `trialing` state
    When the trial period end is reached
    Then if `trial_require_card` is true and a card token exists, a charge must be attempted immediately
    And if the card is missing or charge fails, the subscription must become `past_due` or `canceled`

  Scenario: Transaction history retrieval and filtering
    Given an authenticated merchant with transaction records in the database
    When retrieving transaction logs via GET `/admin/transactions` with optional filters like status, customerId, or subscriptionId
    Then the response should only return transactions belonging to that merchant
    And pagination limits and offsets should be correctly enforced
