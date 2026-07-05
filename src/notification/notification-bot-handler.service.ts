import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { merchants } from '../database/schema';
import { TelegramClient } from './telegram-client';
import type { TelegramUpdate } from './dto/telegram-update.dto';

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
    const merchantUsername = parts[1];

    if (!merchantUsername) {
      try {
        await this.telegramClient.sendMessage(
          chatId,
          '❌ Invalid merchant link. Please use the connection link from your Lemni dashboard.',
        );
      } catch (error) {
        this.logger.warn(
          `[BotHandler] Failed to send error message for missing username: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }

    try {
      const [merchant] = await this.db
        .select()
        .from(merchants)
        .where(eq(merchants.username, merchantUsername));

      if (!merchant) {
        try {
          await this.telegramClient.sendMessage(
            chatId,
            '❌ Merchant account not found. Please verify the link is correct.',
          );
        } catch (error) {
          this.logger.warn(
            `[BotHandler] Failed to send merchant-not-found message: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return;
      }

      if (merchant.telegramChatId === chatId) {
        try {
          await this.telegramClient.sendMessage(
            chatId,
            'ℹ️ <b>Already Connected!</b>\n\nYour Lemni account is already connected to this chat. You will continue to receive payment notifications here.',
          );
        } catch (error) {
          this.logger.warn(
            `[BotHandler] Failed to send already-connected message: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return;
      }

      if (merchant.telegramChatId && merchant.telegramChatId !== chatId) {
        try {
          await this.telegramClient.sendMessage(
            chatId,
            '⚠️ Telegram is already connected to this account from a different chat. Reconnecting...',
          );
        } catch (error) {
          this.logger.warn(
            `[BotHandler] Failed to send reconnect warning: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      await this.db
        .update(merchants)
        .set({ telegramChatId: chatId })
        .where(eq(merchants.id, merchant.id));

      try {
        await this.telegramClient.sendMessage(
          chatId,
          '✅ <b>Lemni Connected!</b>\n\nYou will now receive payment notifications in this chat.',
        );
      } catch (error) {
        this.logger.warn(
          `[BotHandler] Failed to send success message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      this.logger.log(
        `[BotHandler] Telegram connected for merchant ${merchantUsername} (merchant_id: ${merchant.id}, chat_id: ${chatId})`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[BotHandler] Error handling /start for merchant ${merchantUsername}: ${msg}`,
      );
      try {
        await this.telegramClient.sendMessage(
          chatId,
          '❌ An error occurred while connecting. Please try again later.',
        );
      } catch (sendError) {
        this.logger.warn(
          `[BotHandler] Failed to send error message: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
        );
      }
    }
  }
}
