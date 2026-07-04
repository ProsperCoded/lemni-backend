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
  Inject,
  BadRequestException,
  UsePipes,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { WebhookService } from './webhook.service';
import { NombaWebhookEventSchema } from './dto/webhook.dto';
import { verifyNombaSignature } from './webhook-signature.util';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { eq } from 'drizzle-orm';
import { merchants } from '../database/schema';
import * as crypto from 'crypto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ConnectTelegramRequestSchema } from '../notification/dto/notification.dto';
import type {
  ConnectTelegramRequest,
  ConnectTelegramResponse,
} from '../notification/dto/notification.dto';

@Controller('api/v1/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
  ) {}

  @Post('nomba')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
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

  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(ConnectTelegramRequestSchema))
  @ApiOperation({
    summary: 'Telegram bot webhook endpoint',
    description: 'Receives updates or connection requests from the Telegram bot',
  })
  @ApiResponse({
    status: 200,
    description: 'Telegram connected successfully',
    schema: {
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  async handleTelegramWebhook(
    @Body() body: ConnectTelegramRequest,
  ): Promise<ConnectTelegramResponse> {
    const { merchantId, chatId, signature, timestamp } = body;

    const now = Date.now();
    const requestTime = parseInt(timestamp, 10);
    const timeDiffMs = now - requestTime;

    if (timeDiffMs < 0 || timeDiffMs > 5 * 60 * 1000) {
      this.logger.warn(
        `[WebhookController] Stale Telegram request (${timeDiffMs}ms old)`,
      );
      throw new BadRequestException('Request timestamp is too old or invalid');
    }

    const botSecret = this.configService.get<string>('TELEGRAM_BOT_SECRET') || '';
    const signingString = `${merchantId}:${chatId}:${timestamp}`;
    const expectedSignature = crypto
      .createHmac('sha256', botSecret)
      .update(signingString)
      .digest('hex');

    if (signature !== expectedSignature) {
      this.logger.warn(
        `[WebhookController] Invalid signature for merchant ${merchantId}`,
      );
      throw new UnauthorizedException('Invalid signature');
    }

    const [merchant] = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId));

    if (!merchant) {
      this.logger.warn(
        `[WebhookController] Merchant not found: ${merchantId}`,
      );
      throw new BadRequestException('Merchant not found');
    }

    await this.db
      .update(merchants)
      .set({ telegramChatId: chatId })
      .where(eq(merchants.id, merchantId));

    this.logger.log(
      `[WebhookController] Telegram connected for merchant ${merchantId}`,
    );

    return {
      success: true,
      message: 'Telegram chat connected successfully',
    };
  }
}
