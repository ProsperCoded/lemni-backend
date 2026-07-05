// Manual checkout script — creates a merchant, plan, and gives you checkout URLs
// Usage: BASE_URL=http://localhost:4000 k6 run scripts/manual-checkout.js

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 1,
  iterations: 1,
  duration: '2m',
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
  logStep('STEP 1: Create Merchant Account');
  const signupRes = http.post(
    `${BASE_URL}/auth/signup`,
    JSON.stringify({
      email: merchantEmail,
      password: merchantPassword,
      name: 'Test Merchant',
    }),
    { headers: jsonHeaders() },
  );
  check(signupRes, { 'Signup 201': (r) => r.status === 201 });
  const merchant = signupRes.json();
  console.log(`✓ Merchant created: ${merchantEmail}`);
  console.log(`  Merchant ID: ${merchant.id}`);

  const merchantId = merchant.id;

  // STEP 2: Login to get JWT
  logStep('STEP 2: Login');
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: merchantEmail, password: merchantPassword }),
    { headers: jsonHeaders() },
  );
  check(loginRes, { 'Login 200': (r) => r.status === 200 });
  const loginData = loginRes.json();
  const jwt = loginData.accessToken;
  console.log(`✓ Logged in, got JWT token`);

  // STEP 3: Create a plan
  logStep('STEP 3: Create a Subscription Plan');
  const planRes = http.post(
    `${BASE_URL}/admin/plans`,
    JSON.stringify({
      name: 'Premium Monthly',
      amount: 5000, // ₦5,000
      billingModel: 'recurring',
      interval: 'monthly',
      trialDays: 0,
      gracePeriodDays: 3,
    }),
    { headers: jsonHeaders({ Authorization: `Bearer ${jwt}` }) },
  );
  check(planRes, { 'Plan created 201': (r) => r.status === 201 });
  const plan = planRes.json();
  const planId = plan.id;
  console.log(`✓ Plan created: "${plan.name}"`);
  console.log(`  Plan ID: ${planId}`);
  console.log(`  Amount: ₦${plan.amount}`);

  // STEP 4: One-time payment (public, no auth)
  logStep('STEP 4: Create One-Time Payment Session');
  const oneTimeRes = http.post(
    `${BASE_URL}/api/v1/pay`,
    JSON.stringify({
      amount: 10000,
      email: 'customer-one-time@example.com',
    }),
    { headers: jsonHeaders() },
  );
  check(oneTimeRes, { 'One-time payment 200': (r) => r.status === 200 });
  const oneTime = oneTimeRes.json();
  console.log(`✓ One-time payment session created`);
  console.log(`  Session ID: ${oneTime.sessionId}`);
  console.log(`  Checkout URL: ${oneTime.checkoutUrl}`);

  // STEP 5: Subscription checkout (public, no auth)
  logStep('STEP 5: Create Subscription Checkout Session');
  const subRes = http.post(
    `${BASE_URL}/api/v1/checkout/plans/${planId}/sessions`,
    JSON.stringify({
      email: 'customer-subscription@example.com',
    }),
    { headers: jsonHeaders() },
  );
  check(subRes, { 'Subscription checkout 200': (r) => r.status === 200 });
  const subscription = subRes.json();
  console.log(`✓ Subscription checkout session created`);
  console.log(`  Session ID: ${subscription.sessionId}`);
  console.log(`  Subscription ID: ${subscription.subscriptionId}`);
  console.log(`  Checkout URL: ${subscription.checkoutUrl}`);

  // SUMMARY
  logStep('READY TO TEST — CLICK THESE LINKS AND PAY');
  console.log('');
  console.log('=== ONE-TIME PAYMENT ===');
  console.log(`URL: ${oneTime.checkoutUrl}`);
  console.log(`Session: ${oneTime.sessionId}`);
  console.log('Use test card: 4111 1111 1111 1111');
  console.log('');
  console.log('=== SUBSCRIPTION ===');
  console.log(`URL: ${subscription.checkoutUrl}`);
  console.log(`Session: ${subscription.sessionId}`);
  console.log(`Subscription: ${subscription.subscriptionId}`);
  console.log('Use test card: 4111 1111 1111 1111');
  console.log('');
  console.log('After you pay, the webhook should arrive and you\'ll see:');
  console.log('  - Raw webhook body logged');
  console.log('  - transactionId extracted');
  console.log('  - nombaRef lookup in database');
  console.log('  - Match or mismatch revealed');
  console.log('');
  console.log('Check backend logs:');
  console.log('  tail -f /tmp/backend.log | grep "Nomba Webhook"');
}
