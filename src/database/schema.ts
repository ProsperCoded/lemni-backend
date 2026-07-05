import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const merchants = sqliteTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  hashedPassword: text('hashed_password'),
  webhookUrl: text('webhook_url'),
  telegramChatId: text('telegram_chat_id'),
  defaultRedirectUrl: text('default_redirect_url'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  hashedKey: text('hashed_key').notNull(),
  environment: text('environment', { enum: ['test', 'live'] }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  nombaToken: text('nomba_token'),
  metadata: text('metadata'), // JSON stringified
  signupIp: text('signup_ip'),
  signupUserAgent: text('signup_user_agent'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  amount: real('amount').notNull(),
  billingModel: text('billing_model', {
    enum: ['recurring', 'one_time', 'custom_input'],
  })
    .notNull()
    .default('recurring'),
  interval: text('interval', { enum: ['weekly', 'monthly', 'yearly'] }),
  trialDays: integer('trial_days').notNull().default(0),
  trialRequireCard: integer('trial_require_card', { mode: 'boolean' })
    .notNull()
    .default(false),
  gracePeriodDays: integer('grace_period_days').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }),
  status: text('status', {
    enum: ['trialing', 'active', 'past_due', 'canceled'],
  }).notNull(),
  currentPeriodEnd: text('current_period_end'), // ISO String
  trialEnd: text('trial_end'), // ISO String
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  amount: real('amount').notNull(),
  status: text('status', { enum: ['pending', 'success', 'failed'] }).notNull(),
  nombaRef: text('nomba_ref'),
  payload: text('payload'), // Stores request payload details for idempotency checks
  response: text('response'), // Stores payment gateway response logs
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const dlqJobs = sqliteTable('dlq_jobs', {
  id: text('id').primaryKey(), // BullMQ job ID
  subscriptionId: text('subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  payload: text('payload').notNull(), // Full job payload JSON
  errorReason: text('error_reason').notNull(),
  retryHistory: text('retry_history'), // JSON array of retry attempt timestamps and reasons
  failedAt: text('failed_at').default(sql`CURRENT_TIMESTAMP`),
});

export const otpVerifications = sqliteTable('otp_verifications', {
  id: text('id').primaryKey(),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, {
    onDelete: 'cascade',
  }),
  merchantId: text('merchant_id').references(() => merchants.id, {
    onDelete: 'cascade',
  }),
  code: text('code').notNull(),
  expiresAt: text('expires_at').notNull(), // ISO String
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').references(() => customers.id, {
    onDelete: 'cascade',
  }),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  action: text('action').notNull(), // e.g. 'subscription_activated', 'payment_failed', 'subscription_canceled'
  details: text('details'), // human-readable summary
  metadata: text('metadata'), // JSON stringified extra context (e.g. gateway response code)
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const notificationLogs = sqliteTable('notification_logs', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  category: text('category', {
    enum: ['payment', 'system', 'subscription'],
  }).notNull(),
  severity: text('severity', {
    enum: ['success', 'warning', 'info'],
  }).notNull(),
  message: text('message').notNull(),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  delivered: integer('delivered', { mode: 'boolean' }).notNull().default(false),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});
