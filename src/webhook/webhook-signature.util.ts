import * as crypto from 'crypto';
import type { NombaWebhookEventDto } from './dto/webhook.dto';

export function buildNombaSigningString(
  payload: NombaWebhookEventDto,
  timestamp: string,
): string {
  const { merchant, transaction } = payload.data;
  let responseCode = transaction.responseCode || '';
  if (responseCode === 'null') {
    responseCode = '';
  }

  return [
    payload.event_type,
    payload.requestId,
    merchant.userId,
    merchant.walletId,
    transaction.transactionId,
    transaction.type,
    transaction.time,
    responseCode,
    timestamp,
  ].join(':');
}

export function verifyNombaSignature(
  payload: NombaWebhookEventDto,
  timestamp: string | undefined,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!timestamp || !signatureHeader) {
    return false;
  }

  const signingString = buildNombaSigningString(payload, timestamp);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signingString)
    .digest('base64');

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
