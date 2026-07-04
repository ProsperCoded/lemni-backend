@status-done
Feature: FR-005 API Boundary (CheckoutModule)

  As a merchant or a customer
  I want to initialize payment and subscription checkout sessions and check status
  So that transactions are registered and redirected to secure payment gateways.

  Scenario: Create one-time payment checkout session
    Given a merchant requests a checkout link for a customer amount
    When they call `POST /api/v1/pay` with a valid API key
    Then a pending transaction record is saved in the database
    And a secure checkout link is returned

  Scenario: Create recurring subscription checkout session
    Given a merchant requests subscription checkout for a plan
    When they call `POST /api/v1/subscribe` with a valid API key
    Then a pending subscription and pending transaction are created
    And a secure checkout link is returned

  Scenario: Poll checkout session status
    Given a pending checkout session ID
    When calling `GET /api/v1/sessions/:id/status`
    Then the system returns the transaction status

  Scenario: Generate public plan checkout session
    Given a public user attempting to subscribe to a static plan URL
    When the frontend calls `POST /api/v1/checkout/plans/:planId/sessions` with the user email
    Then the customer is registered dynamically
    And a pending subscription and transaction are generated
    And a secure checkout link is returned without requiring API credentials
