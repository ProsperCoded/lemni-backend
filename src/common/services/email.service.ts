import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  renderResetPasswordOtpEmail,
  renderConfirmUnsubscribeOtpEmail,
  renderPaymentFailedAlertEmail,
  renderSubscriptionCanceledAlertEmail,
} from './email-templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string;
  private readonly senderEmail: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('RESEND_API_KEY') || '';
    this.senderEmail =
      this.configService.get<string>('RESEND_SENDER_EMAIL') ||
      'noreply@mail.uninav.tech';
  }

  /**
   * Core send method wrapping Resend API fetch.
   */
  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn(
        '[EmailService] RESEND_API_KEY is not set, logging email instead:',
      );
      this.logger.log(
        `To: ${to} | Subject: ${subject} | HTML length: ${html.length}`,
      );
      return false;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Lemni <${this.senderEmail}>`,
          to: [to],
          subject,
          html,
        }),
      });

      const data = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        this.logger.error(
          `[EmailService] Resend API error: ${JSON.stringify(data)}`,
        );
        return false;
      }

      this.logger.log(
        `[EmailService] Email sent successfully to ${to}. ID: ${data.id}`,
      );
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[EmailService] Failed to send email to ${to}: ${msg}`);
      return false;
    }
  }

  /**
   * Renders the confirm unsubscribe OTP code email.
   * Retained for simple backward compatibility.
   */
  renderOtpEmail(otpCode: string): string {
    return renderConfirmUnsubscribeOtpEmail(otpCode);
  }

  /**
   * Helper to send forgot password reset OTP.
   */
  async sendForgotPasswordOtp(to: string, code: string): Promise<boolean> {
    const html = renderResetPasswordOtpEmail(code);
    return this.sendEmail(to, 'Lemni - Reset Your Password', html);
  }

  /**
   * Helper to send confirm unsubscribe OTP.
   */
  async sendConfirmUnsubscribeOtp(to: string, code: string): Promise<boolean> {
    const html = renderConfirmUnsubscribeOtpEmail(code);
    return this.sendEmail(to, 'Lemni - Confirm your unsubscribe request', html);
  }

  /**
   * Helper to send payment failed alerts.
   */
  async sendPaymentFailedAlert(
    to: string,
    planName: string,
    amount: number,
    gracePeriodDays: number,
    subscriptionId?: string,
  ): Promise<boolean> {
    const html = renderPaymentFailedAlertEmail(
      to,
      planName,
      amount,
      gracePeriodDays,
      subscriptionId,
    );
    return this.sendEmail(to, 'Lemni - Payment Failed Alert', html);
  }

  /**
   * Helper to send subscription cancellation alerts.
   */
  async sendSubscriptionCanceledAlert(
    to: string,
    planName: string,
  ): Promise<boolean> {
    const html = renderSubscriptionCanceledAlertEmail(to, planName);
    return this.sendEmail(to, 'Lemni - Subscription Canceled', html);
  }
}
