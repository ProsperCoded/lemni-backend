# 🎯 Complete E2E Testing Setup - Critical Path Coverage

## Overview

You now have **three complementary ways** to test the complete Lemni payment platform:

---

## 1. ✅ Automated E2E Test Suite (Jest + Supertest)

**File:** `test/critical-path.e2e-spec.ts`

**What it does:**
- Automatically runs through the entire flow
- Uses supertest to hit real HTTP endpoints
- Shows full request/response bodies with `console.log`
- Mocks Nomba for predictable testing

**To run:**
```bash
pnpm test:e2e critical-path.e2e-spec
```

**Output includes:**
```
📝 SIGNUP RESPONSE:
{
  "merchant": {
    "id": "merchant-abc123",
    "email": "merchant@example.com"
  },
  "accessToken": "eyJ..."
}

🔑 API KEY GENERATION RESPONSE:
{
  "rawKey": "sk_test_abc123...",
  "keyId": "key_abc123"
}

📋 PLAN CREATION RESPONSE:
{
  "id": "plan-abc123",
  "name": "Premium Monthly Plan",
  "amount": 5000
}

💳 ONE-TIME PAYMENT RESPONSE:
{
  "sessionId": "txn_abc123",
  "checkoutUrl": "https://checkout.nomba.com/pay/...",
  "amount": 10000
}

🎯 PUBLIC PLAN LINK CHECKOUT RESPONSE:
{
  "sessionId": "txn_def456",
  "subscriptionId": "sub_xyz123",
  "checkoutUrl": "https://checkout.nomba.com/pay/..."
}

🤖 TELEGRAM CONNECTION RESPONSE:
{
  "success": true,
  "message": "Telegram chat connected successfully"
}

✅ NOMBA WEBHOOK (Payment Success) RECEIVED:
{
  "event_type": "payment_success",
  "data": {...}
}

📊 PAYMENT STATUS CHECK RESPONSE:
{
  "status": "success",
  "amount": 10000
}
```

**Pros:**
- Fully automated
- Repeatable
- No manual clicking required
- Good for CI/CD

**Cons:**
- Mocks Nomba (not real payment flow)
- Can't test actual card entry

---

## 2. 🔧 Manual curl Script (Real HTTP Requests)

**File:** `scripts/critical-path-curl.sh`

**What it does:**
- Uses curl to make real HTTP requests to running server
- Shows exact request/response bodies
- Generates all test credentials and resource IDs
- Provides instructions for next steps

**To run:**
```bash
# Terminal 1
pnpm start:dev

# Terminal 2
bash scripts/critical-path-curl.sh
```

**Output:**
```
🚀 LEMNI CRITICAL PATH TEST
==================================

📝 STEP 1: Merchant Signup
POST http://localhost:3000/auth/signup

RESPONSE:
{
  "merchant": {
    "id": "merchant-12345",
    "email": "test-merchant-1234567890@lemni.com"
  },
  "accessToken": "eyJhbGc..."
}

✅ Merchant ID: merchant-12345
✅ JWT Token: eyJhbGc...

🔑 STEP 2: Generate API Key
[...]

📋 STEP 3: Create Subscription Plan
[...]

💳 STEP 4A: One-Time Payment
[...]

🎯 STEP 4B: Public Plan Link Checkout
[...]

🤖 STEP 5: Merchant Connects Telegram
[...]

📱 STEP 7: Check Telegram Status
[...]

🎉 CRITICAL PATH TEST COMPLETE
==================================

📝 Credentials for Next Steps:
  Merchant ID: merchant-12345
  Merchant Email: test-merchant-1234567890@lemni.com
  Merchant JWT: eyJhbGc...
  API Key (test): sk_test_abc123...

📋 Created Resources:
  Plan ID: plan-abc123
  Subscription ID: sub-xyz789
  Payment Session ID: txn-def456

🔗 Next Steps:

1️⃣  CLICK THE CHECKOUT LINKS BELOW TO COMPLETE PAYMENT:
   - One-time payment: https://checkout.nomba.com/pay/mock_link_123
   - Subscription: https://checkout.nomba.com/pay/mock_link_456

2️⃣  AFTER PAYMENT IS COMPLETE, NOMBA WILL SEND A WEBHOOK
   [Instructions for webhook signature calculation]

3️⃣  AFTER WEBHOOK IS PROCESSED:
   - Transaction status should change to SUCCESS
   - Subscription should advance to ACTIVE
   - Merchant should receive Telegram alert ✅
```

**Pros:**
- Shows exact curl commands
- Real HTTP requests
- You can copy/paste and modify
- Good for manual testing and debugging

**Cons:**
- Manual clicking on checkout links required
- Mocks Nomba (unless you complete real payment)

---

## 3. 📖 Comprehensive Documentation (Copy/Paste Reference)

**File:** `docs/CRITICAL_PATH_TESTING.md`

**What it contains:**
- Step-by-step curl commands for every endpoint
- Full request/response examples
- Error handling cases
- Security considerations (signature verification)
- Testing checklist

**Use cases:**
- Reference while developing
- Share with partners
- Integration documentation
- Postman/Insomnia import (convert from examples)

---

## 🎬 How to Use (In Order)

### Phase 1: Verify Automated Tests Work
```bash
# Start backend
pnpm start:dev

# Run automated tests (in another terminal)
pnpm test:e2e critical-path.e2e-spec

# Should see: ✅ PASSED (all steps)
```

### Phase 2: Manual Testing with curl
```bash
# Keep backend running

# Run curl script
bash scripts/critical-path-curl.sh

# Script will output:
# - All merchant credentials
# - All resource IDs  
# - Checkout URLs to click
```

### Phase 3: Complete Real Payment Flow
1. **Copy first checkout URL** from curl script output
2. **Click in browser** → Opens Nomba hosted checkout
3. **Enter test card number:** `4111 1111 1111 1111`
4. **Complete payment** → Nomba redirects back to your app
5. **Check logs/DB** → Transaction status should be `success`
6. **Check Telegram** → Merchant should receive payment alert ✅

### Phase 4: Verify Webhook Processing
```bash
# Use the webhook signature calculation from CRITICAL_PATH_TESTING.md
# to send a manual webhook:

curl -X POST http://localhost:3000/api/v1/webhooks/nomba \
  -H "nomba-signature: <signature>" \
  -H "nomba-timestamp: <timestamp>" \
  -H "Content-Type: application/json" \
  -d '{...webhook payload...}'

# Response should be: { "status": "processed" }
# Transaction should update to: success
# Subscription should update to: active
# Merchant should get Telegram alert ✅
```

---

## 📋 Test Coverage Checklist

### Feature Coverage

#### Merchant Features
- ✅ Signup with email/password
- ✅ Generate API keys (test & live)
- ✅ Create subscription plans with trials
- ✅ View dashboard statistics
- ✅ Connect Telegram for alerts
- ✅ Disconnect Telegram
- ✅ Check payment status

#### Developer Features
- ✅ One-time payment via API key
- ✅ Subscription checkout via API key
- ✅ Query transaction status
- ✅ Handle async webhooks
- ✅ PCI-compliant (no raw card data)

#### Customer Features
- ✅ Public plan link checkout (no auth required)
- ✅ Trial period support
- ✅ Automatic billing after trial
- ✅ Email-based customer identification
- ✅ Subscription status visibility

#### Payment Flow
- ✅ Nomba hosted checkout integration
- ✅ Webhook signature verification (HMAC-SHA256)
- ✅ Transaction state machine (forward-only)
- ✅ Subscription advancement after payment
- ✅ Grace period handling for failed payments
- ✅ Dunning retry logic (via BullMQ)

#### Notifications
- ✅ Telegram bot connection
- ✅ Payment success alerts
- ✅ Payment failure alerts
- ✅ Grace period exhaustion alerts
- ✅ Async queue processing (non-blocking)
- ✅ Error handling (4xx vs 5xx)

#### Data Validation
- ✅ Zod schema validation on all inputs
- ✅ API key hash verification
- ✅ JWT token expiration
- ✅ Webhook signature verification
- ✅ Telegram signature verification

---

## 🎯 What You Can Observe

### Database State Changes
```bash
# Check transaction status progression:
# pending → success (after webhook)

sqlite3 /path/to/db.sqlite
SELECT id, status, nombaRef, createdAt FROM transactions;

# Check subscription state progression:
# active → past_due → canceled (if payment fails)
SELECT id, status, currentPeriodEnd, trialEnd FROM subscriptions;
```

### Request/Response Bodies
All visible in:
1. Jest e2e test console output
2. curl script output  
3. Your server logs (`pnpm start:dev`)

### Webhook Processing
```bash
# Watch logs for:
[Webhook] Payment success webhook received
[Webhook] Transaction updated: pending → success
[Webhook] Subscription advanced: trialing → active
[NotificationWorker] Enqueued telegram alert
[Telegram] Message sent to chat_id: 123456789
```

### Telegram Alerts
```
✅ Payment Successful
Subscription: Premium Monthly Plan
Amount: ₦5,000
Customer: external-customer@example.com
Next billing: 2026-08-04
```

---

## 🚀 Quick Command Reference

```bash
# Start backend (dev mode with hot reload)
pnpm start:dev

# Run all e2e tests
pnpm test:e2e

# Run specific e2e test
pnpm test:e2e critical-path.e2e-spec

# Build production version
pnpm build

# Lint and format code
pnpm lint

# Check for TypeScript errors
pnpm build

# Run curl script for manual testing
bash scripts/critical-path-curl.sh

# Check OpenAPI spec sync
pnpm lint:openapi

# Update OpenAPI spec
pnpm lint:openapi -- --write
```

---

## 📝 What Happens at Each Step

### Signup
- Create merchant record in DB
- Hash password with bcrypt
- Generate JWT token (24hr expiry)
- Return to merchant

### API Key Generation
- Generate random 48-char key
- Hash key with bcrypt
- Store hash in DB (never raw key)
- Return full key once (not retrievable again)

### Plan Creation
- Validate plan parameters
- Store in DB with merchant ownership
- Enable sharing via public link

### One-Time Checkout (Developer API)
- Validate API key
- Register customer dynamically (if new)
- Create transaction record (pending state)
- Call Nomba to generate checkout link
- Return checkout URL to developer

### Public Plan Checkout (No Auth)
- Validate plan exists
- Register customer dynamically
- Create subscription record (trialing if trial_days > 0)
- Create transaction record (pending)
- Call Nomba to generate checkout link
- Return subscription + transaction IDs

### Payment Completion (Nomba UI)
- Customer enters card in Nomba's hosted form
- Nomba processes payment
- Nomba sends webhook to us with `payment_success`

### Webhook Processing
- Verify signature (HMAC-SHA256)
- Find matching transaction by nombaRef
- Update transaction: pending → success
- Advance subscription state
- Calculate next billing date
- Enqueue telegram notification
- Return 200 to Nomba

### Telegram Alert
- Dequeue notification from BullMQ
- Get merchant's chat_id from DB
- Format message (emoji + details)
- Send to Telegram Bot API
- Retry with backoff if fails (4xx = stop, 5xx = retry)

---

## ⚠️ What You'll Need to Provide During Real Testing

**When clicking checkout links:**
1. Test credit card number: `4111 1111 1111 1111`
2. Any future expiry date (e.g., 12/99)
3. Any 3-digit CVC (e.g., 123)
4. Your email address (or the one you used in checkout)

**After clicking "Pay":**
- Nomba redirects back (to your `defaultRedirectUrl`)
- We'll receive webhook automatically
- You should see DB updates + Telegram alert

---

## 📊 Test Results Interpretation

### ✅ Everything Working
```
All requests return 200/201
All response bodies have expected fields
Database states update correctly
Telegram alerts received
Webhook processing succeeds
```

### ⚠️ Issues to Check
```
401 Errors → Check API key/JWT token validity
400 Errors → Check request body matches schema
500 Errors → Check logs for exception details
Webhook not received → Check signature calculation
Telegram not working → Verify bot secret and chat_id
```

---

## 🎓 Learning Path

1. **Read:** `docs/CRITICAL_PATH_TESTING.md` (understand the flow)
2. **Run:** `bash scripts/critical-path-curl.sh` (see it in action)
3. **Click:** Checkout links (real payment)
4. **Observe:** Database updates & logs
5. **Execute:** `pnpm test:e2e critical-path.e2e-spec` (reproduce in tests)
6. **Reference:** Use curl examples for your own integration

---

**Ready to test? Start with:** `pnpm start:dev` + `bash scripts/critical-path-curl.sh`
