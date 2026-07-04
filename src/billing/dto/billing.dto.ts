import { z } from 'zod';

export const CreatePlanSchema = z
  .object({
    name: z.string().min(1, 'Plan name is required'),
    amount: z.number().positive('Amount must be a positive number'),
    billingModel: z
      .enum(['recurring', 'one_time', 'custom_input'])
      .default('recurring'),
    interval: z.enum(['weekly', 'monthly', 'yearly']).optional(),
    trialDays: z.number().int().nonnegative().default(0),
    trialRequireCard: z.boolean().default(false),
    gracePeriodDays: z.number().int().nonnegative().default(0),
  })
  .refine(
    (data) => {
      if (data.billingModel === 'recurring' && !data.interval) {
        return false;
      }
      return true;
    },
    {
      message: 'Interval is required when billing model is recurring',
      path: ['interval'],
    },
  );

export type CreatePlanDto = z.infer<typeof CreatePlanSchema>;

export const RegisterCustomerSchema = z.object({
  email: z.string().email('Invalid email address'),
  metadata: z.record(z.any()).optional(),
});

export type RegisterCustomerDto = z.infer<typeof RegisterCustomerSchema>;

export const TransactionFilterSchema = z.object({
  status: z.enum(['pending', 'success', 'failed']).optional(),
  customerId: z.string().optional(),
  subscriptionId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
  offset: z.string().regex(/^\d+$/).transform(Number).optional().default('0'),
});

export type TransactionFilterDto = z.infer<typeof TransactionFilterSchema>;
