@status-active
Feature: FR-003 External Gateway Integration (ProviderModule)

  As a payment engine
  I want to communicate securely with Nomba API, log payload transmissions, enforce dunning/payment idempotency, and trip circuit breakers on consecutive 5xx gateway failures
  So that transactions are processed reliably and distributed billing queues are protected.

  Scenario: Request checkout order link from Nomba
    Given a request to create a payment checkout order link
    When NombaClient dispatches a POST to "/v1/checkout/order"
    Then the response should contain the token, checkout link, and transaction reference
    And the outbound request and response payloads must be logged

  Scenario: Execute a tokenized card charge
    Given a saved customer card token (`nomba_token`)
    When NombaClient dispatches a tokenized charge request to "/v1/checkout/tokenized-card-payment"
    Then the gateway should process the payment and return the status
    And the transaction result must be returned

  Scenario: Idempotent Payment execution
    Given an outbound charge request
    When the Idempotency Engine generates a unique UUID key
    And persists it locally prior to sending to Nomba
    Then the same idempotency key must be sent in request headers to prevent duplicate charges
    And the engine should prevent duplicate transmissions for the same charge attempt on recovery

  Scenario: Circuit Breaker Trips on Gateway Failures
    Given Nomba API returns consecutive 5xx errors exceeding the threshold
    When the ProviderModule detects these failures
    Then it must trip the circuit breaker
    And broadcast a signal to halt the active BullMQ worker queues
