import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DRIZZLE_PROVIDER } from '../src/database/database.provider';
import type { DrizzleDB } from '../src/database/database.provider';
import {
  merchants,
  plans,
  customers,
  subscriptions,
  dlqJobs,
} from '../src/database/schema';
import { BillingWorkerService } from '../src/scheduler/billing-worker.service';
import { CHARGE_QUEUE_TOKEN } from '../src/scheduler/scheduler.constants';
import { JwtService } from '@nestjs/jwt';
import { Queue } from 'bullmq';

describe('Scheduler Module (e2e)', () => {
  jest.setTimeout(30000);
  let app: INestApplication<App>;
  let db: DrizzleDB;
  let jwtToken: string;
  let billingWorker: BillingWorkerService;
  let chargeQueue: Queue;

  const MERCHANT_ID = 'sched-merchant-001';
  const TEST_MERCHANT = {
    id: MERCHANT_ID,
    name: 'Scheduler Test Merchant',
    email: 'sched@test.com',
    username: 'scheduler_test_merchant',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get<DrizzleDB>(DRIZZLE_PROVIDER);
    billingWorker =
      moduleFixture.get<BillingWorkerService>(BillingWorkerService);
    chargeQueue = moduleFixture.get<Queue>(CHARGE_QUEUE_TOKEN);
    const jwtService = moduleFixture.get<JwtService>(JwtService);

    // Seed merchant
    await db.delete(dlqJobs);
    await db.delete(subscriptions);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(merchants);
    await db.insert(merchants).values(TEST_MERCHANT);

    jwtToken = jwtService.sign({
      sub: MERCHANT_ID,
      email: TEST_MERCHANT.email,
    });
  });

  afterAll(async () => {
    await db.delete(dlqJobs);
    await db.delete(subscriptions);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(merchants);
    await app.close();
  });

  describe('BillingWorker cron (unit invocation)', () => {
    it('should enqueue due active subscriptions into ChargeQueue', async () => {
      // Seed plan, customer, and an overdue subscription
      const planId = 'sched-plan-001';
      const customerId = 'sched-cust-001';
      const subId = 'sched-sub-001';
      const overdueDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

      await db.insert(plans).values({
        id: planId,
        merchantId: MERCHANT_ID,
        name: 'Monthly Test Plan',
        amount: 15.0,
        billingModel: 'recurring',
        interval: 'monthly',
        trialDays: 0,
        trialRequireCard: false,
        gracePeriodDays: 3,
      });

      await db.insert(customers).values({
        id: customerId,
        merchantId: MERCHANT_ID,
        email: 'sched-sub@test.com',
        nombaToken: 'tok_test_abc123', // Has a token so it should be enqueued
      });

      await db.insert(subscriptions).values({
        id: subId,
        customerId,
        planId,
        status: 'active',
        currentPeriodEnd: overdueDate,
      });

      // Mock queue add to track calls
      const addCalls: any[] = [];
      const originalAdd = chargeQueue.add.bind(chargeQueue);
      chargeQueue.add = async (...args: any[]) => {
        addCalls.push(args);
        return { id: 'mocked-job-id' } as any;
      };

      // Run the billing cycle directly (without waiting for cron)
      await billingWorker.runBillingCycle();

      // Verify a job was enqueued for the overdue subscription
      const matchingJob = addCalls.find((args) => {
        const payload = args[1];
        return payload?.subscriptionId === subId;
      });
      expect(matchingJob).toBeDefined();
      expect(matchingJob[1].amount).toBe(15.0);
      expect(matchingJob[1].merchantId).toBe(MERCHANT_ID);

      // Restore
      chargeQueue.add = originalAdd;
    });

    it('should set past_due and skip enqueue for subscriptions without nombaToken', async () => {
      const planId = 'sched-plan-002';
      const customerId = 'sched-cust-002';
      const subId = 'sched-sub-002';
      const overdueDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      await db.insert(plans).values({
        id: planId,
        merchantId: MERCHANT_ID,
        name: 'Tokenless Plan',
        amount: 25.0,
        billingModel: 'recurring',
        interval: 'monthly',
        trialDays: 0,
        trialRequireCard: false,
        gracePeriodDays: 0,
      });

      await db.insert(customers).values({
        id: customerId,
        merchantId: MERCHANT_ID,
        email: 'no-token@test.com',
        nombaToken: null, // No card on file
      });

      await db.insert(subscriptions).values({
        id: subId,
        customerId,
        planId,
        status: 'active',
        currentPeriodEnd: overdueDate,
      });

      const addCalls: any[] = [];
      chargeQueue.add = async (...args: any[]) => {
        addCalls.push(args);
        return { id: 'mocked-job-id' } as any;
      };

      await billingWorker.runBillingCycle();

      // Sub with no token should NOT be enqueued
      const matchingJob = addCalls.find(
        (args) => args[1]?.subscriptionId === subId,
      );
      expect(matchingJob).toBeUndefined();

      // Should have been set to past_due
      const sub = await db.query.subscriptions.findFirst({
        where: (s: any, { eq }: any) => eq(s.id, subId),
      });
      expect(sub?.status).toBe('past_due');
    });

    it('should promote trialing subscription to active and enqueue charge when card present', async () => {
      const planId = 'sched-plan-003';
      const customerId = 'sched-cust-003';
      const subId = 'sched-sub-003';
      const expiredTrialDate = new Date(
        Date.now() - 60 * 60 * 1000,
      ).toISOString();

      await db.insert(plans).values({
        id: planId,
        merchantId: MERCHANT_ID,
        name: 'Trial Plan with Card',
        amount: 19.99,
        billingModel: 'recurring',
        interval: 'monthly',
        trialDays: 7,
        trialRequireCard: true,
        gracePeriodDays: 0,
      });

      await db.insert(customers).values({
        id: customerId,
        merchantId: MERCHANT_ID,
        email: 'trial-card@test.com',
        nombaToken: 'tok_trial_card_abc',
      });

      await db.insert(subscriptions).values({
        id: subId,
        customerId,
        planId,
        status: 'trialing',
        trialEnd: expiredTrialDate,
      });

      const addCalls: any[] = [];
      chargeQueue.add = async (...args: any[]) => {
        addCalls.push(args);
        return { id: 'mocked-job-id' } as any;
      };

      await billingWorker.runBillingCycle();

      // Subscription should be promoted to active
      const sub = await db.query.subscriptions.findFirst({
        where: (s: any, { eq }: any) => eq(s.id, subId),
      });
      expect(sub?.status).toBe('active');

      // A charge job should be enqueued
      const matchingJob = addCalls.find(
        (args) => args[1]?.subscriptionId === subId,
      );
      expect(matchingJob).toBeDefined();
    });

    it('should set trialing subscription to past_due when trial expires without card', async () => {
      const planId = 'sched-plan-004';
      const customerId = 'sched-cust-004';
      const subId = 'sched-sub-004';
      const expiredTrialDate = new Date(
        Date.now() - 60 * 60 * 1000,
      ).toISOString();

      await db.insert(plans).values({
        id: planId,
        merchantId: MERCHANT_ID,
        name: 'Trial Plan No Card',
        amount: 9.99,
        billingModel: 'recurring',
        interval: 'monthly',
        trialDays: 7,
        trialRequireCard: false,
        gracePeriodDays: 0,
      });

      await db.insert(customers).values({
        id: customerId,
        merchantId: MERCHANT_ID,
        email: 'trial-nocard@test.com',
        nombaToken: null,
      });

      await db.insert(subscriptions).values({
        id: subId,
        customerId,
        planId,
        status: 'trialing',
        trialEnd: expiredTrialDate,
      });

      const addCalls: any[] = [];
      chargeQueue.add = async (...args: any[]) => {
        addCalls.push(args);
        return { id: 'mocked-job-id' } as any;
      };

      await billingWorker.runBillingCycle();

      const sub = await db.query.subscriptions.findFirst({
        where: (s: any, { eq }: any) => eq(s.id, subId),
      });
      expect(sub?.status).toBe('past_due');

      // No charge job should be enqueued
      const matchingJob = addCalls.find(
        (args) => args[1]?.subscriptionId === subId,
      );
      expect(matchingJob).toBeUndefined();
    });
  });

  describe('GET /admin/dlq', () => {
    beforeEach(async () => {
      // Seed a DLQ job
      await db.insert(dlqJobs).values({
        id: 'dlq-test-001',
        subscriptionId: 'sched-sub-001',
        payload: JSON.stringify({
          subscriptionId: 'sched-sub-001',
          amount: 15.0,
          retryCount: 3,
          customerId: 'sched-cust-001',
          planId: 'sched-plan-001',
          merchantId: MERCHANT_ID,
        }),
        errorReason: 'Grace period exhausted after 3 retries',
        retryHistory: JSON.stringify([
          {
            attempt: 3,
            failedAt: new Date().toISOString(),
            reason: 'card_declined',
          },
        ]),
      });
    });

    afterEach(async () => {
      await db.delete(dlqJobs).execute?.();
    });

    it('should return DLQ entries for authenticated merchant (200)', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/dlq')
        .set('Authorization', 'Bearer ' + jwtToken)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].id).toBe('dlq-test-001');
      expect(response.body[0].errorReason).toBe(
        'Grace period exhausted after 3 retries',
      );
      expect(Array.isArray(response.body[0].retryHistory)).toBe(true);
    });

    it('should return 401 when no JWT token provided', async () => {
      await request(app.getHttpServer()).get('/admin/dlq').expect(401);
    });
  });

  describe('POST /admin/dlq/:jobId/replay', () => {
    beforeEach(async () => {
      await db.insert(dlqJobs).values({
        id: 'dlq-replay-001',
        subscriptionId: 'sched-sub-001',
        payload: JSON.stringify({
          subscriptionId: 'sched-sub-001',
          amount: 15.0,
          retryCount: 3,
          customerId: 'sched-cust-001',
          planId: 'sched-plan-001',
          merchantId: MERCHANT_ID,
        }),
        errorReason: 'Grace period exhausted',
        retryHistory: JSON.stringify([]),
      });
    });

    afterEach(async () => {
      await db.delete(dlqJobs).execute?.();
    });

    it('should re-enqueue DLQ job and return success (200)', async () => {
      // Mock chargeQueue add for this test
      const addCalls: any[] = [];
      chargeQueue.add = async (...args: any[]) => {
        addCalls.push(args);
        return { id: 'replayed-job-id' } as any;
      };

      const response = await request(app.getHttpServer())
        .post('/admin/dlq/dlq-replay-001/replay')
        .set('Authorization', 'Bearer ' + jwtToken)
        .expect(200);

      expect(response.body.enqueued).toBe(true);
      expect(response.body.jobId).toBe('dlq-replay-001');

      // Verify DLQ entry was removed
      const dlqEntry = await db.query.dlqJobs.findFirst({
        where: (d: any, { eq }: any) => eq(d.id, 'dlq-replay-001'),
      });
      expect(dlqEntry).toBeUndefined();
    });

    it('should return 404 for non-existent DLQ job', async () => {
      await request(app.getHttpServer())
        .post('/admin/dlq/nonexistent-job/replay')
        .set('Authorization', 'Bearer ' + jwtToken)
        .expect(404);
    });

    it('should return 401 when no JWT token provided', async () => {
      await request(app.getHttpServer())
        .post('/admin/dlq/dlq-replay-001/replay')
        .expect(401);
    });
  });
});
