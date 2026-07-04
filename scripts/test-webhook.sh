#!/bin/bash

# Simple script to test if your webhook endpoint is reachable

WEBHOOK_URL="${1:-http://localhost:3000/api/v1/webhooks/test}"

echo "Testing webhook endpoint: $WEBHOOK_URL"
echo ""

response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "test": true,
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "message": "This is a test webhook payload"
  }')

http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
body=$(echo "$response" | sed '$d')

echo "Response Status: $http_code"
echo "Response Body:"
echo "$body" | jq '.' 2>/dev/null || echo "$body"

if [ "$http_code" == "200" ]; then
  echo ""
  echo "✓ Webhook endpoint is working!"
else
  echo ""
  echo "✗ Webhook endpoint returned status $http_code"
fi
