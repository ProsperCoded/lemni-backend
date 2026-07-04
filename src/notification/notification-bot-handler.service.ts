import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { merchants } from '../database/schema';
import { TelegramClient } from './telegram-client';
import type { TelegramUpdate } from './dto/telegram-update.dto';
import * as crypto from 'crypto';

@Injectable()
export class NotificationBotHandlerService {
  private readonly logger = new Logger(NotificationBotHandlerService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    private readonly telegramClient: TelegramClient,
  ) {}

  async handleBotUpdate(update: TelegramUpdate): Promise<void> {
    if (!update.message || !update.message.text) {
      return;
    }

    const text = update.message.text.trim();
    const chatId = String(update.message.chat.id);

    if (!text.startsWith('/start')) {
      return;
    }

    const parts = text.split(/\s+/);
    const merchantParam = parts[1];

    if (!merchantParam || !merchantParam.startsWith('merchant_')) {
      await this.telegramClient.sendMessage(
        chatId,
        '❌ Invalid merchant link. Please use the connection link from your Lemni dashboard.',
      );
      return;
    }

    const merchantId = merchantParam;

    try {
      const [merchant] = await this.db
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchantId));

      if (!merchant) {
        await this.telegramClient.sendMessage(
          chatId,
          '❌ Merchant account not found. Please verify the link is correct.',
        );
        return;
      }

      if (merchant.telegramChatId && merchant.telegramChatId !== chatId) {
        await this.telegramClient.sendMessage(
          chatId,
          '⚠️ Telegram is already connected to this account from a different chat. Reconnecting...',
        );
      }

      await this.db
        .update(merchants)
        .set({ telegramChatId: chatId })
        .where(eq(merchants.id, merchantId));

      await this.telegramClient.sendMessage(
        chatId,
        '✅ <b>Lemni Connected!</b>\n\nYou will now receive payment notifications in this chat.',
      );

      this.logger.log(
        `[BotHandler] Telegram connected for merchant ${merchantId} (chat_id: ${chatId})`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[BotHandler] Error handling /start for merchant ${merchantId}: ${msg}`,
      );
      await this.telegramClient.sendMessage(
        chatId,
        '❌ An error occurred while connecting. Please try again later.',
      );
    }
  }
}
