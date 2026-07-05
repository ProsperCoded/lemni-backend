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
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { WebhookService } from './webhook.service';
import { NombaWebhookEventSchema } from './dto/webhook.dto';
import { verifyNombaSignature } from './webhook-signature.util';
import { TelegramUpdateSchema } from '../notification/dto/telegram-update.dto';
import { NotificationBotHandlerService } from '../notification/notification-bot-handler.service';

@Controller('api/v1/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
    private readonly botHandler: NotificationBotHandlerService,
  ) {}

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test webhook endpoint (development only)',
    description:
      'Returns 200 OK. Use this to test if webhooks are reaching your server.',
  })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async testWebhook(
    @Body() body: unknown,
    @Headers() headers: Record<string, unknown>,
  ) {
    this.logger.log('[Webhook Test] Received payload');
    this.logger.log('[Webhook Test] Headers: ' + JSON.stringify(headers));
    this.logger.log('[Webhook Test] Body: ' + JSON.stringify(body));
    return { received: true, timestamp: new Date().toISOString() };
  }

  @Post('nomba')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleNombaWebhook(
    @Body() body: unknown,
    @Headers('nomba-signature') signature: string | undefined,
    @Headers('nomba-timestamp') timestamp: string | undefined,
    @Ip() ip: string,
  ) {
    this.logger.debug(
      '[Nomba Webhook] Raw body received: ' + JSON.stringify(body),
    );

    const parsed = NombaWebhookEventSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(
        '[Webhook] Payload failed schema validation — IP: ' + ip,
        parsed.error,
      );
      return { received: true };
    }

    this.logger.debug(
      '[Nomba Webhook] Parsed successfully. Event type: ' +
        parsed.data.event_type +
        ', Transaction ID: ' +
        parsed.data.data.transaction.transactionId,
    );

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

    this.logger.debug(
      '[Nomba Webhook] Signature verified. Processing event for transactionId: ' +
        parsed.data.data.transaction.transactionId,
    );

    const result = await this.webhookService.processNombaEvent(parsed.data);

    this.logger.debug(
      '[Nomba Webhook] Event processing complete. Result status: ' +
        result.status,
    );

    return result;
  }

  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleTelegramWebhook(
    @Body() body: unknown,
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
  ) {
    const expectedSecret = this.configService.get<string>(
      'TELEGRAM_BOT_SECRET',
    );

    if (!expectedSecret || secretToken !== expectedSecret) {
      this.logger.warn('[Webhook] Telegram secret_token mismatch — rejecting');
      throw new UnauthorizedException('Invalid Telegram secret token');
    }

    const parsed = TelegramUpdateSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn('[Webhook] Telegram update failed schema validation');
      return { received: true };
    }

    await this.botHandler.handleBotUpdate(parsed.data);
    return { received: true };
  }
}
