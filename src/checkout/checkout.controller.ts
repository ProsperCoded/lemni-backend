import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  UsePipes,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import type { AuthenticatedRequest } from '../auth/guards/api-key.guard';
import { CheckoutService } from './checkout.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  OneTimePaymentSchema,
  SubscriptionPaymentSchema,
} from './dto/checkout.dto';
import type {
  OneTimePaymentDto,
  SubscriptionPaymentDto,
} from './dto/checkout.dto';

@ApiTags('developer-apis/checkout')
@Controller('api/v1')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @ApiHeader({
    name: 'Authorization',
    description: 'Bearer <API_KEY>',
    required: true,
  })
  @Post('pay')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @UsePipes(new ZodValidationPipe(OneTimePaymentSchema))
  @ApiOperation({
    summary: 'Create a one-time checkout session',
    description: 'Generates a payment URL for a singular checkout charge.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['amount', 'email'],
      properties: {
        amount: { type: 'number', format: 'float', example: 5000.0 },
        email: { type: 'string', format: 'email', example: 'payer@test.com' },
        callbackUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://mywebsite.com/payment-success',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Checkout session successfully created',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          example: 'tx_1234567890abcdef',
          description: 'Unique transaction/session ID for tracking and polling status',
        },
        checkoutUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://checkout.nomba.com/pay/mock_link_123',
          description: 'URL to direct customer to for payment',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Invalid amount or email format' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized API key',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Unauthorized API key' },
      },
    },
  })
  async createOneTimePayment(
    @Body() body: OneTimePaymentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.checkoutService.createOneTimePayment(
      req.merchantId,
      req.environment,
      body,
    );
  }

  @ApiHeader({
    name: 'Authorization',
    description: 'Bearer <API_KEY>',
    required: true,
  })
  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @UsePipes(new ZodValidationPipe(SubscriptionPaymentSchema))
  @ApiOperation({
    summary: 'Create a subscription checkout session',
    description:
      'Generates a payment URL to register a customer to a recurring pricing plan.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['planId', 'email'],
      properties: {
        planId: { type: 'string', example: 'plan_7a8dca9' },
        email: {
          type: 'string',
          format: 'email',
          example: 'subscriber@test.com',
        },
        callbackUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://mywebsite.com/sub-success',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Checkout session successfully created',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          example: 'tx_1234567890abcdef',
          description: 'Unique transaction/session ID',
        },
        subscriptionId: {
          type: 'string',
          example: 'sub_a28deca9',
          description: 'Subscription created for this session',
        },
        checkoutUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://checkout.nomba.com/pay/mock_link_123',
          description: 'URL to direct customer to for payment',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Invalid plan ID or email format' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized API key',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Unauthorized API key' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Plan not found',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Plan not found' },
      },
    },
  })
  async createSubscriptionPayment(
    @Body() body: SubscriptionPaymentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.checkoutService.createSubscriptionPayment(
      req.merchantId,
      req.environment,
      body,
    );
  }

  @Get('sessions/:id/status')
  @ApiOperation({
    summary: 'Poll checkout session status',
    description:
      'Enables frontend checkouts or backend applications to poll for session completion status.',
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session ID / transaction ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Session status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          example: 'tx_1234567890abcdef',
          description: 'The session/transaction ID',
        },
        amount: {
          type: 'number',
          format: 'float',
          example: 5000.0,
          description: 'Transaction amount',
        },
        status: {
          type: 'string',
          enum: ['pending', 'success', 'failed'],
          example: 'pending',
          description: 'Current payment status',
        },
        nombaRef: {
          type: 'string',
          nullable: true,
          example: 'ref_nomba_992c',
          description: 'Reference from payment processor (null until payment is processed)',
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-07-04T02:00:00.000Z',
          description: 'Session creation timestamp',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Session not found' },
      },
    },
  })
  async getCheckoutSessionStatus(@Param('id') id: string) {
    return this.checkoutService.getCheckoutSessionStatus(id);
  }

  @Post('checkout/plans/:planId/sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a public plan checkout session',
    description: 'Enables checking out plans directly from a public URL link without credentials.',
  })
  async createPublicPlanSession(
    @Param('planId') planId: string,
    @Body() body: { email: string; callbackUrl?: string },
  ) {
    return this.checkoutService.createPublicPlanSession(planId, body);
  }

  @Post('public/subscriptions/:id/unsubscribe/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request to self-unsubscribe from a subscription (public)',
    description: 'Generates and sends a 6-digit OTP code to the subscription owner email to verify unsubscribe request.',
  })
  async requestUnsubscribe(
    @Param('id') id: string,
    @Body() body: { email: string },
  ) {
    return this.checkoutService.requestUnsubscribe(id, body.email);
  }

  @Post('public/subscriptions/:id/unsubscribe/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm self-unsubscribe with OTP (public)',
    description: 'Confirms subscription cancellation using the 6-digit verification code.',
  })
  async confirmUnsubscribe(
    @Param('id') id: string,
    @Body() body: { code: string },
  ) {
    return this.checkoutService.confirmUnsubscribe(id, body.code);
  }

  @Post('public/subscriptions/:id/update-payment-method')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update payment method for a subscription (public)',
    description:
      'Generates a tokenization-only checkout URL for the customer to update their card details without triggering a charge.',
  })
  @ApiParam({
    name: 'id',
    description: 'The subscription ID',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'customer@example.com',
          description: 'Email address associated with the subscription (for verification)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Card update checkout session created',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          example: 'card_upd_abc123def456',
          description: 'Unique session ID for the card update checkout',
        },
        checkoutUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://checkout.nomba.com/pay/card_upd_link',
          description: 'URL to redirect customer to for card details entry',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request (canceled subscription or email mismatch)',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription or customer not found',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 502,
    description: 'Payment gateway checkout generation failed',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
  })
  async updatePaymentMethod(
    @Param('id') id: string,
    @Body() body: { email: string },
  ) {
    return this.checkoutService.updatePaymentMethod(id, body.email);
  }
}
