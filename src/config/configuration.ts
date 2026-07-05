import { z } from 'zod';

export const EnvironmentSchema = z.object({
  PORT: z.coerce.number().default(3000),
  FRONTEND_URL: z.string().url().optional(),
  TURSO_DATABASE_URL: z.string().url().or(z.string().startsWith('file:')),
  TURSO_AUTH_TOKEN: z.string().optional(),
  NOMBA_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  NOMBA_MAIN_ACCOUNT_ID: z.string(),
  NOMBA_SUB_ACCOUNT_ID: z.string(),
  NOMBA_LIVE_CLIENT_ID: z.string(),
  NOMBA_LIVE_CLIENT_SECRET: z.string(),
  NOMBA_TEST_CLIENT_ID: z.string(),
  NOMBA_TEST_CLIENT_SECRET: z.string(),
  NOMBA_WEBHOOK_SECRET: z.string(),
  REDIS_URL: z.string().url(),
  API_KEY_SALT_OR_ROUNDS: z.coerce.number().default(10),
  JWT_SECRET: z.string(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_BOT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_SENDER_EMAIL: z.string().optional(),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export default () => {
  const result = EnvironmentSchema.safeParse(process.env);

  if (!result.success) {
    console.error(
      '❌ Invalid environment configuration:',
      result.error.format(),
    );
    throw new Error('Invalid environment configuration');
  }

  return result.data;
};
