import {
  Injectable,
  Inject,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import {
  plans,
  customers,
  subscriptions,
  transactions,
} from '../database/schema';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import * as crypto from 'crypto';
import { CheckoutService } from '../checkout/checkout.service';
import type { TransactionFilterDto } from './dto/billing.dto';
import type { PublicPlanSessionDto } from '../checkout/dto/checkout.dto';

@Injectable()
export class BillingService {
  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    private readonly configService: ConfigService,
    private readonly checkoutService: CheckoutService,
  ) {}

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

  /**
   * Retrieves paginated and filtered transactions for a merchant.
   */
  async getTransactions(merchantId: string, filters: TransactionFilterDto) {
    const conditions = [eq(transactions.merchantId, merchantId)];

    if (filters.status) {
      conditions.push(eq(transactions.status, filters.status));
    }
    if (filters.customerId) {
      conditions.push(eq(transactions.customerId, filters.customerId));
    }
    if (filters.subscriptionId) {
      conditions.push(eq(transactions.subscriptionId, filters.subscriptionId));
    }
    if (filters.startDate) {
      conditions.push(gte(transactions.createdAt, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(transactions.createdAt, filters.endDate));
    }

    const limitVal = filters.limit ? Number(filters.limit) : 20;
    const offsetVal = filters.offset ? Number(filters.offset) : 0;

    const data = await this.db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .limit(limitVal)
      .offset(offsetVal)
      .orderBy(desc(transactions.createdAt));

    // Get total count for pagination metadata
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(...conditions));

    const total = countResult ? Number(countResult.count) : 0;

    return {
      data,
      pagination: {
        total,
        limit: limitVal,
        offset: offsetVal,
      },
    };
  }

  /**
   * Generate a shareable checkout link for a plan.
   * Merchants can share this URL without needing a website.
   */
  async getCheckoutLink(merchantId: string, planId: string) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.merchantId, merchantId)));

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const dashboardUrl = this.configService.get<string>(
      'DASHBOARD_URL',
      'http://localhost:5173',
    );

    const checkoutUrl = `${dashboardUrl}/checkout/${planId}`;

    return {
      checkoutUrl,
      planId,
    };
  }

  /**
   * Create a public checkout session for a plan.
   * Called when customer submits email on the public checkout page.
   */
  async createPublicCheckout(
    planId: string,
    data: PublicPlanSessionDto,
  ) {
    return this.checkoutService.createPublicPlanSession(planId, data);
  }

  /**
   * Request unsubscribe OTP - delegates to CheckoutService.
   */
  async requestUnsubscribe(subscriptionId: string, email: string) {
    return this.checkoutService.requestUnsubscribe(subscriptionId, email);
  }

  /**
   * Confirm unsubscribe with OTP - delegates to CheckoutService.
   */
  async confirmUnsubscribe(subscriptionId: string, code: string) {
    return this.checkoutService.confirmUnsubscribe(subscriptionId, code);
  }

  /**
   * Lists all plans for a merchant.
   */
  async listPlans(merchantId: string) {
    return this.db
      .select()
      .from(plans)
      .where(eq(plans.merchantId, merchantId));
  }

  /**
   * Updates an existing plan for a merchant.
   */
  async updatePlan(
    merchantId: string,
    planId: string,
    data: {
      name?: string;
      amount?: number;
      billingModel?: 'recurring' | 'one_time' | 'custom_input';
      interval?: 'weekly' | 'monthly' | 'yearly';
      trialDays?: number;
      trialRequireCard?: boolean;
      gracePeriodDays?: number;
    },
  ) {
    // Verify plan belongs to merchant
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.merchantId, merchantId)));

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const [updated] = await this.db
      .update(plans)
      .set(data)
      .where(eq(plans.id, planId))
      .returning();

    return updated;
  }

  /**
   * Get dashboard statistics for a merchant.
   */
  async getDashboardStats(merchantId: string) {
    // Get active subscriptions count (active or trialing)
    const [activeSubsResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.customerId, sql`(SELECT id FROM customers WHERE merchant_id = ${merchantId})`),
          sql`${subscriptions.status} IN ('active', 'trialing')`,
        ),
      );
    const activeSubscriptions = activeSubsResult
      ? Number(activeSubsResult.count)
      : 0;

    // Get MRR (monthly recurring revenue)
    // Sum amounts of active recurring subscriptions, normalized to monthly
    const [mrrResult] = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(
          CASE
            WHEN p.interval = 'weekly' THEN p.amount * 4.33
            WHEN p.interval = 'yearly' THEN p.amount / 12
            ELSE p.amount
          END
        ), 0)`,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(
        and(
          eq(plans.merchantId, merchantId),
          eq(subscriptions.status, 'active'),
          eq(plans.billingModel, 'recurring'),
        ),
      );
    const mrr = mrrResult ? Number(mrrResult.total) : 0;

    // Get churn rate (canceled this month / active at start of month)
    // For simplicity, use 0 if insufficient data
    const churnRate = 0;

    // Get recent volume (sum of successful transactions, last 30 days)
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [volumeResult] = await this.db
      .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.merchantId, merchantId),
          eq(transactions.status, 'success'),
          gte(transactions.createdAt, thirtyDaysAgo),
        ),
      );
    const recentVolume = volumeResult ? Number(volumeResult.total) : 0;

    return {
      mrr,
      activeSubscriptions,
      churnRate,
      recentVolume,
    };
  }
}
