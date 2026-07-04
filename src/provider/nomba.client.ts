import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

@Injectable()
export class NombaClient {
  private readonly logger = new Logger(NombaClient.name);
  private readonly baseUrl: string;
  private cachedToken: CachedToken | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {
    this.baseUrl =
      this.configService.get<string>('NOMBA_API_URL') ||
      'https://api.nomba.com';
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
        clientSecret: this.configService.get<string>(
          'NOMBA_LIVE_CLIENT_SECRET',
        ),
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
   * Exchanges client_id/client_secret for a bearer access_token via
   * POST /v1/auth/token/issue, caching it in memory until it expires.
   */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs > Date.now()) {
      return this.cachedToken.accessToken;
    }

    const { clientId, clientSecret, accountId } = this.getCredentials();
    const url = `${this.baseUrl}/v1/auth/token/issue`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (accountId) {
      headers['accountId'] = accountId;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const responseText = await response.text();
    let responseData: Record<string, unknown>;
    try {
      responseData = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      responseData = {};
    }

    if (!response.ok) {
      this.logger.error(
        `Nomba token exchange failed: ${response.status} ${responseText}`,
      );
      throw new HttpException(
        'Failed to authenticate with payment gateway',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const data = responseData.data as
      | { access_token: string; expiresAt: string }
      | undefined;

    if (!data?.access_token) {
      this.logger.error(
        `Nomba token exchange returned no access_token: ${responseText}`,
      );
      throw new HttpException(
        'Payment gateway authentication response malformed',
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.cachedToken = {
      accessToken: data.access_token,
      // Refresh 60s before actual expiry to avoid using a token that
      // expires mid-flight.
      expiresAtMs: new Date(data.expiresAt).getTime() - 60_000,
    };

    return this.cachedToken.accessToken;
  }

  /**
   * Wraps Nomba's POST /v1/checkout/order (generating checkout links)
   */
  async createCheckoutOrder(
    idempotencyKey: string,
    orderPayload: any,
  ): Promise<any> {
    return this.executeRequest(
      idempotencyKey,
      '/v1/checkout/order',
      orderPayload,
    );
  }

  /**
   * Wraps Nomba's POST /v1/checkout/tokenized-card-payment (executing tokenized card charges)
   */
  async chargeTokenizedCard(
    idempotencyKey: string,
    paymentPayload: any,
  ): Promise<any> {
    return this.executeRequest(
      idempotencyKey,
      '/v1/checkout/tokenized-card-payment',
      paymentPayload,
    );
  }

  /**
   * Orchestrates the request, checking circuit breaker and verifying idempotency via headers.
   */
  private async executeRequest(
    idempotencyKey: string,
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

    const { accountId } = this.getCredentials();
    const accessToken = await this.getAccessToken();
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'idempotency-key': idempotencyKey,
      Authorization: `Bearer ${accessToken}`,
    };

    if (accountId) {
      headers['accountId'] = accountId;
    }

    this.logger.log(
      `Dispatching outbound request to Nomba: POST ${url} [Idempotency Key: ${idempotencyKey}]`,
    );
    this.logger.debug(`Request Payload: ${JSON.stringify(payload)}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let responseData: Record<string, unknown> | { rawText: string };
      try {
        responseData = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        responseData = { rawText: responseText };
      }

      this.logger.log(`Nomba response status code: ${response.status}`);
      this.logger.debug(`Response Payload: ${JSON.stringify(responseData)}`);

      if (response.status >= 500) {
        this.circuitBreakerService.recordFailure();
        throw new HttpException(
          `Payment gateway returned server error: ${response.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      if (!response.ok) {
        const message =
          ((responseData as Record<string, unknown>).message as
            string | undefined) ||
          `Payment gateway request failed: ${response.status}`;
        throw new HttpException(message, response.status);
      }

      // Success
      this.circuitBreakerService.recordSuccess();
      return responseData;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Network timeouts, DNS issues, or total connection drops count as circuit breaker failures
      this.circuitBreakerService.recordFailure();
      throw new HttpException(
        'Outbound connection to payment gateway failed',
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
  }
}
