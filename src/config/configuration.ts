import { z } from 'zod';

export const EnvironmentSchema = z.object({
  PORT: z.coerce.number().default(3000),
  TURSO_DATABASE_URL: z.string().url().or(z.string().startsWith('file:')),
  TURSO_AUTH_TOKEN: z.string().optional(),
  NOMBA_CLIENT_KEY: z.string(),
  NOMBA_CLIENT_SECRET: z.string(),
  NOMBA_ACCOUNT_ID: z.string(),
  NOMBA_API_URL: z.string().url().default('https://api.nomba.com'),
  REDIS_URL: z.string().url(),
  API_KEY_SALT_OR_ROUNDS: z.coerce.number().default(10),
  JWT_SECRET: z.string(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  WHATSAPP_API_URL: z.string().url().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export default () => {
  const result = EnvironmentSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:', result.error.format());
    throw new Error('Invalid environment configuration');
  }

  return result.data;
};
