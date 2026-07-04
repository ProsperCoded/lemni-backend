import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramClient {
  private readonly logger = new Logger(TelegramClient.name);
  private readonly botToken: string;
  private readonly apiUrl = 'https://api.telegram.org';

  constructor(private readonly configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.botToken) {
      this.logger.warn('[Telegram] Bot token not configured, skipping message');
      return;
    }

    const url = `${this.apiUrl}/bot${this.botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
        }),
      });

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        const errorCode = (data.error_code as number) || response.status;
        const errorMsg = (data.description as string) || 'Unknown error';

        if (errorCode >= 400 && errorCode < 500) {
          this.logger.warn(
            `[Telegram] 4xx error (${errorCode}): ${errorMsg} — chat_id: ${chatId}`,
          );
          throw new Error(`Telegram 4xx: ${errorMsg}`);
        } else {
          this.logger.error(`[Telegram] 5xx error (${errorCode}): ${errorMsg}`);
          throw new Error(`Telegram 5xx: ${errorMsg}`);
        }
      }

      this.logger.log(
        `[Telegram] Message sent successfully to chat_id: ${chatId}`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Telegram] Failed to send message to chat_id ${chatId}: ${msg}`,
      );
      throw error;
    }
  }
}
