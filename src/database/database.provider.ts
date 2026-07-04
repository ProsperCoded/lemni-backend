import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { ConfigService } from '@nestjs/config';
import * as schema from './schema';

export const DRIZZLE_PROVIDER = 'DRIZZLE_PROVIDER';

export const databaseProviders = [
  {
    provide: DRIZZLE_PROVIDER,
    useFactory: (configService: ConfigService) => {
      const url = configService.get<string>('TURSO_DATABASE_URL');
      const authToken = configService.get<string>('TURSO_AUTH_TOKEN');

      if (!url) {
        throw new Error('TURSO_DATABASE_URL is not configured');
      }

      const client = createClient({
        url,
        authToken,
      });

      return drizzle(client, { schema });
    },
    inject: [ConfigService],
  },
];
export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;
