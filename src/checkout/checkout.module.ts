import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { AuthModule } from '../auth/auth.module';
import { ProviderModule } from '../provider/provider.module';

@Module({
  imports: [AuthModule, ProviderModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
