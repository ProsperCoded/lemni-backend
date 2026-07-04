import {
  Injectable,
  Inject,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { plans, customers, subscriptions } from '../database/schema';
import { eq, and, sql } from 'drizzle-orm';
import * as crypto from 'crypto';

@Injectable()
export class BillingService {
  constructor(@Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB) {}

  /**
   * Creates a new pricing plan for a merchant.
   */
  async createPlan(
    merchantId: string,
    data: {
      name: string;
      amount: number;
      billingModel?: 'recurring' | 'one_time' | 'custom_input';
      interval?: 'weekly' | 'monthly' | 'yearly';
      trialDays?: number;
      trialRequireCard?: boolean;
      gracePeriodDays?: number;
    },
  ) {
    const planId = `plan_${crypto.randomBytes(8).toString('hex')}`;
    const [newPlan] = await this.db
      .insert(plans)
      .values({
        id: planId,
        merchantId,
        name: data.name,
        amount: data.amount,
        billingModel: data.billingModel || 'recurring',
        interval: data.interval,
        trialDays: data.trialDays || 0,
        trialRequireCard: data.trialRequireCard ?? false,
        gracePeriodDays: data.gracePeriodDays || 0,
      })
      .returning();

    return newPlan;
  }

  /**
   * Deletes a plan. Throws ForbiddenException if there are active subscriptions bound to it.
   */
  async deletePlan(merchantId: string, planId: string): Promise<void> {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.merchantId, merchantId)));

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    // Check for active or trialing subscriptions associated with this plan
    const activeSubs = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.planId, planId),
          sql`${subscriptions.status} IN ('active', 'trialing', 'past_due')`,
        ),
      );

    if (activeSubs.length > 0) {
      throw new ForbiddenException(
        'Cannot delete plan: customers have active subscriptions attached to it',
      );
    }

    await this.db.delete(plans).where(eq(plans.id, planId));
  }

  /**
   * Registers a customer under a merchant.
   */
  async registerCustomer(
    merchantId: string,
    data: { email: string; metadata?: any },
  ) {
    const customerId = `cust_${crypto.randomBytes(8).toString('hex')}`;
    const [customer] = await this.db
      .insert(customers)
      .values({
        id: customerId,
        merchantId,
        email: data.email,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      })
      .returning();

    return customer;
  }

  /**
   * Updates card tokenization details for a customer.
   */
  async updateCustomerToken(customerId: string, nombaToken: string) {
    const [updated] = await this.db
      .update(customers)
      .set({ nombaToken })
      .where(eq(customers.id, customerId))
      .returning();

    if (!updated) {
      throw new NotFoundException('Customer not found');
    }
    return updated;
  }

  /**
   * Evaluates subscription period against configured plan grace periods and handles status transitions.
   */
  async evaluateSubscriptionGracePeriod(
    subscriptionId: string,
  ): Promise<string> {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId));

    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }

    const [plan] = await this.db
      .select()
      .from(plans)
      .where(eq(plans.id, sub.planId));

    if (!sub.currentPeriodEnd) {
      return sub.status;
    }

    const periodEnd = new Date(sub.currentPeriodEnd);
    const now = new Date();

    if (now <= periodEnd) {
      return sub.status;
    }

    const gracePeriodDays = plan?.gracePeriodDays || 0;
    const gracePeriodEnd = new Date(
      periodEnd.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000,
    );

    let newStatus = sub.status;
    if (now > gracePeriodEnd) {
      newStatus = 'canceled';
    } else if (now > periodEnd && sub.status === 'active') {
      newStatus = 'past_due';
    }

    if (newStatus !== sub.status) {
      await this.db
        .update(subscriptions)
        .set({ status: newStatus })
        .where(eq(subscriptions.id, subscriptionId));
    }

    return newStatus;
  }

  /**
   * Reactivates a canceled subscription, resetting the billing cycle.
   */
  async reactivateSubscription(merchantId: string, subscriptionId: string) {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId));

    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }

    if (sub.status !== 'canceled') {
      throw new ForbiddenException('Subscription is not canceled');
    }

    // Verify customer exists and belongs to this merchant
    const [customer] = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, sub.customerId),
          eq(customers.merchantId, merchantId),
        ),
      );

    if (!customer) {
      throw new ForbiddenException('Customer access denied');
    }

    if (!customer.nombaToken) {
      throw new ForbiddenException(
        'Customer card token has expired or is missing; re-tokenization required',
      );
    }

    // Verify plan exists
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(eq(plans.id, sub.planId));

    if (!plan) {
      throw new NotFoundException(
        'The plan associated with this subscription has been deleted or archived',
      );
    }

    // Reset billing period start from today
    const now = new Date();
    let daysToAdd = 30;
    if (plan.interval === 'weekly') daysToAdd = 7;
    else if (plan.interval === 'yearly') daysToAdd = 365;

    const nextPeriodEnd = new Date(
      now.getTime() + daysToAdd * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [updated] = await this.db
      .update(subscriptions)
      .set({
        status: 'active',
        currentPeriodEnd: nextPeriodEnd,
        trialEnd: null,
      })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();

    return updated;
  }
}
