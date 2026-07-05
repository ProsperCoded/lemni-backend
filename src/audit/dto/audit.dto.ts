import { z } from 'zod';

export const CustomerListFilterSchema = z.object({
  search: z.string().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
  offset: z.string().regex(/^\d+$/).transform(Number).optional().default('0'),
});

export type CustomerListFilterDto = z.infer<typeof CustomerListFilterSchema>;
