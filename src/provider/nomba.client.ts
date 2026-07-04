import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService } from './idempotency.service';
import { CircuitBreakerService } from './circuit-breaker.service';

@Injectable()
export class NombaClient {
  private readonly logger = new Logger(NombaClient.name);
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly idempotencyService: IdempotencyService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {
    this.baseUrl = this.configService.get<string>('NOMBA_API_URL') || 'https://api.nomba.com';
  }

  /**
   * Helper to get client credentials based on current mode (sandbox vs live)
   */
  private getCredentials() {
    const mode = this.configService.get<string>('NOMBA_MODE') || 'sandbox';
    const accountId = this.configService.get<string>('NOMBA_MAIN_ACCOUNT_ID');

    if (mode === 'live') {
      return {
        clientId: this.configService.get<string>('NOMBA_LIVE_CLIENT_ID'),
        clientSecret: this.configService.get<string>('NOMBA_LIVE_CLIENT_SECRET'),
        accountId,
      };
    }

    return {
      clientId: this.configService.get<string>('NOMBA_TEST_CLIENT_ID'),
      clientSecret: this.configService.get<string>('NOMBA_TEST_CLIENT_SECRET'),
      accountId,
    };
  }

  /**
   * Wraps Nomba's POST /v1/checkout/order (generating checkout links)
   */
  async createCheckoutOrder(idempotencyKey: string, orderPayload: any): Promise<any> {
    return this.executeRequest(
      idempotencyKey,
      'create_checkout_order',
      '/v1/checkout/order',
      orderPayload,
    );
  }

  /**
   * Wraps Nomba's POST /v1/checkout/tokenized-card-payment (executing tokenized card charges)
   */
  async chargeTokenizedCard(idempotencyKey: string, paymentPayload: any): Promise<any> {
    return this.executeRequest(
      idempotencyKey,
      'charge_tokenized_card',
      '/v1/checkout/tokenized-card-payment',
      paymentPayload,
    );
  }

  /**
   * Orchestrates the request, checking circuit breaker and verifying idempotency.
   */
  private async executeRequest(
    idempotencyKey: string,
    requestType: string,
    endpoint: string,
    payload: any,
  ): Promise<any> {
    // 1. Guard check: is circuit breaker OPEN?
    if (this.circuitBreakerService.isOpen()) {
      this.logger.error('Outbound request blocked: Circuit breaker is OPEN.');
      throw new HttpException(
        'Payment gateway service is temporarily unavailable (circuit breaker tripped)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // 2. Idempotency check: has this request already been executed successfully?
    const existing = await this.idempotencyService.getKeyRecord(idempotencyKey);
    if (existing) {
      if (existing.status === 'completed') {
        this.logger.log(`Idempotency hit! Returning cached response for key: ${idempotencyKey}`);
        return existing.response;
      }
      if (existing.status === 'pending') {
        this.logger.warn(`Transaction retry detected while original is still pending: ${idempotencyKey}`);
        throw new HttpException(
          'A transaction with this idempotency key is already in progress',
          HttpStatus.CONFLICT,
        );
      }
    }

    // 3. Register the key in the database as pending prior to execution
    await this.idempotencyService.registerKey(idempotencyKey, requestType, payload);

    const { clientId, clientSecret, accountId } = this.getCredentials();
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    if (accountId) {
      headers['accountId'] = accountId;
    }
    if (clientId && clientSecret) {
      headers['client-id'] = clientId;
      headers['client-secret'] = clientSecret;
    }

    this.logger.log(`Dispatching outbound request to Nomba: POST ${url} [Idempotency Key: ${idempotencyKey}]`);
    this.logger.debug(`Request Payload: ${JSON.stringify(payload)}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let responseData: any;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { rawText: responseText };
      }

      this.logger.log(`Nomba response status code: ${response.status}`);
      this.logger.debug(`Response Payload: ${JSON.stringify(responseData)}`);

      if (response.status >= 500) {
        // Record gateway failures
        this.circuitBreakerService.recordFailure();
        await this.idempotencyService.resolveKey(idempotencyKey, 'failed', responseData);
        throw new HttpException(
          `Payment gateway returned server error: ${response.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      if (!response.ok) {
        // Client errors (4xx) do not trip the circuit breaker but resolve as failed transaction attempts
        await this.idempotencyService.resolveKey(idempotencyKey, 'failed', responseData);
        throw new HttpException(
          responseData.message || `Payment gateway request failed: ${response.status}`,
          response.status,
        );
      }

      // Success
      this.circuitBreakerService.recordSuccess();
      await this.idempotencyService.resolveKey(idempotencyKey, 'completed', responseData);
      return responseData;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Network timeouts, DNS issues, or total connection drops count as circuit breaker failures
      this.circuitBreakerService.recordFailure();
      const networkError = { message: error.message || 'Network connection failed' };
      await this.idempotencyService.resolveKey(idempotencyKey, 'failed', networkError);
      throw new HttpException(
        'Outbound connection to payment gateway failed',
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
  }
}
