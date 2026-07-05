import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, or, like, sql, desc, type SQL } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import {
  customers,
  subscriptions,
  plans,
  transactions,
  auditEvents,
} from '../database/schema';
import type { CustomerListFilterDto } from './dto/audit.dto';

@Injectable()
export class AuditService {
  constructor(@Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB) {}

  /**
   * Lists customers for a merchant with their most recent subscription status,
   * for the Disputes/audit customer picker. Supports search by email/id.
   */
  async listCustomers(merchantId: string, filters: CustomerListFilterDto) {
    const conditions: SQL[] = [eq(customers.merchantId, merchantId)];

    if (filters.search) {
      const term = `%${filters.search}%`;
      const searchCondition = or(
        like(customers.email, term),
        like(customers.id, term),
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const limitVal = filters.limit ? Number(filters.limit) : 20;
    const offsetVal = filters.offset ? Number(filters.offset) : 0;

    const rows = await this.db
      .select()
      .from(customers)
      .where(and(...conditions))
      .limit(limitVal)
      .offset(offsetVal)
      .orderBy(desc(customers.createdAt));

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(and(...conditions));

    const data = await Promise.all(
      rows.map(async (customer) => {
        const [latestSub] = await this.db
          .select({
            status: subscriptions.status,
            planName: plans.name,
            planAmount: plans.amount,
          })
          .from(subscriptions)
          .innerJoin(plans, eq(subscriptions.planId, plans.id))
          .where(eq(subscriptions.customerId, customer.id))
          .orderBy(desc(subscriptions.createdAt))
          .limit(1);

        return {
          id: customer.id,
          email: customer.email,
          createdAt: customer.createdAt,
          signupIp: customer.signupIp,
          signupUserAgent: customer.signupUserAgent,
          status: latestSub?.status ?? null,
          planName: latestSub?.planName ?? null,
          planAmount: latestSub?.planAmount ?? null,
        };
      }),
    );

    return {
      data,
      pagination: {
        total: countResult ? Number(countResult.count) : 0,
        limit: limitVal,
        offset: offsetVal,
      },
    };
  }

  /**
   * Full audit detail for a single customer: profile, signup footprint,
   * payment history (from transactions), and lifecycle timeline (from
   * audit_events). Used for the Disputes chargeback-evidence view.
   */
  async getCustomerAudit(merchantId: string, customerId: string) {
    const [customer] = await this.db
      .select()
      .from(customers)
      .where(
        and(eq(customers.id, customerId), eq(customers.merchantId, merchantId)),
      );

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const subs = await this.db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        planName: plans.name,
        planAmount: plans.amount,
        planInterval: plans.interval,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.customerId, customerId))
      .orderBy(desc(subscriptions.createdAt));

    const payments = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.customerId, customerId),
          eq(transactions.merchantId, merchantId),
        ),
      )
      .orderBy(desc(transactions.createdAt));

    const events = await this.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.customerId, customerId),
          eq(auditEvents.merchantId, merchantId),
        ),
      )
      .orderBy(desc(auditEvents.createdAt));

    return {
      customer: {
        id: customer.id,
        email: customer.email,
        createdAt: customer.createdAt,
        signupIp: customer.signupIp,
        signupUserAgent: customer.signupUserAgent,
      },
      subscriptions: subs,
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        status: p.status,
        nombaRef: p.nombaRef,
        createdAt: p.createdAt,
      })),
      timeline: events.map((e) => ({
        id: e.id,
        action: e.action,
        details: e.details,
        metadata: e.metadata ? (JSON.parse(e.metadata) as unknown) : null,
        createdAt: e.createdAt,
      })),
    };
  }
}
