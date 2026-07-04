# 🚀 Critical Path E2E Testing Guide

This guide shows you how to test the **complete Lemni payment flow** from merchant signup through payment processing and Telegram notifications.

## Quick Start

**Run the automated curl script (generates all resources):**
```bash
cd /home/proseper/workspace/Collaborations/lemni-backend
pnpm start:dev  # Terminal 1 - Start the backend

# Terminal 2 - Run the test script
bash scripts/critical-path-curl.sh
```

This will output all credentials and resource IDs. Then you'll click the checkout links and complete payment in Nomba's UI.

---

## Manual Testing with curl

### STEP 1: Merchant Signup

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant@example.com",
    "password": "SecurePassword123!"
  }'
```

**Response (201 Created):**
```json
{
  "merchant": {
    "id": "merchant-abc123def456",
    "name": null,
    "email": "merchant@example.com",
    "createdAt": "2026-07-04T10:00:00Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Save these:**
- `merchant.id` → Used for all merchant operations
- `accessToken` → JWT token for merchant dashboard (valid 24 hours)

---

### STEP 2: Generate API Key (for developer integration)

```bash
MERCHANT_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:3000/admin/api-keys \
  -H "Authorization: Bearer $MERCHANT_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "environment": "test"
  }'
```

**Response (201 Created):**
```json
{
  "keyId": "key_abc123def456",
  "rawKey": "sk_test_abc123def456_xyz789abc123def456xyz789abc123",
  "message": "Store this key safely. You will not be able to see it again."
}
```

**Save:**
- `rawKey` → Use this in Authorization header for API calls

---

### STEP 3: Create a Subscription Plan

```bash
MERCHANT_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:3000/admin/plans \
  -H "Authorization: Bearer $MERCHANT_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Premium Monthly Plan",
    "amount": 5000,
    "billingModel": "recurring",
    "interval": "monthly",
    "trialDays": 7,
    "gracePeriodDays": 3
  }'
```

**Response (201 Created):**
```json
{
  "id": "plan-abc123def456",
  "merchantId": "merchant-abc123def456",
  "name": "Premium Monthly Plan",
  "amount": 5000,
  "billingModel": "recurring",
  "interval": "monthly",
  "trialDays": 7,
  "gracePeriodDays": 3,
  "createdAt": "2026-07-04T10:05:00Z"
}
```

**Save:**
- `id` → Plan ID for checkout links

---

## TWO CHECKOUT FLOWS

### Flow A: Developer Integration (One-Time Payment)

**Use Case:** Developer integrates via API Key to charge a customer

```bash
API_KEY="sk_test_abc123def456_xyz789abc123def456xyz789abc123"

curl -X POST http://localhost:3000/api/v1/pay \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000,
    "email": "customer@example.com"
  }'
```

**Response (200 OK):**
```json
{
  "sessionId": "txn_abc123def456",
  "checkoutUrl": "https://checkout.nomba.com/pay/mock_link_xyz789",
  "amount": 10000,
  "currency": "NGN"
}
```

**What to do next:**
1. ✅ **Click the `checkoutUrl`** in your browser
2. Fill in Nomba's hosted form with test card details
3. Nomba redirects back to your `defaultRedirectUrl`
4. We receive webhook with `payment_success` or `payment_failed`
5. Transaction status updates in database

---

### Flow B: Public Plan Link (Subscription - No Auth)

**Use Case:** Merchant shares a public link (e.g., social media) - customer doesn't need merchant's API key

```bash
PLAN_ID="plan-abc123def456"

curl -X POST http://localhost:3000/api/v1/checkout/plans/$PLAN_ID/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "email": "external-customer@example.com"
  }'
```

**Response (200 OK):**
```json
{
  "sessionId": "txn_def456ghi789",
  "subscriptionId": "sub_xyz123abc456",
  "checkoutUrl": "https://checkout.nomba.com/pay/another_mock_link",
  "customerId": "cust_pqr789stu012",
  "currency": "NGN"
}
```

**Save:**
- `sessionId` → Transaction ID (used in webhook matching)
- `subscriptionId` → Reference for billing cycles
- `customerId` → Customer record

**What to do next:**
1. ✅ **Click the `checkoutUrl`** 
2. Customer enters card in Nomba's hosted UI
3. On success, customer enters trial period (7 days for Premium Monthly)
4. After trial, subscription auto-charges
5. Merchant receives Telegram alerts for each event

---

## STEP 4: Merchant Connects Telegram

**Allow merchant to receive payment alerts via Telegram bot**

```bash
MERCHANT_ID="merchant-abc123def456"
TELEGRAM_CHAT_ID="123456789"  # Get this from merchant's Telegram bot
BOT_SECRET="dev_bot_secret_test_key_123"
TIMESTAMP=$(date +%s)000

SIGNING_STRING="${MERCHANT_ID}:${TELEGRAM_CHAT_ID}:${TIMESTAMP}"
SIGNATURE=$(echo -n "$SIGNING_STRING" | openssl dgst -sha256 -hmac "$BOT_SECRET" -hex | awk '{print $NF}')

curl -X POST http://localhost:3000/api/v1/admin/telegram/connect \
  -H "Content-Type: application/json" \
  -d "{
    \"merchantId\": \"$MERCHANT_ID\",
    \"chatId\": \"$TELEGRAM_CHAT_ID\",
    \"signature\": \"$SIGNATURE\",
    \"timestamp\": \"$TIMESTAMP\"
  }"
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Telegram chat connected successfully"
}
```

---

## STEP 5: Check Payment Status

```bash
SESSION_ID="txn_abc123def456"
API_KEY="sk_test_abc123def456_xyz789abc123def456xyz789abc123"

curl -X GET http://localhost:3000/api/v1/sessions/$SESSION_ID/status \
  -H "Authorization: Bearer $API_KEY"
```

**Response (200 OK) - Before Payment:**
```json
{
  "sessionId": "txn_abc123def456",
  "status": "pending",
  "amount": 10000,
  "currency": "NGN"
}
```

**Response (200 OK) - After Payment Webhook:**
```json
{
  "sessionId": "txn_abc123def456",
  "status": "success",
  "amount": 10000,
  "currency": "NGN"
}
```

---

## STEP 6: Simulate Nomba Webhook (Payment Success)

**After customer completes payment on Nomba, Nomba sends a webhook to us:**

```bash
SESSION_ID="txn_abc123def456"
MERCHANT_ID="merchant-abc123def456"
NOMBA_WEBHOOK_SECRET="dev_webhook_secret_change_me"  # From .env

# Build the signing string per Nomba's scheme
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGNING_STRING="payment_success:nomba_req_123:$MERCHANT_ID:wallet_123:$SESSION_ID:checkout:::$TIMESTAMP"

# Create HMAC-SHA256 signature (base64 encoded)
SIGNATURE=$(echo -n "$SIGNING_STRING" | openssl dgst -sha256 -hmac "$NOMBA_WEBHOOK_SECRET" -binary | base64)

curl -X POST http://localhost:3000/api/v1/webhooks/nomba \
  -H "Content-Type: application/json" \
  -H "nomba-signature: $SIGNATURE" \
  -H "nomba-timestamp: $TIMESTAMP" \
  -H "nomba-signature-algorithm: HmacSHA256" \
  -H "nomba-signature-version: 1.0.0" \
  -d "{
    \"event_type\": \"payment_success\",
    \"requestId\": \"nomba_req_123\",
    \"data\": {
      \"merchant\": {
        \"userId\": \"$MERCHANT_ID\",
        \"walletId\": \"wallet_123\"
      },
      \"transaction\": {
        \"transactionId\": \"$SESSION_ID\",
        \"type\": \"checkout_payment\",
        \"time\": \"$TIMESTAMP\",
        \"responseCode\": \"\"
      }
    }
  }"
```

**Response (200 OK):**
```json
{
  "status": "processed"
}
```

**What happens internally:**
1. ✅ Transaction status changes from `pending` → `success`
2. ✅ Subscription advances from `trialing` → `active` (if subscriptionId present)
3. ✅ Next billing date calculated and stored
4. ✅ Notification enqueued to BullMQ
5. ✅ Telegram alert sent to merchant (if connected)
6. ✅ Logs recorded for audit trail

---

## STEP 7: Check Telegram Connection Status

```bash
MERCHANT_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/v1/admin/telegram/status \
  -H "Authorization: Bearer $MERCHANT_JWT"
```

**Response (200 OK) - Connected:**
```json
{
  "connected": true,
  "connectedAt": "2026-07-04T10:15:00Z",
  "chatId": "1234...6789"  // Masked for security
}
```

**Response (200 OK) - Not Connected:**
```json
{
  "connected": false,
  "connectedAt": null,
  "chatId": null
}
```

---

## Complete Request/Response Reference

### Error Cases

**Missing Authorization (401):**
```bash
curl -X POST http://localhost:3000/api/v1/pay \
  -H "Content-Type: application/json" \
  -d '{"amount": 10000, "email": "test@example.com"}'

# Response:
# {
#   "statusCode": 401,
#   "message": "MISSING_API_KEY",
#   "error": "Unauthorized"
# }
```

**Invalid API Key (401):**
```bash
curl -X POST http://localhost:3000/api/v1/pay \
  -H "Authorization: Bearer invalid_key_123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10000, "email": "test@example.com"}'

# Response:
# {
#   "statusCode": 401,
#   "message": "INVALID_API_KEY",
#   "error": "Unauthorized"
# }
```

**Signature Verification Failed (401):**
```bash
curl -X POST http://localhost:3000/api/v1/webhooks/nomba \
  -H "Content-Type: application/json" \
  -H "nomba-signature: invalid_signature" \
  -H "nomba-timestamp: 2026-07-04T10:00:00Z" \
  -d '{...webhook payload...}'

# Response:
# {
#   "statusCode": 401,
#   "message": "Invalid webhook signature",
#   "error": "Unauthorized"
# }
```

---

## Testing Checklist

- [ ] **Signup**: Merchant can create account with email/password
- [ ] **API Key**: Developer can generate test API key
- [ ] **Plan Creation**: Merchant can create subscription plan with trial & grace period
- [ ] **One-Time Checkout**: Developer can initiate payment via API (with email)
- [ ] **Public Link Checkout**: External user can checkout via plan link (no auth required)
- [ ] **Nomba Payment**: Click checkout URL and complete payment in Nomba UI
- [ ] **Webhook Processing**: Payment webhook received and transaction updated to `success`
- [ ] **Subscription State**: Subscription transitions from `pending`/`trialing` → `active`
- [ ] **Telegram Alert**: Merchant receives Telegram notification of payment success
- [ ] **Status Polling**: Developer can check payment status via API
- [ ] **Dashboard**: Merchant can see Telegram connection status

---

## Test Data

**For testing, use these card numbers (Nomba/sandbox):**
- Success: `4111 1111 1111 1111`
- Decline: `4000 0000 0000 0002`

**Telegram Bot Setup:**
1. Create a Telegram bot via @BotFather
2. Get bot token and your chat ID
3. Use chat ID + bot secret to sign connection requests

---

## Next Steps

When you're ready to test:

1. **Start backend:** `pnpm start:dev`
2. **Run curl script:** `bash scripts/critical-path-curl.sh`
3. **Click checkout links** and complete payment in Nomba
4. **Verify webhook** was processed (transaction status changes to `success`)
5. **Check Telegram** for payment alerts
6. **Run e2e tests:** `pnpm test:e2e critical-path.e2e-spec`

---

## Support

If you hit any issues:
- Check `.env` for correct credentials
- Verify JWT token hasn't expired
- Confirm API key is from correct environment (test vs live)
- Review webhook signature calculation (must be base64 HMAC-SHA256)
