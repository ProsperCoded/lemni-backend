@status-done
Feature: FR-001 Foundational Infrastructure & Database Configuration

  As a developer
  I want to configure the environment and initialize the database schema with Drizzle and Turso
  So that the application has a strongly-typed configuration and a relational database backend.

  Scenario: Environment Configuration & NestJS Configuration Setup
    Given a configuration file `.env` based on `.env.example`
    When the NestJS application boots up
    Then all environment variables should be validated and loaded into a strongly-typed configuration service

  Scenario: Database & Drizzle Setup with Turso/libSQL
    Given a Drizzle configuration module
    And schema definitions for merchants, api_keys, customers, plans, subscriptions, and transactions
    When Drizzle runs migrations
    Then the Turso database schemas should be successfully generated and migrated
