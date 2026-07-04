/**
 * Jest global setup file — runs before every test file in the e2e suite.
 * Sets NODE_ENV=test so background workers (BullMQ) do not start during tests.
 */
process.env.NODE_ENV = 'test';
