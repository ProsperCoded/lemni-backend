// Live mode low-amount test — creates checkout for ₦100 (or lowest supported)
// Usage: BASE_URL=http://localhost:4000 k6 run scripts/live-low-amount.js

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 1,
  iterations: 1,
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

function jsonHeaders(extra) {
  return Object.assign({ 'Content-Type': 'application/json' }, extra || {});
}

function logStep(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

export default function () {
  const stamp = Date.now();
  const merchantEmail = `merchant-${stamp}@test.com`;
  const merchantPassword = 'SecurePassword123!';

  // STEP 1: Signup
  logStep('STEP 1: Create Merchant');
  const signupRes = http.post(
    `${BASE_URL}/auth/signup`,
    JSON.stringify({
      email: merchantEmail,
      password: merchantPassword,
      name: 'Live Test Merchant',
    }),
    { headers: jsonHeaders() },
  );
  check(signupRes, { 'Signup 201': (r) => r.status === 201 });
  const merchant = signupRes.json();
  const merchantId = merchant.id;
  console.log(`✓ Merchant: ${merchantEmail}`);
  console.log(`  ID: ${merchantId}`);

  // STEP 2: Login
  logStep('STEP 2: Login');
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: merchantEmail, password: merchantPassword }),
    { headers: jsonHeaders() },
  );
  check(loginRes, { 'Login 200': (r) => r.status === 200 });
  const jwt = loginRes.json().accessToken;
  console.log(`✓ Logged in`);

  // STEP 3: Create a low-amount plan (₦100)
  logStep('STEP 3: Create Low-Amount Plan (₦100)');
  const planRes = http.post(
    `${BASE_URL}/admin/plans`,
    JSON.stringify({
      name: 'Test Plan ₦100',
      amount: 100,
      billingModel: 'recurring',
      interval: 'monthly',
      trialDays: 0,
      gracePeriodDays: 0,
    }),
    { headers: jsonHeaders({ Authorization: `Bearer ${jwt}` }) },
  );
  check(planRes, { 'Plan created 201': (r) => r.status === 201 });
  const plan = planRes.json();
  const planId = plan.id;
  console.log(`✓ Plan created: "${plan.name}"`);
  console.log(`  Plan ID: ${planId}`);
  console.log(`  Amount: ₦${plan.amount}`);

  // STEP 4: Create subscription checkout
  logStep('STEP 4: Create Live Subscription Checkout (₦100)');
  const subRes = http.post(
    `${BASE_URL}/api/v1/checkout/plans/${planId}/sessions`,
    JSON.stringify({
      email: 'test-live@example.com',
    }),
    { headers: jsonHeaders() },
  );
  check(subRes, { 'Checkout 200': (r) => r.status === 200 });
  const subscription = subRes.json();
  console.log(`✓ Checkout session created`);
  console.log(`  Session ID: ${subscription.sessionId}`);
  console.log(`  Subscription ID: ${subscription.subscriptionId}`);

  // SUMMARY
  logStep('⚠️  LIVE MODE CHECKOUT — REAL MONEY ⚠️');
  console.log('');
  console.log(`Checkout URL: ${subscription.checkoutUrl}`);
  console.log(`Amount: ₦${plan.amount}`);
  console.log(`Session: ${subscription.sessionId}`);
  console.log(`Subscription: ${subscription.subscriptionId}`);
  console.log('');
  console.log('⚠️  THIS WILL CHARGE REAL MONEY TO THE CARD');
  console.log('⚠️  MAKE SURE AMOUNT (₦100) IS ACCEPTABLE');
  console.log('');
  console.log('After payment, watch logs:');
  console.log('  tail -f /tmp/backend.log | grep "Nomba Webhook"');
}
