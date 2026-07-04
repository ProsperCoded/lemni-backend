import { z } from 'zod';

export const NotificationJobPayloadSchema = z.object({
  merchantId: z.string(),
  eventType: z.enum([
    'payment_success',
    'payment_failed',
    'trial_ended',
    'grace_period_exhausted',
    'subscription_canceled',
    'dunning_failed',
  ]),
  subscriptionId: z.string().optional(),
  transactionId: z.string().optional(),
  customerId: z.string().optional(),
  amount: z.number().optional(),
  reason: z.string().optional(),
  timestamp: z.string(),
});

export type NotificationJobPayload = z.infer<
  typeof NotificationJobPayloadSchema
>;
