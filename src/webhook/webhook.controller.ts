import {
  Controller,
  Post,
  Body,
  Headers,
  Ip,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { WebhookService } from './webhook.service';
import { NombaWebhookEventSchema } from './dto/webhook.dto';
import { verifyNombaSignature } from './webhook-signature.util';

@ApiTags('developer-apis/webhooks')
@Controller('api/v1/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
  ) {}

  @Post('nomba')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive Nomba payment webhook events',
    description:
      'Verifies the Nomba signature and updates the matching transaction/subscription state accordingly.',
  })
  @ApiResponse({
    status: 200,
    description: 'Event processed, ignored, orphaned, or deduplicated',
  })
  @ApiResponse({ status: 401, description: 'Signature verification failed' })
  async handleNombaWebhook(
    @Body() body: unknown,
    @Headers('nomba-signature') signature: string | undefined,
    @Headers('nomba-timestamp') timestamp: string | undefined,
    @Ip() ip: string,
  ) {
    const parsed = NombaWebhookEventSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(
        '[Webhook] Payload failed schema validation — IP: ' + ip,
      );
      return { received: true };
    }

    const secret = this.configService.get<string>('NOMBA_WEBHOOK_SECRET')!;
    const isValid = verifyNombaSignature(
      parsed.data,
      timestamp,
      signature,
      secret,
    );

    if (!isValid) {
      this.logger.warn('[Webhook] Signature verification failed — IP: ' + ip);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return this.webhookService.processNombaEvent(parsed.data);
  }
}
