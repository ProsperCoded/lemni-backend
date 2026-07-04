import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  renderOtpEmail(otpCode: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Confirm Your Unsubscribe Request</title>
        <style>
          body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background-color: #f4f6f8;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 10px rgba(0,0,0,0.05);
          }
          .header {
            background-color: #1a1a1a;
            padding: 30px;
            text-align: center;
          }
          .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 28px;
            letter-spacing: 1px;
          }
          .content {
            padding: 40px 30px;
            color: #333333;
            line-height: 1.6;
          }
          .content p {
            margin: 0 0 20px;
            font-size: 16px;
          }
          .otp-card {
            background-color: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 6px;
            padding: 20px;
            text-align: center;
            margin: 30px 0;
          }
          .otp-code {
            font-size: 36px;
            font-weight: bold;
            color: #111111;
            letter-spacing: 4px;
            margin: 0;
          }
          .footer {
            background-color: #f8f9fa;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #666666;
            border-top: 1px solid #e9ecef;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Lemni</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>We received a request to unsubscribe your email from your Lemni subscription. To complete this request, please use the following one-time verification code (OTP):</p>
            <div class="otp-card">
              <h2 class="otp-code">${otpCode}</h2>
            </div>
            <p>This code is valid for 10 minutes. If you did not request this, please ignore this email and your subscription will remain active.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Lemni. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
