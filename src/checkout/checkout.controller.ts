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
  PublicPlanSessionSchema,
  UnsubscribeRequestSchema,
  UnsubscribeConfirmSchema,
} from './dto/checkout.dto';
import type {
  OneTimePaymentDto,
  SubscriptionPaymentDto,
  PublicPlanSessionDto,
  UnsubscribeRequestDto,
  UnsubscribeConfirmDto,
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
  @UsePipes(new ZodValidationPipe(PublicPlanSessionSchema))
  @ApiOperation({
    summary: 'Generate public plan checkout session',
    description:
      'Allows off-the-shelf payment links to initialize checkout sessions for customer emails.',
  })
  @ApiParam({ name: 'planId', description: 'The static pricing plan ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email', example: 'buyer@gmail.com' },
        callbackUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://mywebsite.com/public-success',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Checkout session generated successfully',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          example: 'tx_1234567890abcdef',
          description: 'Unique session ID for tracking',
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
        error: { type: 'string', example: 'Invalid email format or plan configuration' },
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
  async createPublicPlanSession(
    @Param('planId') planId: string,
    @Body() body: PublicPlanSessionDto,
  ) {
    return this.checkoutService.createPublicPlanSession(planId, body);
  }

  @Post('public/subscriptions/:id/unsubscribe/request')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    description: 'The subscription ID',
  })
  @ApiOperation({
    summary: 'Request email OTP to unsubscribe',
    description:
      'Generates and sends a 6-digit OTP code to the subscription owner email to verify unsubscribe request.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'subscriber@test.com',
          description: 'Email address associated with the subscription',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Verification code sent successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Verification code sent to subscriber@test.com',
          description: 'Confirmation message',
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Email does not match subscription owner',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          example: 'Email does not match subscription owner',
          description: 'Error message',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription not found',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          example: 'Subscription not found',
          description: 'Error message',
        },
      },
    },
  })
  async requestUnsubscribe(
    @Param('id') id: string,
    @Body() body: UnsubscribeRequestDto,
  ) {
    return this.checkoutService.requestUnsubscribe(id, body.email);
  }

  @Post('public/subscriptions/:id/unsubscribe/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    description: 'The subscription ID',
  })
  @ApiOperation({
    summary: 'Confirm unsubscribe with OTP',
    description: 'Verifies the OTP code sent to the subscription owner email and cancels the subscription immediately.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['code'],
      properties: {
        code: {
          type: 'string',
          example: '123456',
          description: '6-digit OTP code sent to email',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription successfully canceled',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          example: true,
          description: 'Success flag',
        },
        message: {
          type: 'string',
          example: 'Subscription successfully canceled',
          description: 'Confirmation message',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired code, or subscription already canceled',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          example: 'Invalid or expired code, or subscription already canceled',
          description: 'Error message',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription not found',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          example: 'Subscription not found',
          description: 'Error message',
        },
      },
    },
  })
  async confirmUnsubscribe(
    @Param('id') id: string,
    @Body() body: UnsubscribeConfirmDto,
  ) {
    return this.checkoutService.confirmUnsubscribe(id, body.code);
  }
}
