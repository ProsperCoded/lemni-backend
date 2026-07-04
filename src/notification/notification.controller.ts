import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  BadRequestException,
  UnauthorizedException,
  Inject,
  Logger,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { eq } from 'drizzle-orm';
import { merchants } from '../database/schema';
import * as crypto from 'crypto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ConnectTelegramRequestSchema } from './dto/notification.dto';
import type {
  ConnectTelegramRequest,
  ConnectTelegramResponse,
  DisconnectTelegramResponse,
  TelegramStatusResponse,
} from './dto/notification.dto';

@ApiTags('merchant-dashboard/notifications')
@Controller('api/v1/admin/telegram')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);
  private readonly botSecret: string;

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    private readonly configService: ConfigService,
  ) {
    this.botSecret =
      this.configService.get<string>('TELEGRAM_BOT_SECRET') || '';
  }

  @Post('connect')
  @UsePipes(new ZodValidationPipe(ConnectTelegramRequestSchema))
  @ApiOperation({
    summary: 'Connect Telegram bot (called by bot after /start)',
    description: 'Bot calls this endpoint after merchant sends /start command',
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
  async connectTelegram(
    @Body() body: ConnectTelegramRequest,
  ): Promise<ConnectTelegramResponse> {
    const { merchantId, chatId, signature, timestamp } = body;

    const now = Date.now();
    const requestTime = parseInt(timestamp, 10);
    const timeDiffMs = now - requestTime;

    if (timeDiffMs < 0 || timeDiffMs > 5 * 60 * 1000) {
      this.logger.warn(
        `[NotificationController] Stale request (${timeDiffMs}ms old)`,
      );
      throw new BadRequestException('Request timestamp is too old or invalid');
    }

    const signingString = `${merchantId}:${chatId}:${timestamp}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.botSecret)
      .update(signingString)
      .digest('hex');

    if (signature !== expectedSignature) {
      this.logger.warn(
        `[NotificationController] Invalid signature for merchant ${merchantId}`,
      );
      throw new UnauthorizedException('Invalid signature');
    }

    const [merchant] = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId));

    if (!merchant) {
      this.logger.warn(
        `[NotificationController] Merchant not found: ${merchantId}`,
      );
      throw new BadRequestException('Merchant not found');
    }

    await this.db
      .update(merchants)
      .set({ telegramChatId: chatId })
      .where(eq(merchants.id, merchantId));

    this.logger.log(
      `[NotificationController] Telegram connected for merchant ${merchantId}`,
    );

    return {
      success: true,
      message: 'Telegram chat connected successfully',
    };
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Disconnect Telegram (merchant dashboard)',
    description: 'Clears the Telegram chat ID for the authenticated merchant',
  })
  @ApiResponse({
    status: 200,
    description: 'Telegram disconnected successfully',
  })
  async disconnectTelegram(
    @Request() req: ExpressRequest,
  ): Promise<DisconnectTelegramResponse> {
    const merchantId = (req.user as Record<string, string>)?.sub;

    if (!merchantId) {
      throw new UnauthorizedException('Merchant not authenticated');
    }

    await this.db
      .update(merchants)
      .set({ telegramChatId: null })
      .where(eq(merchants.id, merchantId));

    this.logger.log(
      `[NotificationController] Telegram disconnected for merchant ${merchantId}`,
    );

    return {
      success: true,
      message: 'Telegram disconnected successfully',
    };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Check Telegram connection status',
    description: 'Returns whether Telegram is connected for the merchant',
  })
  @ApiResponse({
    status: 200,
    description: 'Telegram connection status',
    schema: {
      properties: {
        connected: { type: 'boolean' },
        connectedAt: { type: 'string', nullable: true },
        chatId: { type: 'string', nullable: true },
      },
    },
  })
  async getTelegramStatus(
    @Request() req: ExpressRequest,
  ): Promise<TelegramStatusResponse> {
    const merchantId = (req.user as Record<string, string>)?.sub;

    if (!merchantId) {
      throw new UnauthorizedException('Merchant not authenticated');
    }

    const [merchant] = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId));

    if (!merchant) {
      throw new BadRequestException('Merchant not found');
    }

    return {
      connected: !!merchant.telegramChatId,
      connectedAt: merchant.telegramChatId ? new Date().toISOString() : null,
      chatId: merchant.telegramChatId
        ? merchant.telegramChatId.slice(0, 4) +
          '...' +
          merchant.telegramChatId.slice(-4)
        : null,
    };
  }
}
