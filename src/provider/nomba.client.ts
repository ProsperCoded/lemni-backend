import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';

@Injectable()
export class NombaClient {
  private readonly logger = new Logger(NombaClient.name);
  private readonly baseUrl: string;

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
        throw new HttpException(
          `Payment gateway returned server error: ${response.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      if (!response.ok) {
        throw new HttpException(
          responseData.message ||
            `Payment gateway request failed: ${response.status}`,
          response.status,
        );
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
