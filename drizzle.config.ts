import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Load environment variables
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
config();

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  verbose: true,
  strict: true,
});
