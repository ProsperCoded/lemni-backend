import { z } from 'zod';

export const NombaWebhookEventSchema = z.object({
  event_type: z.string(),
  requestId: z.string(),
  data: z.object({
    merchant: z.object({
      userId: z.string(),
      walletId: z.string(),
    }),
    transaction: z.object({
      transactionId: z.string(),
      type: z.string(),
      time: z.string(),
      responseCode: z.string().nullable().optional(),
    }),
    tokenizedCardData: z
      .object({
        tokenKey: z.string(),
      })
      .optional(),
  }),
});

export type NombaWebhookEventDto = z.infer<typeof NombaWebhookEventSchema>;
