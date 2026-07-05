import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { NombaClient } from '../provider/nomba.client';
import {
  customers,
  plans,
  subscriptions,
  transactions,
  merchants,
  otpVerifications,
  auditEvents,
} from '../database/schema';
import { eq, and, gte } from 'drizzle-orm';
import * as crypto from 'crypto';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    private readonly nombaClient: NombaClient,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Helper to get or create a customer dynamically by email under a merchant.
   * signupIp/signupUserAgent are only captured for browser-originated (public
   * plan link) signups — developer API-key flows would only record the
   * developer's server, not the real end customer.
   */
  private async getOrCreateCustomer(
    merchantId: string,
    email: string,
    signup?: { ip?: string; userAgent?: string },
  ) {
    const [existing] = await this.db
      .select()
      .from(customers)
      .where(
        and(eq(customers.email, email), eq(customers.merchantId, merchantId)),
      );

    if (existing) {
      return existing;
    }

    const customerId = `cust_${crypto.randomBytes(8).toString('hex')}`;
    const [newCustomer] = await this.db
      .insert(customers)
      .values({
        id: customerId,
        merchantId,
        email,
        signupIp: signup?.ip,
        signupUserAgent: signup?.userAgent,
      })
      .returning();

    return newCustomer;
  }

  /**
   * Writes a row to the audit trail. Best-effort — audit logging failures
   * must never block the actual billing operation.
   */
  private async logAuditEvent(event: {
    merchantId: string;
    customerId?: string;
    subscriptionId?: string;
    action: string;
    details?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.insert(auditEvents).values({
        id: `audit_${crypto.randomBytes(8).toString('hex')}`,
        merchantId: event.merchantId,
        customerId: event.customerId,
        subscriptionId: event.subscriptionId,
        action: event.action,
        details: event.details,
        metadata: event.metadata ? JSON.stringify(event.metadata) : undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Audit] Failed to log event ${event.action}: ${msg}`);
    }
  }

  /**
   * Helper to resolve the callback/redirect URL for the customer.
   */
  private async resolveCallbackUrl(
    merchantId: string,
    customCallback?: string,
  ): Promise<string> {
    if (customCallback) {
      return customCallback;
    }

    const [merchant] = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId));

    return merchant?.defaultRedirectUrl || 'https://lemni.com/checkout/success';
  }

  /**
   * Generates a checkout link for a one-time charge (POST /api/v1/pay)
   */
  async createOneTimePayment(
    merchantId: string,
    environment: 'test' | 'live',
    data: { amount: number; email: string; callbackUrl?: string },
  ) {
    const customer = await this.getOrCreateCustomer(merchantId, data.email);
    const callbackUrl = await this.resolveCallbackUrl(
      merchantId,
      data.callbackUrl,
    );

    const transactionId = `tx_${crypto.randomBytes(12).toString('hex')}`;
    const subAccountId = this.configService.get<string>('NOMBA_SUB_ACCOUNT_ID');

    // Nomba checkout order payload
    const orderPayload = {
      order: {
        amount: data.amount,
        description: `One-time payment - LEMNI - ${transactionId}`,
        country: 'NG',
        currency: 'NGN',
        customerEmail: customer.email,
        callbackUrl,
        subAccountId,
      },
    };

    // Insert pending transaction record locally
    await this.db.insert(transactions).values({
      id: transactionId,
      merchantId,
      customerId: customer.id,
      amount: data.amount,
      status: 'pending',
    });

    try {
      const response = (await this.nombaClient.createCheckoutOrder(
        transactionId,
        orderPayload,
      )) as Record<string, unknown>;
      const responseData = response.data as Record<string, unknown>;

      await this.db
        .update(transactions)
        .set({ nombaRef: responseData.orderReference as string })
        .where(eq(transactions.id, transactionId));

      return {
        sessionId: transactionId,
        checkoutUrl: responseData.checkoutLink as string,
      };
    } catch (error) {
      await this.db
        .update(transactions)
        .set({ status: 'failed' })
        .where(eq(transactions.id, transactionId));
      throw error;
    }
  }

  /**
   * Generates a checkout link for recurring subscriptions (POST /api/v1/subscribe)
   */
  async createSubscriptionPayment(
    merchantId: string,
    environment: 'test' | 'live',
    data: { planId: string; email: string; callbackUrl?: string },
    signup?: { ip?: string; userAgent?: string },
  ) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.id, data.planId), eq(plans.merchantId, merchantId)));

    if (!plan) {
      throw new NotFoundException('Pricing plan not found');
    }

    const isNewCustomerEmail = !(
      await this.db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.email, data.email),
            eq(customers.merchantId, merchantId),
          ),
        )
    )[0];

    const customer = await this.getOrCreateCustomer(
      merchantId,
      data.email,
      signup,
    );
    const callbackUrl = await this.resolveCallbackUrl(
      merchantId,
      data.callbackUrl,
    );

    const subscriptionId = `sub_${crypto.randomBytes(8).toString('hex')}`;
    const transactionId = `tx_${crypto.randomBytes(12).toString('hex')}`;

    const now = new Date();
    const trialEnd =
      plan.trialDays > 0
        ? new Date(
            now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000,
          ).toISOString()
        : null;

    // Create pending subscription record
    await this.db.insert(subscriptions).values({
      id: subscriptionId,
      customerId: customer.id,
      planId: plan.id,
      status: plan.trialDays > 0 ? 'trialing' : 'active',
      trialEnd,
    });

    // Create pending transaction record
    await this.db.insert(transactions).values({
      id: transactionId,
      merchantId,
      customerId: customer.id,
      subscriptionId,
      amount: plan.amount,
      status: 'pending',
    });

    if (isNewCustomerEmail) {
      await this.logAuditEvent({
        merchantId,
        customerId: customer.id,
        subscriptionId,
        action: 'customer_registered',
        details: `Customer registered via checkout for plan "${plan.name}"`,
      });
    }

    await this.logAuditEvent({
      merchantId,
      customerId: customer.id,
      subscriptionId,
      action: plan.trialDays > 0 ? 'trial_started' : 'subscription_created',
      details:
        plan.trialDays > 0
          ? `Started ${plan.trialDays}-day trial for plan "${plan.name}"`
          : `Subscription created for plan "${plan.name}" (₦${plan.amount})`,
    });

    // Recurring subscriptions must be charged automatically on renewal,
    // so the first checkout is restricted to Card (no bank Transfer) and
    // requests Nomba to tokenize the card. The token arrives later via
    // the payment_success webhook (see webhook.service.ts) and is stored
    // on customers.nombaToken for use by DunningWorkerService.
    const subAccountId = this.configService.get<string>('NOMBA_SUB_ACCOUNT_ID');
    const orderPayload = {
      order: {
        amount: plan.amount,
        description: `Subscription - ${plan.name} - ${subscriptionId}`,
        country: 'NG',
        currency: 'NGN',
        customerEmail: customer.email,
        callbackUrl,
        allowedPaymentMethods: ['Card'],
        subAccountId,
      },
      tokenizeCard: true,
    };

    try {
      const response = (await this.nombaClient.createCheckoutOrder(
        transactionId,
        orderPayload,
      )) as Record<string, unknown>;
      const responseData = response.data as Record<string, unknown>;

      await this.db
        .update(transactions)
        .set({ nombaRef: responseData.orderReference as string })
        .where(eq(transactions.id, transactionId));

      return {
        sessionId: transactionId,
        subscriptionId,
        checkoutUrl: responseData.checkoutLink as string,
      };
    } catch (error) {
      await this.db
        .update(transactions)
        .set({ status: 'failed' })
        .where(eq(transactions.id, transactionId));
      throw error;
    }
  }

  /**
   * Fetches the current status of a specific checkout session
   */
  async getCheckoutSessionStatus(sessionId: string) {
    const [tx] = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, sessionId));

    if (!tx) {
      throw new NotFoundException('Checkout session not found');
    }

    return {
      sessionId: tx.id,
      amount: tx.amount,
      status: tx.status,
      nombaRef: tx.nombaRef,
      createdAt: tx.createdAt,
    };
  }

  /**
   * Public endpoint to checkout a plan (supporting off-the-shelf URL links)
   */
  async createPublicPlanSession(
    planId: string,
    data: { email: string; callbackUrl?: string },
    signup?: { ip?: string; userAgent?: string },
  ) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(eq(plans.id, planId));

    if (!plan) {
      throw new NotFoundException('Pricing plan not found');
    }

    return this.createSubscriptionPayment(
      plan.merchantId,
      'live',
      {
        planId,
        email: data.email,
        callbackUrl: data.callbackUrl,
      },
      signup,
    );
  }

  /**
   * Request unsubscribe by generating and sending a 6-digit OTP code.
   */
  async requestUnsubscribe(subscriptionId: string, email: string) {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId));

    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }

    const [customer] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.id, sub.customerId));

    if (!customer || customer.email !== email) {
      throw new ForbiddenException(
        'Email does not match subscription customer',
      );
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Clean up past OTPs
    await this.db
      .delete(otpVerifications)
      .where(eq(otpVerifications.subscriptionId, subscriptionId));

    // Save OTP
    const id = `otp_${crypto.randomBytes(8).toString('hex')}`;
    await this.db.insert(otpVerifications).values({
      id,
      subscriptionId,
      code,
      expiresAt,
    });

    // Send email via modular template
    await this.emailService.sendConfirmUnsubscribeOtp(email, code);

    return {
      success: true,
      message: 'Verification code sent to your email.',
    };
  }

  /**
   * Confirm unsubscribe using OTP code.
   */
  async confirmUnsubscribe(subscriptionId: string, code: string) {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId));

    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }

    if (sub.status === 'canceled') {
      throw new BadRequestException('Subscription is already canceled');
    }

    const now = new Date().toISOString();
    const [otpRecord] = await this.db
      .select()
      .from(otpVerifications)
      .where(
        and(
          eq(otpVerifications.subscriptionId, subscriptionId),
          eq(otpVerifications.code, code),
          gte(otpVerifications.expiresAt, now),
        ),
      );

    if (!otpRecord) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Cancel subscription
    await this.db
      .update(subscriptions)
      .set({ status: 'canceled' })
      .where(eq(subscriptions.id, subscriptionId));

    // Clean up OTP
    await this.db
      .delete(otpVerifications)
      .where(eq(otpVerifications.id, otpRecord.id));

    const [plan] = await this.db
      .select()
      .from(plans)
      .where(eq(plans.id, sub.planId));

    if (plan) {
      await this.logAuditEvent({
        merchantId: plan.merchantId,
        customerId: sub.customerId,
        subscriptionId,
        action: 'subscription_canceled',
        details: 'Customer self-canceled subscription via self-service page',
      });
    }

    return {
      success: true,
      message: 'Subscription successfully canceled.',
    };
  }

  /**
   * Generates a tokenization-only checkout for customer to update payment method.
   * No charge is made; only card token is captured.
   */
  async updatePaymentMethod(subscriptionId: string, email: string) {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId));

    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }

    if (sub.status === 'canceled') {
      throw new BadRequestException(
        'Cannot update payment method for a canceled subscription',
      );
    }

    const customer = await this.db.query.customers.findFirst({
      where: eq(customers.id, sub.customerId),
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.email !== email) {
      throw new BadRequestException('Email does not match subscription owner');
    }

    const plan = await this.db.query.plans.findFirst({
      where: eq(plans.id, sub.planId),
    });

    if (!plan) {
      throw new NotFoundException('Associated plan not found');
    }

    const sessionId = `card_upd_${crypto.randomBytes(12).toString('hex')}`;
    const subAccountId = this.configService.get<string>('NOMBA_SUB_ACCOUNT_ID');

    const orderPayload = {
      order: {
        description: `Card Update - ${plan.name} - ${subscriptionId}`,
        country: 'NG',
        currency: 'NGN',
        customerEmail: customer.email,
        allowedPaymentMethods: ['Card'],
        subAccountId,
      },
      tokenizeCard: true,
    };

    this.logger.log(
      `[CardUpdate] Generating tokenization checkout for subscription ${subscriptionId}`,
    );

    try {
      const response = (await this.nombaClient.createCheckoutOrder(
        sessionId,
        orderPayload,
      )) as Record<string, unknown>;
      const responseData = response.data as Record<string, unknown>;

      this.logger.log(
        `[CardUpdate] Checkout generated successfully. Session: ${sessionId}`,
      );

      return {
        sessionId,
        checkoutUrl: responseData.checkoutLink as string,
      };
    } catch (error) {
      this.logger.error(
        `[CardUpdate] Failed to generate checkout for subscription ${subscriptionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get plan details for public display on checkout page.
   */
  async getPlanDetails(planId: string) {
    const [plan] = await this.db
      .select({
        name: plans.name,
        amount: plans.amount,
        billingModel: plans.billingModel,
        interval: plans.interval,
        trialDays: plans.trialDays,
      })
      .from(plans)
      .where(eq(plans.id, planId));

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    return plan;
  }
}
