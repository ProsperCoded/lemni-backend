import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { ProrationService } from './proration.service';
import { BillingController } from './billing.controller';
import { CheckoutModule } from '../checkout/checkout.module';

@Module({
  imports: [CheckoutModule],
  controllers: [BillingController],
  providers: [BillingService, ProrationService],
  exports: [BillingService, ProrationService],
})
export class BillingModule {}
export { BillingService, ProrationService };
