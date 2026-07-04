# Lemni Checkout Flows Documentation

## Overview

Lemni provides two distinct checkout flows to accommodate different merchant use cases:

1. **Developer API Flow** — For developers integrating Lemni via API Key
2. **Public Plan Link Flow** — For merchants sharing shareable checkout links with customers

Both flows delegate payment UI to Nomba's hosted checkout (no custom payment form built by Lemni).

---

## Flow 1: Developer API Flow

### Use Case
A developer is building a web/mobile app or SaaS platform and wants to accept payments from customers. The developer has direct control over the UI and can collect customer information.

### When to Use
- You're building an app and want to integrate Lemni's payment APIs directly
- You control the entire customer journey (signup → payment → success)
- You have an API Key from Lemni and can authenticate requests

### High-Level Flow

```
Developer's App                    Lemni Backend                  Nomba
    │                                   │                           │
    ├─ User fills form                  │                           │
    │  (email, amount)                  │                           │
    │                                   │                           │
    ├─ POST /api/v1/pay                 │                           │
    │  { email, amount }                │                           │
    │─────────────────────────────────>│                           │
    │  (with API Key auth)              │                           │
    │                                   ├─ Create Transaction       │
    │                                   ├─ POST /v1/checkout/order  │
    │                                   │─────────────────────────>│
    │                                   │                           │
    │                                   │                           │
    │                                   │<──────────────────────────│
    │                                   │   { checkoutUrl, ... }   │
    │                                   │                           │
    │<──────────────────────────────────│                           │
    │  { sessionId, checkoutUrl }       │                           │
    │                                   │                           │
    ├─ User clicks link                 │                           │
    │  or redirect to checkoutUrl       │                           │
    │─────────────────────────────────────────────────────────────>│
    │                                   │                           │
    │                                   │                ┌──────────┤
    │                                   │                │          │
    │                                   │                └─ Hosted Checkout Page
    │                                   │                   (card entry form)
    │                                   │                │
    │                                   │                └─────────┘
    │                                   │                           │
    │                                   │                    User enters
    │                                   │                    card + pays
    │                                   │                           │
    │                                   │<─────────────────────────│
    │                                   │  payment_success          │
    │                                   │
    │                                   ├─ Webhook received
    │                                   ├─ Update Transaction state
    │                                   ├─ Advance Subscription (if recurring)
    │                                   │
    │<─ Poll /api/v1/sessions/:id/status
    │  (optional, for status check)
    │─────────────────────────────────>│
    │                                   │
    │<────────────────────────────────── { status: 'success' }
    │
    └─ Show success page
```

### Step-by-Step

1. **Developer collects customer email** on their app/form
2. **Developer calls `POST /api/v1/pay`** or **`POST /api/v1/subscribe`**
   - Request includes: email, amount (or planId for subscriptions), API Key
   - Lemni creates a `Transaction` record (or `Subscription` + `Transaction`)
   - Lemni calls Nomba to generate a checkout URL
3. **Lemni returns `{ sessionId, checkoutUrl }`**
4. **Developer's app redirects customer to `checkoutUrl`**
   - Customer lands on Nomba's hosted checkout page
5. **Customer enters card details** and completes payment on Nomba's page
6. **Nomba webhooks Lemni** with the payment result
   - POST `/api/v1/webhooks/nomba` with `payment_success` or `payment_failed`
7. **Lemni updates local state** and optionally sends merchant notification
8. **Developer polls `GET /api/v1/sessions/:sessionId/status`** to check result (optional, webhook is authoritative)

### Endpoints Used

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/pay` | POST | API Key | Create one-time payment checkout session |
| `/api/v1/subscribe` | POST | API Key | Create subscription checkout session |
| `/api/v1/sessions/:id/status` | GET | None | Poll checkout session status |
| `/api/v1/webhooks/nomba` | POST | Nomba Signature | Receive payment update from Nomba (internal) |

### Example Request & Response

**Request:**
```bash
curl -X POST https://api.lemni.com/api/v1/subscribe \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "plan-abc123",
    "email": "customer@example.com",
    "callbackUrl": "https://myapp.com/payment-success"
  }'
```

**Response:**
```json
{
  "sessionId": "tx_abcd1234efgh5678",
  "subscriptionId": "sub_xyz9876543210",
  "checkoutUrl": "https://checkout.nomba.com/pay/mock_link_xyz123"
}
```

**Next Step:** Redirect customer to `checkoutUrl`.

---

## Flow 2: Public Plan Link Flow

### Use Case
A merchant (e.g., an agency, consultant, course creator) wants to share a simple checkout link with customers. The merchant doesn't need a full API; they just want a shareable link that their customers can click to pay.

### When to Use
- You want to create a "buy now" link for a product/service
- You want to share the link via email, social media, or messaging apps (WhatsApp, SMS)
- You don't have an API Key or don't want to build custom UI
- Your customer base is not from your own app (external customers)

### High-Level Flow

```
Customer                           Merchant's Page                Lemni Backend                  Nomba
    │                                   │                               │                           │
    ├─ Click link (public)              │                               │                           │
    │ (e.g., from WhatsApp)             │                               │                           │
    │─────────────────────────────────> │                               │                           │
    │                                   │                               │                           │
    │                                   ├─ Show form: "Enter email"    │                           │
    │                                   │                               │                           │
    ├─ Enter email                      │                               │                           │
    │─────────────────────────────────> │                               │                           │
    │                                   │                               │                           │
    │                                   ├─ POST /checkout/plans/:id/sessions
    │                                   │  { email }                    │                           │
    │                                   │───────────────────────────────>│                           │
    │                                   │  (no API Key needed)          │                           │
    │                                   │                               ├─ Create Subscription     │
    │                                   │                               ├─ Create Transaction      │
    │                                   │                               ├─ POST /v1/checkout/order│
    │                                   │                               │─────────────────────────>│
    │                                   │                               │                           │
    │                                   │                               │<──────────────────────────│
    │                                   │                               │  { checkoutUrl }        │
    │                                   │                               │                           │
    │                                   │<───────────────────────────────│                           │
    │                                   │  { checkoutUrl, sessionId }   │                           │
    │                                   │                               │                           │
    │                                   ├─ Redirect to checkoutUrl      │                           │
    │<──────────────────────────────────│  (e.g., <a href=...>)        │                           │
    │  (Nomba checkout page)            │                               │                           │
    │                                   │                               │                           │
    │─────────────────────────────────────────────────────────────────────────────────────────────>│
    │                                   │                               │                           │
    │                                   │                               │   ┌─ Hosted Checkout Page
    │                                   │                               │   │  (card entry form)
    │                                   │                               │   └───────────────────────┘
    │                                   │                               │                           │
    │ Enter card, click Pay             │                               │                           │
    │─────────────────────────────────────────────────────────────────────────────────────────────>│
    │                                   │                               │                           │
    │                                   │                               │<─ Payment processed
    │                                   │                               │                           │
    │                                   │                               │<─ Webhook: payment_success
    │                                   │                               │   Update Subscription state
    │                                   │                               │
    │<─────────────────────────────────────────────────────────────────│
    │  (Nomba redirect or custom URL)   │                               │
    │                                   │                               │
    └─ Success page (Nomba or custom)   │                               │
```

### Step-by-Step

1. **Merchant creates a public plan** (done once in Lemni admin)
   - Plan ID: `plan-abc123`, Price: $99/month
2. **Merchant shares a link** (via email, SMS, social media)
   - Example: `https://mymerchant.com/checkout?plan=plan-abc123`
   - Or: Direct link to Lemni: `https://api.lemni.com/checkout/plans/plan-abc123`
3. **Customer clicks the link**
   - Lands on merchant's page (or a Lemni-hosted page if shared directly)
4. **Customer sees a form: "Enter your email to proceed"**
   - Merchant's frontend shows this form
5. **Customer enters email and clicks "Pay"**
   - Merchant's frontend calls `POST /api/v1/checkout/plans/plan-abc123/sessions` with the email
6. **Lemni returns `{ sessionId, subscriptionId, checkoutUrl }`**
7. **Merchant's page redirects customer to `checkoutUrl`**
   - Customer lands on Nomba's hosted checkout page
8. **Customer enters card details** and completes payment on Nomba's page
9. **Nomba webhooks Lemni** with the payment result
10. **Lemni updates local state** (subscription is now active)

### Endpoints Used

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/checkout/plans/:planId/sessions` | POST | None | Create checkout session for a public plan (no API Key needed) |
| `/api/v1/sessions/:id/status` | GET | None | Poll checkout session status |
| `/api/v1/webhooks/nomba` | POST | Nomba Signature | Receive payment update from Nomba (internal) |

### Example Request & Response

**Request:**
```bash
curl -X POST https://api.lemni.com/api/v1/checkout/plans/plan-abc123/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "callbackUrl": "https://mymerchant.com/payment-success"
  }'
```

**Response:**
```json
{
  "sessionId": "tx_efgh5678ijkl9012",
  "subscriptionId": "sub_abc1234567890",
  "checkoutUrl": "https://checkout.nomba.com/pay/another_mock_link_abc456"
}
```

**Next Step:** Redirect customer to `checkoutUrl`.

---

## Key Differences

| Aspect | Developer API Flow | Public Plan Link Flow |
|--------|-------------------|----------------------|
| **Authentication** | Requires API Key | No authentication |
| **Who collects email?** | Developer's app | Merchant's frontend |
| **Who calls Lemni API?** | Developer's backend | Merchant's frontend (public endpoint) |
| **Payment amount** | Specified per request (or from plan) | From pre-defined plan |
| **Use case** | SaaS, app integration | Shareable checkout links |
| **Customer UX** | Integrated into app | Redirected to merchant page then Nomba |

---

## Important Notes

### 1. Email is Always Required
Both flows require a customer email address. This is a Nomba requirement — we cannot generate anonymous checkout links.

### 2. We Never Touch Card Data
- Customers enter card details **only on Nomba's hosted checkout page**
- Lemni never sees raw card numbers, CVV, or expiry dates
- This ensures PCI DSS compliance without burden on Lemni

### 3. Webhook is Authoritative
- After the customer completes payment on Nomba, Nomba webhooks Lemni with the result
- The webhook is the source of truth for payment state
- Polling `/api/v1/sessions/:id/status` is optional but available for realtime checks

### 4. Callback URLs are Optional
Both endpoints accept an optional `callbackUrl` parameter:
- If provided, Nomba redirects the customer to this URL after payment
- If not provided, a default Lemni success page is used
- This allows merchants to redirect customers to a custom success/failure page

### 5. Subscription vs. One-Time Payment
- **One-Time Payment:** Use `POST /api/v1/pay` (Developer API) — customer pays once
- **Subscription:** Use `POST /api/v1/subscribe` (Developer API) or `POST /api/v1/checkout/plans/:planId/sessions` (Public Link) — customer's card is tokenized and charged on schedule
- For public plans, the plan type is pre-defined (recurring, trial, grace period, etc.)

---

## Nomba Webhook Integration

After checkout completes, Nomba sends a webhook to Lemni:

```
POST /api/v1/webhooks/nomba
{
  "event_type": "payment_success",
  "requestId": "...",
  "data": {
    "merchant": { "userId": "...", "walletId": "..." },
    "transaction": { "transactionId": "...", "type": "checkout", "time": "...", "responseCode": "" }
  }
}
```

Lemni:
1. Verifies the Nomba signature (HMAC-SHA256)
2. Matches the `transactionId` to a local `Transaction` record
3. Updates the transaction status to `success` or `failed`
4. If successful and subscription, advances the subscription period
5. Optionally sends merchant alerts (Telegram, webhook, etc.)

This is automatic and transparent to the customer and merchant.

---

## FAQ

**Q: Can I customize the checkout page?**  
A: Not directly. Nomba's hosted checkout handles all payment UI. You can customize:
- The page *before* the customer is redirected to Nomba (your app/merchant page)
- The page *after* the customer returns (via `callbackUrl`)
But the actual card entry form is Nomba's.

**Q: What if the customer closes the browser mid-checkout?**  
A: The checkout session remains `pending` in Lemni's database. You can:
- Poll `/api/v1/sessions/:id/status` to check if it completed later
- Retry by sending the customer the checkout URL again (idempotent)
- After ~24 hours, Lemni can auto-expire stale pending sessions

**Q: Do I need HTTPS for the `callbackUrl`?**  
A: Yes, Nomba enforces HTTPS for callback URLs.

**Q: What if Nomba's webhook doesn't arrive (network issue)?**  
A: Nomba retries webhooks with exponential backoff. If still missing:
- Lemni's billing worker can reconcile by querying Nomba's API (future feature)
- Merchant can manually trigger a reconciliation in the dashboard (future feature)

**Q: Can I charge the customer's card again without them re-entering details?**  
A: Yes. After the first successful payment, Lemni tokenizes the card and stores the token in `customers.nombaToken`. The billing worker uses this token to auto-charge on subscription renewal dates (no customer action needed).

---

## Summary

- **Developer API Flow:** Full control, custom UI, API Key auth
- **Public Plan Link Flow:** Shareable link, no API Key, simple email capture
- **Both flows:** Delegate payment UI to Nomba, receive payment updates via webhook, manage state in Lemni DB
- **No custom checkout UI:** PCI compliance, security, simplicity
- **Email always required:** Nomba requirement, captured by developer or merchant's frontend
