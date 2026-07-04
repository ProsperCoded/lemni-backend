#!/bin/bash

# 🚀 LEMNI CRITICAL PATH E2E TEST (Using curl)
# This script demonstrates the complete user journey:
# Signup → API Key → Plan → Checkout → Webhook → Telegram Alert

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
MERCHANT_EMAIL="test-merchant-$(date +%s)@lemni.com"
MERCHANT_PASSWORD="SecurePassword123!"

echo "🚀 LEMNI CRITICAL PATH TEST"
echo "=================================="
echo "Base URL: $BASE_URL"
echo "Merchant Email: $MERCHANT_EMAIL"
echo ""

# ============================================================================
# STEP 1: MERCHANT SIGNUP
# ============================================================================
echo "📝 STEP 1: Merchant Signup"
echo "=================================="
echo "POST $BASE_URL/auth/signup"
echo ""

SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$MERCHANT_EMAIL\",
    \"password\": \"$MERCHANT_PASSWORD\"
  }")

echo "RESPONSE:"
echo "$SIGNUP_RESPONSE" | jq '.'
echo ""

MERCHANT_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.merchant.id')
MERCHANT_JWT=$(echo "$SIGNUP_RESPONSE" | jq -r '.accessToken')

echo "✅ Merchant ID: $MERCHANT_ID"
echo "✅ JWT Token: ${MERCHANT_JWT:0:50}..."
echo ""

# ============================================================================
# STEP 2: GENERATE API KEY
# ============================================================================
echo "🔑 STEP 2: Generate API Key (for developer integration)"
echo "=================================="
echo "POST $BASE_URL/admin/api-keys"
echo "Authorization: Bearer $MERCHANT_JWT"
echo ""

APIKEY_RESPONSE=$(curl -s -X POST "$BASE_URL/admin/api-keys" \
  -H "Authorization: Bearer $MERCHANT_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "environment": "test"
  }')

echo "RESPONSE:"
echo "$APIKEY_RESPONSE" | jq '.'
echo ""

API_KEY=$(echo "$APIKEY_RESPONSE" | jq -r '.rawKey')
echo "✅ API Key: ${API_KEY:0:50}..."
echo ""

# ============================================================================
# STEP 3: CREATE SUBSCRIPTION PLAN
# ============================================================================
echo "📋 STEP 3: Create Subscription Plan"
echo "=================================="
echo "POST $BASE_URL/admin/plans"
echo "Authorization: Bearer $MERCHANT_JWT"
echo ""

PLAN_RESPONSE=$(curl -s -X POST "$BASE_URL/admin/plans" \
  -H "Authorization: Bearer $MERCHANT_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Premium Monthly Plan",
    "amount": 5000,
    "billingModel": "recurring",
    "interval": "monthly",
    "trialDays": 7,
    "gracePeriodDays": 3
  }')

echo "RESPONSE:"
echo "$PLAN_RESPONSE" | jq '.'
echo ""

PLAN_ID=$(echo "$PLAN_RESPONSE" | jq -r '.id')
echo "✅ Plan ID: $PLAN_ID"
echo "✅ Plan: Premium Monthly (₦5,000/month, 7-day trial)"
echo ""

# ============================================================================
# STEP 4A: ONE-TIME PAYMENT (Developer API)
# ============================================================================
echo "💳 STEP 4A: One-Time Payment via Developer API"
echo "=================================="
echo "POST $BASE_URL/api/v1/pay"
echo "Authorization: Bearer $API_KEY"
echo ""

PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/pay" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000,
    "email": "api-customer@example.com"
  }')

echo "RESPONSE:"
echo "$PAYMENT_RESPONSE" | jq '.'
echo ""

PAYMENT_SESSION_ID=$(echo "$PAYMENT_RESPONSE" | jq -r '.sessionId')
CHECKOUT_URL=$(echo "$PAYMENT_RESPONSE" | jq -r '.checkoutUrl')

echo "✅ Payment Session ID: $PAYMENT_SESSION_ID"
echo "🔗 Checkout URL (click to pay): $CHECKOUT_URL"
echo ""

# ============================================================================
# STEP 4B: PUBLIC PLAN LINK CHECKOUT (No Auth)
# ============================================================================
echo "🎯 STEP 4B: Public Plan Link Checkout (No Authentication)"
echo "=================================="
echo "POST $BASE_URL/api/v1/checkout/plans/$PLAN_ID/sessions"
echo "(No Authorization header required)"
echo ""

PUBLIC_CHECKOUT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/checkout/plans/$PLAN_ID/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "external-customer@example.com"
  }')

echo "RESPONSE:"
echo "$PUBLIC_CHECKOUT_RESPONSE" | jq '.'
echo ""

SUBSCRIPTION_ID=$(echo "$PUBLIC_CHECKOUT_RESPONSE" | jq -r '.subscriptionId')
SUBSCRIPTION_SESSION_ID=$(echo "$PUBLIC_CHECKOUT_RESPONSE" | jq -r '.sessionId')
PUBLIC_CHECKOUT_URL=$(echo "$PUBLIC_CHECKOUT_RESPONSE" | jq -r '.checkoutUrl')

echo "✅ Subscription ID: $SUBSCRIPTION_ID"
echo "✅ Transaction ID: $SUBSCRIPTION_SESSION_ID"
echo "🔗 Subscription Checkout URL: $PUBLIC_CHECKOUT_URL"
echo ""

# ============================================================================
# STEP 5: MERCHANT CONNECTS TELEGRAM
# ============================================================================
echo "🤖 STEP 5: Merchant Connects Telegram"
echo "=================================="
echo "POST $BASE_URL/api/v1/webhooks/telegram"
echo ""

TELEGRAM_CHAT_ID="123456789"
TELEGRAM_BOT_SECRET="dev_bot_secret_test_key_123"
TIMESTAMP=$(date +%s)000
SIGNING_STRING="${MERCHANT_ID}:${TELEGRAM_CHAT_ID}:${TIMESTAMP}"
SIGNATURE=$(echo -n "$SIGNING_STRING" | openssl dgst -sha256 -hmac "$TELEGRAM_BOT_SECRET" -hex | awk '{print $NF}')

echo "Telegram Chat ID: $TELEGRAM_CHAT_ID"
echo "Signature: $SIGNATURE"
echo "Timestamp: $TIMESTAMP"
echo ""

TELEGRAM_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/webhooks/telegram" \
  -H "Content-Type: application/json" \
  -d "{
    \"merchantId\": \"$MERCHANT_ID\",
    \"chatId\": \"$TELEGRAM_CHAT_ID\",
    \"signature\": \"$SIGNATURE\",
    \"timestamp\": \"$TIMESTAMP\"
  }")

echo "RESPONSE:"
echo "$TELEGRAM_RESPONSE" | jq '.'
echo ""

echo "✅ Telegram Connected"
echo "📱 Merchant will now receive payment alerts"
echo ""

# ============================================================================
# STEP 6: PAYMENT STATUS CHECK
# ============================================================================
echo "📊 STEP 6: Check Payment Status"
echo "=================================="
echo "GET $BASE_URL/api/v1/sessions/$SUBSCRIPTION_SESSION_ID/status"
echo "Authorization: Bearer $API_KEY"
echo ""

STATUS_RESPONSE=$(curl -s -X GET "$BASE_URL/api/v1/sessions/$SUBSCRIPTION_SESSION_ID/status" \
  -H "Authorization: Bearer $API_KEY")

echo "RESPONSE:"
echo "$STATUS_RESPONSE" | jq '.'
echo ""

# ============================================================================
# STEP 7: TELEGRAM STATUS IN DASHBOARD
# ============================================================================
echo "📱 STEP 7: Check Telegram Status in Merchant Dashboard"
echo "=================================="
echo "GET $BASE_URL/api/v1/admin/telegram/status"
echo "Authorization: Bearer $MERCHANT_JWT"
echo ""

DASHBOARD_STATUS=$(curl -s -X GET "$BASE_URL/api/v1/admin/telegram/status" \
  -H "Authorization: Bearer $MERCHANT_JWT")

echo "RESPONSE:"
echo "$DASHBOARD_STATUS" | jq '.'
echo ""

# ============================================================================
# SUMMARY
# ============================================================================
echo "🎉 CRITICAL PATH TEST COMPLETE"
echo "=================================="
echo ""
echo "📝 Credentials for Next Steps:"
echo "  Merchant ID: $MERCHANT_ID"
echo "  Merchant Email: $MERCHANT_EMAIL"
echo "  Merchant JWT: $MERCHANT_JWT"
echo "  API Key (test): $API_KEY"
echo ""
echo "📋 Created Resources:"
echo "  Plan ID: $PLAN_ID"
echo "  Subscription ID: $SUBSCRIPTION_ID"
echo "  Payment Session ID: $PAYMENT_SESSION_ID"
echo ""
echo "🔗 Next Steps:"
echo ""
echo "1️⃣  CLICK THE CHECKOUT LINKS BELOW TO COMPLETE PAYMENT:"
echo "   - One-time payment: $CHECKOUT_URL"
echo "   - Subscription: $PUBLIC_CHECKOUT_URL"
echo ""
echo "2️⃣  AFTER PAYMENT IS COMPLETE, NOMBA WILL SEND A WEBHOOK"
echo "   We'll simulate this with:"
echo ""

# Prepare webhook command
WEBHOOK_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
NOMBA_WEBHOOK_SECRET="${NOMBA_WEBHOOK_SECRET:-dev_webhook_secret_change_me}"
WEBHOOK_SIGNING_STRING="${SUBSCRIPTION_SESSION_ID}:req123:user123:wallet123:${SUBSCRIPTION_SESSION_ID}:payment:::${WEBHOOK_TIMESTAMP}"

# Note: This is a simplified example. In real scenario, Nomba would send the actual webhook.
echo "   curl -X POST http://localhost:3000/api/v1/webhooks/nomba \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'nomba-signature: <base64-hmac-sha256>' \\"
echo "     -H 'nomba-timestamp: $WEBHOOK_TIMESTAMP' \\"
echo "     -d '{...webhook payload...}'"
echo ""
echo "3️⃣  AFTER WEBHOOK IS PROCESSED:"
echo "   - Transaction status should change to SUCCESS"
echo "   - Subscription should advance to ACTIVE"
echo "   - Merchant should receive Telegram alert ✅"
echo ""
echo "=================================="
echo "💡 TIP: To run this again with different parameters:"
echo "   BASE_URL=http://localhost:3000 bash scripts/critical-path-curl.sh"
echo ""
