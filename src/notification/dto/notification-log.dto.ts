import { z } from 'zod';

export const NotificationLogFilterSchema = z.object({
  severity: z.enum(['success', 'warning', 'info']).optional(),
  category: z.enum(['payment', 'system', 'subscription']).optional(),
  search: z.string().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('50'),
  offset: z.string().regex(/^\d+$/).transform(Number).optional().default('0'),
});

export type NotificationLogFilterDto = z.infer<
  typeof NotificationLogFilterSchema
>;

export const MarkNotificationsReadSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
  read: z.boolean().optional().default(true),
});

export type MarkNotificationsReadDto = z.infer<
  typeof MarkNotificationsReadSchema
>;
