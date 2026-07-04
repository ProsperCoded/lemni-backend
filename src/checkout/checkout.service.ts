import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { NombaClient } from '../provider/nomba.client';
import {
  customers,
  plans,
  subscriptions,
  transactions,
  merchants,
} from '../database/schema';
import { eq, and } from 'drizzle-orm';
import * as crypto from 'crypto';

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    private readonly nombaClient: NombaClient,
  ) {}

  /**
   * Helper to get or create a customer dynamically by email under a merchant.
   */
  private async getOrCreateCustomer(merchantId: string, email: string) {
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
      })
      .returning();

    return newCustomer;
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

    // Nomba checkout order payload
    const orderPayload = {
      order: {
        amount: data.amount,
        description: `One-time payment - LEMNI - ${transactionId}`,
        country: 'NG',
        currency: 'NGN',
        customerEmail: customer.email,
        callbackUrl,
      },
    };

    // Insert pending transaction record locally
    await this.db.insert(transactions).values({
      id: transactionId,
      amount: data.amount,
      status: 'pending',
    });

    try {
      const response = (await this.nombaClient.createCheckoutOrder(
        transactionId,
        orderPayload,
      )) as Record<string, unknown>;
      return {
        sessionId: transactionId,
        checkoutUrl: (response.data as Record<string, unknown>)
          .checkoutLink as string,
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
  ) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.id, data.planId), eq(plans.merchantId, merchantId)));

    if (!plan) {
      throw new NotFoundException('Pricing plan not found');
    }

    const customer = await this.getOrCreateCustomer(merchantId, data.email);
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
      subscriptionId,
      amount: plan.amount,
      status: 'pending',
    });

    const orderPayload = {
      order: {
        amount: plan.amount,
        description: `Subscription - ${plan.name} - ${subscriptionId}`,
        country: 'NG',
        currency: 'NGN',
        customerEmail: customer.email,
        callbackUrl,
      },
    };

    try {
      const response = (await this.nombaClient.createCheckoutOrder(
        transactionId,
        orderPayload,
      )) as Record<string, unknown>;
      return {
        sessionId: transactionId,
        subscriptionId,
        checkoutUrl: (response.data as Record<string, unknown>)
          .checkoutLink as string,
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
  ) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(eq(plans.id, planId));

    if (!plan) {
      throw new NotFoundException('Pricing plan not found');
    }

    return this.createSubscriptionPayment(plan.merchantId, 'live', {
      planId,
      email: data.email,
      callbackUrl: data.callbackUrl,
    });
  }
}
