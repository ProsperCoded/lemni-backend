@status-done
Feature: FR-002 Security & Authentication

  As a developer or merchant dashboard user
  I want API key authentication for developers and JWT session authentication for the admin dashboard
  So that LEMNI backend routes are securely guarded against unauthorized access.

  Scenario: API Key Hashing and Secure Verification
    Given a raw cryptographically secure API key is generated
    When it is saved in the database
    Then it should be stored as a bcrypt hash
    And the merchant should only view the raw key once upon generation

  Scenario: API Key Authentication Guard on Protected Endpoints
    Given a request with "Authorization: Bearer <API_KEY>"
    When the ApiKeyGuard validates the header
    Then the key must match a hashed record in the database
    And the key must belong to an active merchant configuration (`is_active` is true)
    And the correct environment context (test or live) must be set on the request

  Scenario: JWT Authentication Guard for Admin Dashboard
    Given a request to an administrative endpoint `/admin/*`
    And a JWT token generated upon login
    When the JwtAuthGuard validates the token
    Then only authenticated merchants with valid sessions should be allowed access
