import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from './telegram-client';
import type { NotificationJobPayload } from './dto/notification.dto';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly telegramClient: TelegramClient) {}

  async sendAlert(
    chatId: string,
    payload: NotificationJobPayload,
  ): Promise<void> {
    const message = this.formatMessage(payload);

    try {
      await this.telegramClient.sendMessage(chatId, message);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('4xx')) {
        this.logger.warn(
          `[Notification] Chat ID invalid or bot blocked: ${chatId}`,
        );
        throw error;
      }
      this.logger.error(`[Notification] Failed to send alert: ${msg}`);
      throw error;
    }
  }

  private formatMessage(payload: NotificationJobPayload): string {
    const baseInfo = `Merchant: ${payload.merchantId}\nTime: ${new Date(payload.timestamp).toLocaleString()}`;

    switch (payload.eventType) {
      case 'payment_success':
        return (
          `✅ <b>Payment Successful</b>\n\n` +
          `Subscription: ${payload.subscriptionId}\n` +
          `Amount: ₦${payload.amount}\n` +
          `${baseInfo}`
        );

      case 'payment_failed':
        return (
          `❌ <b>Payment Failed</b>\n\n` +
          `Subscription: ${payload.subscriptionId}\n` +
          `Reason: ${payload.reason || 'Unknown'}\n` +
          `${baseInfo}`
        );

      case 'trial_started':
        return (
          `🎉 <b>Trial Started</b>\n\n` +
          `Subscription: ${payload.subscriptionId}\n` +
          `${payload.reason || 'No card required for this trial'}\n` +
          `${baseInfo}`
        );

      case 'trial_ended':
        return (
          `⏰ <b>Trial Period Ended</b>\n\n` +
          `Subscription: ${payload.subscriptionId}\n` +
          `Billing has started\n` +
          `${baseInfo}`
        );

      case 'grace_period_exhausted':
        return (
          `❌ <b>Subscription Canceled</b>\n\n` +
          `Subscription: ${payload.subscriptionId}\n` +
          `Reason: ${payload.reason || 'Payment failed after retries'}\n` +
          `${baseInfo}`
        );

      case 'subscription_canceled':
        return (
          `🛑 <b>Subscription Canceled</b>\n\n` +
          `Subscription: ${payload.subscriptionId}\n` +
          `Reason: ${payload.reason || 'Merchant canceled'}\n` +
          `${baseInfo}`
        );

      case 'dunning_failed':
        return (
          `⚠️ <b>Dunning Retry Failed</b>\n\n` +
          `Subscription: ${payload.subscriptionId}\n` +
          `Reason: ${payload.reason || 'Max retries exhausted'}\n` +
          `${baseInfo}`
        );

      default:
        return (
          `📬 <b>Notification</b>\n\n` +
          `Event: ${String(payload.eventType)}\n` +
          `${baseInfo}`
        );
    }
  }
}
