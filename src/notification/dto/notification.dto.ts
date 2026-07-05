import { z } from 'zod';

export const NotificationJobPayloadSchema = z.object({
  merchantId: z.string(),
  eventType: z.enum([
    'payment_success',
    'payment_failed',
    'trial_started',
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

export const ConnectTelegramRequestSchema = z.object({
  merchantId: z.string().min(1, 'merchantId is required'),
  chatId: z.string().min(1, 'chatId is required'),
  signature: z.string().min(1, 'signature is required'),
  timestamp: z.string().min(1, 'timestamp is required'),
});

export type ConnectTelegramRequest = z.infer<
  typeof ConnectTelegramRequestSchema
>;

export const ConnectTelegramResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type ConnectTelegramResponse = z.infer<
  typeof ConnectTelegramResponseSchema
>;

export const DisconnectTelegramResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type DisconnectTelegramResponse = z.infer<
  typeof DisconnectTelegramResponseSchema
>;

export const TelegramStatusResponseSchema = z.object({
  connected: z.boolean(),
  connectedAt: z.string().nullable(),
  chatId: z.string().nullable(),
});

export type TelegramStatusResponse = z.infer<
  typeof TelegramStatusResponseSchema
>;
