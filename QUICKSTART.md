# 🚀 Quick Start: Test Critical Path

## In 3 Commands

```bash
# Terminal 1: Start backend
pnpm start:dev

# Terminal 2: Run e2e tests (shows all request/response)
pnpm test:e2e critical-path.e2e-spec

# Watch console output for full HTTP request/response bodies
```

---

## What You'll See

Each test step will show:

```
📝 STEP 1: MERCHANT SIGNUP
─────────────────────────────────
REQUEST:
POST /auth/signup
Body: {"email": "merchant@...", "password": "..."}

EXPECTED: 201 Created

✅ ACTUAL RESPONSE: 201 Created
Body: {
  "merchant": {"id": "merchant-abc123", "email": "..."},
  "accessToken": "eyJ..."
}
```

---

## For Real Payment Testing

```bash
# Terminal 1: Start backend
pnpm start:dev

# Terminal 2: Generate test resources and credentials
bash scripts/critical-path-curl.sh

# Script outputs:
# ✅ Merchant ID: merchant-12345
# ✅ API Key (test): sk_test_abc123...
# ✅ Plan ID: plan-xyz789
#
# 🔗 CLICK THESE CHECKOUT URLS TO PAY:
#    - One-time payment: https://checkout.nomba.com/pay/mock_link_123
#    - Subscription: https://checkout.nomba.com/pay/mock_link_456
```

---

## Test Cases Covered

| What | Request | Response |
|------|---------|----------|
| Signup | `POST /auth/signup` | `201 + JWT token` |
| API Key | `POST /admin/api-keys` | `201 + sk_test_...` |
| Plan | `POST /admin/plans` | `201 + plan-abc123` |
| One-Time Pay | `POST /api/v1/pay` | `200 + checkoutUrl` |
| Public Plan | `POST /api/v1/checkout/plans/{id}/sessions` | `200 + subscriptionId` |
| Telegram Connect | `POST /api/v1/admin/telegram/connect` | `200 + success: true` |
| Nomba Webhook | `POST /api/v1/webhooks/nomba` | `200 + status: processed` |
| Status Check | `GET /api/v1/sessions/{id}/status` | `200 + status: success` |
| Telegram Status | `GET /api/v1/admin/telegram/status` | `200 + connected: true` |

---

## Documentation

- **For Full Details:** `docs/CRITICAL_PATH_TESTING.md` (copy/paste curl examples)
- **For Testing Overview:** `TESTING_SUMMARY.md` (three testing approaches)
- **For Implementation:** `IMPLEMENTATION_COMPLETE.md` (architecture + validation)

---

## Key Point

**All request/response bodies are logged to console** when you run the e2e test.

You'll see **exactly** what HTTP requests are sent and what responses come back — same as if you were using Postman or curl.

---

## Next: Real Payment Flow

After seeing the tests pass:

1. ✅ Run curl script
2. 👉 **Click the checkout URLs it generates**
3. 🎯 Enter test card: `4111 1111 1111 1111`
4. ✅ Complete payment
5. 📊 Check database for state changes
6. 🤖 Verify Telegram alert sent

---

## Run Tests Now

```bash
pnpm test:e2e critical-path.e2e-spec
```

**Look for:**
- ✅ All steps show REQUEST → EXPECTED → ACTUAL RESPONSE
- ✅ All HTTP status codes match expected
- ✅ Response bodies have required fields
- ✅ Database state updates correctly
