/**
 * Clean, modular, and professional HTML email templates for Lemni PaaS.
 * Uses Google Fonts (Outfit), modern slate/indigo styling, and reusable layout components.
 */

interface BaseLayoutOptions {
  title: string;
  preheader?: string;
}

/**
 * Reusable HTML layout wrapper with a premium design aesthetic.
 */
export function renderBaseLayout(
  options: BaseLayoutOptions,
  contentHtml: string,
): string {
  const currentYear = new Date().getFullYear();
  const preheaderHtml = options.preheader
    ? `<span style="display: none; max-height: 0px; overflow: hidden;">${options.preheader}</span>`
    : '';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${options.title}</title>
      <style>
        /* Modern reset & typography */
        body {
          margin: 0;
          padding: 0;
          background-color: #F8FAFC;
          font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        td {
          padding: 0;
        }
        img {
          border: 0;
          display: block;
          outline: none;
          text-decoration: none;
        }
        /* Layout structures */
        .wrapper {
          width: 100%;
          background-color: #F8FAFC;
          padding: 40px 0;
        }
        .container {
          max-width: 580px;
          margin: 0 auto;
          background-color: #FFFFFF;
          border: 1px solid #E2E8F0;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03);
        }
        /* Brand Header */
        .header {
          background-color: #0F172A;
          padding: 32px;
          text-align: center;
        }
        .header h1 {
          color: #F8FAFC;
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.025em;
        }
        .header-subtitle {
          color: #94A3B8;
          font-size: 13px;
          margin-top: 4px;
          font-weight: 400;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        /* Content body */
        .body {
          padding: 40px 32px;
        }
        .title {
          font-size: 22px;
          font-weight: 700;
          color: #0F172A;
          margin-top: 0;
          margin-bottom: 16px;
          line-height: 1.3;
        }
        .paragraph {
          font-size: 16px;
          line-height: 1.6;
          color: #334155;
          margin-top: 0;
          margin-bottom: 24px;
        }
        /* Components */
        .card {
          background-color: #F1F5F9;
          border: 1px solid #E2E8F0;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 24px;
          text-align: center;
        }
        .otp-code {
          font-size: 38px;
          font-weight: 800;
          color: #0F172A;
          letter-spacing: 6px;
          margin: 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        .button {
          display: inline-block;
          background-color: #4F46E5;
          color: #FFFFFF;
          font-weight: 600;
          font-size: 15px;
          text-decoration: none;
          padding: 12px 32px;
          border-radius: 8px;
          margin-bottom: 24px;
          text-align: center;
        }
        /* Footer */
        .footer {
          padding: 0 32px 32px 32px;
          text-align: center;
        }
        .footer-text {
          font-size: 13px;
          line-height: 1.5;
          color: #64748B;
          margin: 0;
        }
        .divider {
          border-top: 1px solid #E2E8F0;
          margin: 0 32px 24px 32px;
        }
      </style>
      <!-- Load Outfit font -->
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
    </head>
    <body>
      ${preheaderHtml}
      <div class="wrapper">
        <div class="container">
          <div class="header">
            <h1>Lemni</h1>
            <div class="header-subtitle">Billing & Security</div>
          </div>
          <div class="body">
            ${contentHtml}
          </div>
          <div class="divider"></div>
          <div class="footer">
            <p class="footer-text">
              &copy; ${currentYear} Lemni PaaS. All rights reserved.<br>
              This is an automated transaction email. Please do not reply.
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Reset password OTP template.
 */
export function renderResetPasswordOtpEmail(code: string): string {
  const content = `
    <h2 class="title">Reset Your Password</h2>
    <p class="paragraph">
      We received a request to reset your password. Use the following one-time verification code (OTP) to proceed:
    </p>
    <div class="card">
      <div class="otp-code">${code}</div>
    </div>
    <p class="paragraph" style="font-size: 14px; color: #64748B; margin-bottom: 0;">
      This code is valid for 10 minutes. If you did not request this, you can safely ignore this email.
    </p>
  `;
  return renderBaseLayout(
    {
      title: 'Lemni - Reset Your Password',
      preheader: 'Your password reset code has arrived.',
    },
    content,
  );
}

/**
 * Confirm unsubscribe OTP template.
 */
export function renderConfirmUnsubscribeOtpEmail(code: string): string {
  const content = `
    <h2 class="title">Confirm Your Request</h2>
    <p class="paragraph">
      We received a request to unsubscribe this email from your Lemni subscription. To complete this action, please enter the following one-time verification code:
    </p>
    <div class="card">
      <div class="otp-code">${code}</div>
    </div>
    <p class="paragraph" style="font-size: 14px; color: #64748B; margin-bottom: 0;">
      This code is valid for 10 minutes. If you did not request this, ignore this email and your subscription will remain active.
    </p>
  `;
  return renderBaseLayout(
    {
      title: 'Lemni - Confirm Unsubscribe Request',
      preheader: 'Verification code for your unsubscribe request.',
    },
    content,
  );
}

/**
 * Failed subscription notification template.
 */
export function renderPaymentFailedAlertEmail(
  customerEmail: string,
  planName: string,
  amount: number,
  gracePeriodDays: number,
  subscriptionId?: string,
): string {
  const formattedAmount = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amount);

  const graceText =
    gracePeriodDays > 0
      ? `We have initiated a grace period of <strong>${gracePeriodDays} days</strong> to keep your access active while you resolve this.`
      : `To prevent service interruption, please update your billing details immediately.`;

  const cardUpdateLink = subscriptionId
    ? `https://lemni.app/update-payment?subscription=${subscriptionId}&email=${encodeURIComponent(customerEmail)}`
    : null;

  const content = `
    <h2 class="title" style="color: #DC2626;">Payment Failed</h2>
    <p class="paragraph">
      Hello,
    </p>
    <p class="paragraph">
      We were unable to process your recurring payment of <strong>${formattedAmount}</strong> for your <strong>${planName}</strong> subscription.
    </p>
    <div class="card" style="text-align: left; background-color: #FEF2F2; border-color: #FCA5A5; padding: 20px;">
      <p style="margin: 0 0 8px; color: #991B1B; font-weight: 600;">Status: Action Required</p>
      <p style="margin: 0; color: #7F1D1D; font-size: 15px;">
        ${graceText}
      </p>
    </div>
    <p class="paragraph">
      Common reasons include insufficient funds, expired card, or bank declines. Please update your payment method:
    </p>
    ${
      cardUpdateLink
        ? `
    <div style="text-align: center; margin: 24px 0;">
      <a href="${cardUpdateLink}" class="button" style="background-color: #059669; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Update Payment Method</a>
    </div>
    `
        : ''
    }
    <p class="paragraph">
      If no action is taken, your subscription may be suspended or canceled automatically.
    </p>
  `;

  return renderBaseLayout(
    {
      title: 'Lemni - Payment Failed Notification',
      preheader: 'Payment failed for your subscription.',
    },
    content,
  );
}

/**
 * Subscription Canceled alert template.
 */
export function renderSubscriptionCanceledAlertEmail(
  customerEmail: string,
  planName: string,
): string {
  const content = `
    <h2 class="title">Subscription Canceled</h2>
    <p class="paragraph">
      Hello,
    </p>
    <p class="paragraph">
      Your subscription to <strong>${planName}</strong> has been successfully canceled and is now inactive.
    </p>
    <div class="card" style="text-align: left; background-color: #F8FAFC; border-color: #E2E8F0; padding: 20px;">
      <p style="margin: 0; color: #475569; font-size: 15px;">
        If this was a mistake or you wish to reactivate your subscription, you can start a new checkout session anytime or contact support.
      </p>
    </div>
    <p class="paragraph">
      Thank you for being with Lemni.
    </p>
  `;

  return renderBaseLayout(
    {
      title: 'Lemni - Subscription Canceled',
      preheader: 'Your subscription has been canceled.',
    },
    content,
  );
}
