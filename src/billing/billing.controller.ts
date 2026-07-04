import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  UsePipes,
  Get,
  Query,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreatePlanSchema,
  RegisterCustomerSchema,
  TransactionFilterSchema,
} from './dto/billing.dto';
import type {
  CreatePlanDto,
  RegisterCustomerDto,
  TransactionFilterDto,
} from './dto/billing.dto';
import { PublicPlanSessionSchema } from '../checkout/dto/checkout.dto';
import type { PublicPlanSessionDto } from '../checkout/dto/checkout.dto';

@ApiTags('merchant-dashboard/billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('plans')
  @UsePipes(new ZodValidationPipe(CreatePlanSchema))
  @ApiOperation({
    summary: 'Create a billing plan',
    description:
      'Registers a new recurring or one-time subscription plan in the system.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'amount'],
      properties: {
        name: { type: 'string', example: 'Standard Subscription Plan' },
        amount: { type: 'number', format: 'float', example: 29.99 },
        billingModel: {
          type: 'string',
          enum: ['recurring', 'one_time', 'custom_input'],
          default: 'recurring',
          example: 'recurring',
        },
        interval: {
          type: 'string',
          enum: ['weekly', 'monthly', 'yearly'],
          example: 'monthly',
        },
        trialDays: { type: 'integer', format: 'int32', default: 0, example: 7 },
        trialRequireCard: { type: 'boolean', default: false, example: true },
        gracePeriodDays: {
          type: 'integer',
          format: 'int32',
          default: 0,
          example: 3,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Plan successfully created',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'plan_7a8dca9' },
        merchantId: { type: 'string', example: 'merchant-test-123' },
        name: { type: 'string', example: 'Standard Subscription Plan' },
        amount: { type: 'number', format: 'float', example: 29.99 },
        billingModel: { type: 'string', example: 'recurring' },
        interval: { type: 'string', example: 'monthly' },
        trialDays: { type: 'integer', example: 7 },
        trialRequireCard: { type: 'boolean', example: true },
        gracePeriodDays: { type: 'integer', example: 3 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async createPlan(
    @Body() body: CreatePlanDto,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.billingService.createPlan(merchantId, body);
  }

  @Delete('plans/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a billing plan',
    description:
      'Removes a subscription plan if no active or trialing customers are attached to it.',
  })
  @ApiResponse({ status: 204, description: 'Plan successfully deleted' })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete plan due to active subscriptions',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          example: 'Cannot delete plan due to active or trialing subscriptions',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
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
  async deletePlan(@Param('id') id: string, @Request() req: ExpressRequest) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    await this.billingService.deletePlan(merchantId, id);
  }

  @Post('customers')
  @UsePipes(new ZodValidationPipe(RegisterCustomerSchema))
  @ApiOperation({
    summary: 'Register a customer',
    description:
      'Registers a customer under the current merchant, preparing them for subscription charges.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'customer@test.com',
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          example: { companyName: 'LemonInc', department: 'Support' },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Customer successfully registered',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'cust_8a9d2ca8b10' },
        merchantId: { type: 'string', example: 'merchant-test-123' },
        email: {
          type: 'string',
          format: 'email',
          example: 'customer@test.com',
        },
        nombaToken: { type: 'string', nullable: true, example: null },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-07-04T02:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async registerCustomer(
    @Body() body: RegisterCustomerDto,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.billingService.registerCustomer(merchantId, body);
  }

  @Post('subscriptions/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a canceled subscription',
    description:
      'Resets the billing cycle start date and shifts the subscription back to active status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription successfully reactivated',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'sub_a28deca9' },
        customerId: { type: 'string', example: 'cust_8a9d2ca8b10' },
        planId: { type: 'string', example: 'plan_7a8dca9' },
        status: { type: 'string', example: 'active' },
        currentPeriodEnd: {
          type: 'string',
          format: 'date-time',
          example: '2026-08-04T02:00:00.000Z',
        },
        trialEnd: {
          type: 'string',
          format: 'date-time',
          nullable: true,
          example: null,
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-07-04T02:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Subscription is not canceled or card is missing',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          example: 'Subscription is not in canceled status or payment method is missing',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  @ApiResponse({
    status: 404,
    description: 'Subscription or associated plan not found',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          example: 'Subscription or associated plan not found',
        },
      },
    },
  })
  async reactivateSubscription(
    @Param('id') id: string,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.billingService.reactivateSubscription(merchantId, id);
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'Retrieve transaction history',
    description:
      'Returns a paginated list of all transactions belonging to the authenticated merchant with filtering support.',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction history retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'tx_abc123' },
              merchantId: { type: 'string', example: 'merchant-test-123' },
              customerId: { type: 'string', example: 'cust_abc123' },
              subscriptionId: {
                type: 'string',
                nullable: true,
                example: 'sub_abc123',
              },
              amount: { type: 'number', example: 29.99 },
              status: { type: 'string', example: 'success' },
              nombaRef: {
                type: 'string',
                nullable: true,
                example: 'nomba_ref_123',
              },
              createdAt: {
                type: 'string',
                format: 'date-time',
                example: '2026-07-04T10:00:00Z',
              },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 100 },
            limit: { type: 'integer', example: 20 },
            offset: { type: 'integer', example: 0 },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async getTransactions(
    @Query() query: TransactionFilterDto,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.billingService.getTransactions(merchantId, query);
  }

  @Get('plans/:planId/checkout-link')
  @ApiOperation({
    summary: 'Generate shareable checkout link for a plan',
    description:
      'Returns a shareable URL that merchants can distribute without a website. Customers click the link, enter their email, and are directed to payment. Useful for merchants without existing website integrations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Shareable checkout link generated successfully',
    schema: {
      type: 'object',
      properties: {
        checkoutUrl: {
          type: 'string',
          format: 'uri',
          example: 'http://localhost:5173/checkout/plan_7a8dca9',
          description: 'Shareable URL that customers can click to subscribe',
        },
        planId: {
          type: 'string',
          example: 'plan_7a8dca9',
          description: 'The plan ID embedded in the link',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
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
  async getCheckoutLink(
    @Param('planId') planId: string,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.billingService.getCheckoutLink(merchantId, planId);
  }

  @Post('plans/:planId/checkout')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PublicPlanSessionSchema))
  @ApiOperation({
    summary: 'Generate checkout session for public plan link',
    description:
      'Called by the dashboard frontend when a customer submits their email on the public checkout page. Generates a Nomba checkout session and returns the payment URL.',
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
          description: 'Customer email for subscription',
        },
        callbackUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://mywebsite.com/sub-success',
          description: 'Optional redirect URL after successful payment',
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
          description: 'Nomba checkout URL to redirect customer to',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input (email format, plan configuration, etc.)',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Invalid email format' },
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
  async createPublicCheckout(
    @Param('planId') planId: string,
    @Body() body: PublicPlanSessionDto,
  ) {
    return this.billingService.createPublicCheckout(planId, body);
  }
}
