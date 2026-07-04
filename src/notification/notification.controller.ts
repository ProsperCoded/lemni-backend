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

  constructor(@Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB) {}

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Disconnect Telegram (merchant dashboard)',
    description: 'Clears the Telegram chat ID for the authenticated merchant. After disconnection, the merchant will no longer receive Telegram notifications.',
  })
  @ApiResponse({
    status: 200,
    description: 'Telegram disconnected successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Telegram disconnected successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
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
    description: 'Returns whether Telegram is connected for the merchant and the connection timestamp. The chat ID is partially masked for security.',
  })
  @ApiResponse({
    status: 200,
    description: 'Telegram connection status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        connected: {
          type: 'boolean',
          description: 'Whether Telegram is currently connected',
          example: true,
        },
        connectedAt: {
          type: 'string',
          nullable: true,
          description: 'Timestamp when Telegram was connected (ISO 8601 format)',
          example: '2026-07-04T10:00:00.000Z',
        },
        chatId: {
          type: 'string',
          nullable: true,
          description: 'Partially masked Telegram chat ID (first 4 and last 4 characters visible)',
          example: '1234...5678',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
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
