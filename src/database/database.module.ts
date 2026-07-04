import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { databaseProviders, DRIZZLE_PROVIDER } from './database.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [...databaseProviders],
  exports: [DRIZZLE_PROVIDER],
})
export class DatabaseModule {}
export { DRIZZLE_PROVIDER };
