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
import { CheckoutService } from './checkout.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  OneTimePaymentSchema,
  SubscriptionPaymentSchema,
  PublicPlanSessionSchema,
} from './dto/checkout.dto';
import type {
  OneTimePaymentDto,
  SubscriptionPaymentDto,
  PublicPlanSessionDto,
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
        sessionId: { type: 'string', example: 'tx_1234567890abcdef' },
        checkoutUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://checkout.nomba.com/pay/mock_link_123',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized API key' })
  async createOneTimePayment(
    @Body() body: OneTimePaymentDto,
    @Request() req: Record<string, unknown>,
  ) {
    return this.checkoutService.createOneTimePayment(
      req.merchantId as string,
      req.environment as 'test' | 'live',
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
        sessionId: { type: 'string', example: 'tx_1234567890abcdef' },
        subscriptionId: { type: 'string', example: 'sub_a28deca9' },
        checkoutUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://checkout.nomba.com/pay/mock_link_123',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized API key' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async createSubscriptionPayment(
    @Body() body: SubscriptionPaymentDto,
    @Request() req: Record<string, unknown>,
  ) {
    return this.checkoutService.createSubscriptionPayment(
      req.merchantId as string,
      req.environment as 'test' | 'live',
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
        sessionId: { type: 'string', example: 'tx_1234567890abcdef' },
        amount: { type: 'number', format: 'float', example: 5000.0 },
        status: {
          type: 'string',
          enum: ['pending', 'success', 'failed'],
          example: 'pending',
        },
        nombaRef: { type: 'string', nullable: true, example: 'ref_nomba_992c' },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-07-04T02:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
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
    description: 'Checkout session generated',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', example: 'tx_1234567890abcdef' },
        subscriptionId: { type: 'string', example: 'sub_a28deca9' },
        checkoutUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://checkout.nomba.com/pay/mock_link_123',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async createPublicPlanSession(
    @Param('planId') planId: string,
    @Body() body: PublicPlanSessionDto,
  ) {
    return this.checkoutService.createPublicPlanSession(planId, body);
  }
}
