import { z } from 'zod';

export const OneTimePaymentSchema = z.object({
  amount: z.number().positive('Amount must be a positive number'),
  email: z.string().email('Invalid customer email address'),
  callbackUrl: z.string().url('Invalid callback URL format').optional(),
});

export type OneTimePaymentDto = z.infer<typeof OneTimePaymentSchema>;

export const SubscriptionPaymentSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
  email: z.string().email('Invalid customer email address'),
  callbackUrl: z.string().url('Invalid callback URL format').optional(),
});

export type SubscriptionPaymentDto = z.infer<typeof SubscriptionPaymentSchema>;

export const PublicPlanSessionSchema = z.object({
  email: z.string().email('Invalid customer email address'),
  callbackUrl: z.string().url('Invalid callback URL format').optional(),
});

export type PublicPlanSessionDto = z.infer<typeof PublicPlanSessionSchema>;

export const UnsubscribeRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export type UnsubscribeRequestDto = z.infer<typeof UnsubscribeRequestSchema>;

export const UnsubscribeConfirmSchema = z.object({
  code: z.string().length(6, 'Verification code must be exactly 6 characters'),
});

export type UnsubscribeConfirmDto = z.infer<typeof UnsubscribeConfirmSchema>;
