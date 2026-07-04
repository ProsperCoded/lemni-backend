#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load environment variables from .env
if [ ! -f .env ]; then
  echo -e "${RED}Error: .env file not found${NC}"
  exit 1
fi

export $(grep -v '^#' .env | xargs)

# Validate required env vars
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo -e "${RED}Error: TELEGRAM_BOT_TOKEN not set in .env${NC}"
  exit 1
fi

if [ -z "$TELEGRAM_BOT_SECRET" ]; then
  echo -e "${RED}Error: TELEGRAM_BOT_SECRET not set in .env${NC}"
  exit 1
fi

if [ -z "$TELEGRAM_WEBHOOK_URL" ]; then
  echo -e "${RED}Error: TELEGRAM_WEBHOOK_URL not set in .env${NC}"
  exit 1
fi

# Function to set webhook
set_webhook() {
  echo -e "${YELLOW}Setting Telegram webhook...${NC}"
  echo "Bot Token: ${TELEGRAM_BOT_TOKEN:0:20}..."
  echo "Webhook URL: $TELEGRAM_WEBHOOK_URL"
  echo "Secret: ${TELEGRAM_BOT_SECRET:0:10}..."

  response=$(curl -s -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    -d "url=${TELEGRAM_WEBHOOK_URL}" \
    -d "secret_token=${TELEGRAM_BOT_SECRET}")

  if echo "$response" | grep -q '"ok":true'; then
    echo -e "${GREEN}✓ Webhook configured successfully${NC}"
    return 0
  else
    echo -e "${RED}✗ Failed to configure webhook${NC}"
    echo "Response: $response"
    return 1
  fi
}

# Function to get current webhook info
get_webhook_info() {
  echo -e "${YELLOW}Fetching current webhook configuration...${NC}"

  response=$(curl -s -X GET \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo")

  echo "$response" | jq '.' 2>/dev/null || echo "$response"
}

# Function to delete webhook
delete_webhook() {
  echo -e "${YELLOW}Deleting Telegram webhook...${NC}"

  response=$(curl -s -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook")

  if echo "$response" | grep -q '"ok":true'; then
    echo -e "${GREEN}✓ Webhook deleted successfully${NC}"
    return 0
  else
    echo -e "${RED}✗ Failed to delete webhook${NC}"
    echo "Response: $response"
    return 1
  fi
}

# Main command handling
case "${1:-set}" in
  set)
    set_webhook
    ;;
  info)
    get_webhook_info
    ;;
  delete)
    read -p "Are you sure you want to delete the webhook? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
      delete_webhook
    else
      echo "Cancelled."
    fi
    ;;
  *)
    echo -e "${YELLOW}Usage: $0 {set|info|delete}${NC}"
    echo ""
    echo "Commands:"
    echo "  set    - Set/update webhook URL and secret (reads from .env)"
    echo "  info   - Get current webhook configuration"
    echo "  delete - Delete the webhook"
    echo ""
    echo "Example:"
    echo "  $0 set      # Switch to dev environment"
    echo "  $0 info     # Check current webhook status"
    echo "  $0 delete   # Remove webhook"
    exit 1
    ;;
esac
