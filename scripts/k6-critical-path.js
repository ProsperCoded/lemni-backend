// k6 single-VU walkthrough of the real critical path against a running
// `pnpm start:dev` server. No mocking — every request hits the real
// running app, real DB, real Nomba sandbox (via NombaClient).
//
// Usage:
//   k6 run scripts/k6-critical-path.js
//   BASE_URL=http://localhost:3000 k6 run scripts/k6-critical-path.js
//
// This script stops after generating checkout URLs — click them
// yourself, pay with a sandbox test card, then use the printed
// sessionId to check status manually (see docs/CRITICAL_PATH_TESTING.md).

import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, fail } from 'k6';

export const options = {
  vus: 1,
  iterations: 1,
  // Nomba sandbox calls can be slow; give the run room to breathe.
  duration: '2m',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TELEGRAM_BOT_SECRET =
  __ENV.TELEGRAM_BOT_SECRET || 'dev_telegram_bot_secret_change_me';

function jsonHeaders(extra) {
  return Object.assign({ 'Content-Type': 'application/json' }, extra || {});
}

function logStep(title) {
  console.log(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}`);
}

function assertOk(res, expectedStatus, label) {
  const ok = check(res, {
    [`${label}: status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
  });
  if (!ok) {
    console.error(`${label} FAILED\nStatus: ${res.status}\nBody: ${res.body}`);
    fail(`${label} did not return ${expectedStatus}`);
  }
  return res.json();
}

export default function () {
  const stamp = Date.now();
  const merchantEmail = `k6-merchant-${stamp}@lemni.com`;
  const merchantPassword = 'SecurePassword123!';

  // ── STEP 1: Signup ─────────────────────────────────────────────
  logStep('STEP 1: Merchant Signup');
  const signupBody = {
    email: merchantEmail,
    password: merchantPassword,
    name: 'K6 Test Merchant',
  };
  console.log('POST /auth/signup');
  console.log('Request:', JSON.stringify(signupBody, null, 2));

  const signupRes = http.post(
    `${BASE_URL}/auth/signup`,
    JSON.stringify(signupBody),
    { headers: jsonHeaders() },
  );
  const signupData = assertOk(signupRes, 201, 'Signup');
  console.log('Response:', JSON.stringify(signupData, null, 2));

  const merchantId = signupData.id;

  // ── STEP 2: Login ──────────────────────────────────────────────
  logStep('STEP 2: Merchant Login (get JWT)');
  const loginBody = { email: merchantEmail, password: merchantPassword };
  console.log('POST /auth/login');
  console.log('Request:', JSON.stringify(loginBody, null, 2));

  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify(loginBody),
    { headers: jsonHeaders() },
  );
  const loginData = assertOk(loginRes, 200, 'Login');
  console.log(
    'Response:',
    JSON.stringify(
      { ...loginData, accessToken: loginData.accessToken.slice(0, 40) + '...' },
      null,
      2,
    ),
  );

  const merchantJwt = loginData.accessToken;

  // ── STEP 3: Generate API key ───────────────────────────────────
  logStep('STEP 3: Generate API Key (test environment)');
  const apiKeyRes = http.post(
    `${BASE_URL}/admin/api-keys`,
    JSON.stringify({ environment: 'test' }),
    { headers: jsonHeaders({ Authorization: `Bearer ${merchantJwt}` }) },
  );
  const apiKeyData = assertOk(apiKeyRes, 201, 'API key generation');
  console.log(
    'Response:',
    JSON.stringify(
      { ...apiKeyData, rawKey: apiKeyData.rawKey.slice(0, 20) + '...' },
      null,
      2,
    ),
  );

  const apiKey = apiKeyData.rawKey;

  // ── STEP 4: Create a plan ──────────────────────────────────────
  logStep('STEP 4: Create Subscription Plan');
  const planBody = {
    name: 'K6 Premium Monthly',
    amount: 5000,
    billingModel: 'recurring',
    interval: 'monthly',
    trialDays: 0,
    gracePeriodDays: 3,
  };
  console.log('POST /admin/plans');
  console.log('Request:', JSON.stringify(planBody, null, 2));

  const planRes = http.post(`${BASE_URL}/admin/plans`, JSON.stringify(planBody), {
    headers: jsonHeaders({ Authorization: `Bearer ${merchantJwt}` }),
  });
  const planData = assertOk(planRes, 201, 'Plan creation');
  console.log('Response:', JSON.stringify(planData, null, 2));

  const planId = planData.id;

  // ── STEP 5A: One-time payment via developer API key ────────────
  logStep('STEP 5A: One-Time Payment (Developer API, real Nomba sandbox call)');
  const oneTimeBody = { amount: 10000, email: 'k6-onetime-customer@example.com' };
  console.log('POST /api/v1/pay');
  console.log('Request:', JSON.stringify(oneTimeBody, null, 2));

  const oneTimeRes = http.post(
    `${BASE_URL}/api/v1/pay`,
    JSON.stringify(oneTimeBody),
    { headers: jsonHeaders({ Authorization: `Bearer ${apiKey}` }) },
  );
  const oneTimeData = assertOk(oneTimeRes, 200, 'One-time payment');
  console.log('Response:', JSON.stringify(oneTimeData, null, 2));

  // ── STEP 5B: Public plan link checkout (no auth) ───────────────
  logStep('STEP 5B: Public Plan Link Checkout (no Authorization, real Nomba call)');
  const publicBody = { email: 'k6-subscriber@example.com' };
  console.log(`POST /api/v1/checkout/plans/${planId}/sessions`);
  console.log('Request:', JSON.stringify(publicBody, null, 2));

  const publicRes = http.post(
    `${BASE_URL}/api/v1/checkout/plans/${planId}/sessions`,
    JSON.stringify(publicBody),
    { headers: jsonHeaders() },
  );
  const publicData = assertOk(publicRes, 200, 'Public plan checkout');
  console.log('Response:', JSON.stringify(publicData, null, 2));

  // ── STEP 6: Connect Telegram (real HMAC signature) ─────────────
  logStep('STEP 6: Merchant Connects Telegram');
  const chatId = '999888777';
  const timestamp = String(Date.now());
  const signingString = `${merchantId}:${chatId}:${timestamp}`;
  const signature = crypto.hmac('sha256', TELEGRAM_BOT_SECRET, signingString, 'hex');

  const telegramBody = { merchantId, chatId, signature, timestamp };
  console.log('POST /api/v1/admin/telegram/connect');
  console.log('Request:', JSON.stringify(telegramBody, null, 2));

  const telegramRes = http.post(
    `${BASE_URL}/api/v1/admin/telegram/connect`,
    JSON.stringify(telegramBody),
    { headers: jsonHeaders() },
  );
  const telegramData = assertOk(telegramRes, 201, 'Telegram connect');
  console.log('Response:', JSON.stringify(telegramData, null, 2));

  // ── STEP 7: Confirm sessions are still pending (no payment yet) ─
  logStep('STEP 7: Confirm Checkout Sessions Are Pending (pre-payment)');

  const oneTimeStatusRes = http.get(
    `${BASE_URL}/api/v1/sessions/${oneTimeData.sessionId}/status`,
  );
  const oneTimeStatus = assertOk(oneTimeStatusRes, 200, 'One-time session status');
  console.log('One-time session status:', JSON.stringify(oneTimeStatus, null, 2));
  check(oneTimeStatus, {
    'One-time session is pending pre-payment': (s) => s.status === 'pending',
    'One-time session has a real nombaRef': (s) => !!s.nombaRef,
  });

  const subStatusRes = http.get(
    `${BASE_URL}/api/v1/sessions/${publicData.sessionId}/status`,
  );
  const subStatus = assertOk(subStatusRes, 200, 'Subscription session status');
  console.log('Subscription session status:', JSON.stringify(subStatus, null, 2));
  check(subStatus, {
    'Subscription session is pending pre-payment': (s) => s.status === 'pending',
    'Subscription session has a real nombaRef': (s) => !!s.nombaRef,
  });

  // ── SUMMARY ──────────────────────────────────────────────────
  logStep('SUMMARY — CLICK THESE TO PAY WITH A SANDBOX TEST CARD');
  console.log(`Merchant ID:        ${merchantId}`);
  console.log(`Merchant Email:     ${merchantEmail}`);
  console.log(`Plan ID:            ${planId}`);
  console.log('');
  console.log(`One-time payment session: ${oneTimeData.sessionId}`);
  console.log(`  Checkout URL: ${oneTimeData.checkoutUrl}`);
  console.log('');
  console.log(`Subscription session:     ${publicData.sessionId}`);
  console.log(`  Subscription ID: ${publicData.subscriptionId}`);
  console.log(`  Checkout URL: ${publicData.checkoutUrl}`);
  console.log('');
  console.log('After paying, check status with:');
  console.log(
    `  curl ${BASE_URL}/api/v1/sessions/${oneTimeData.sessionId}/status`,
  );
  console.log(
    `  curl ${BASE_URL}/api/v1/sessions/${publicData.sessionId}/status`,
  );
}
