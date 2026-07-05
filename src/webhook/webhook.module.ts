import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { EmailService } from '../common/services/email.service';

@Module({
  controllers: [WebhookController],
  providers: [WebhookService, EmailService],
})
export class WebhookModule {}
