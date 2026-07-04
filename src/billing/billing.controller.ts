import { Controller, Post, Delete, Body, Param, UseGuards, Request, HttpCode, HttpStatus, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreatePlanSchema, RegisterCustomerSchema } from './dto/billing.dto';
import type { CreatePlanDto, RegisterCustomerDto } from './dto/billing.dto';

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
    description: 'Registers a new recurring or one-time subscription plan in the system.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'amount'],
      properties: {
        name: { type: 'string', example: 'Standard Subscription Plan' },
        amount: { type: 'number', format: 'float', example: 29.99 },
        billingModel: { type: 'string', enum: ['recurring', 'one_time', 'custom_input'], default: 'recurring', example: 'recurring' },
        interval: { type: 'string', enum: ['weekly', 'monthly', 'yearly'], example: 'monthly' },
        trialDays: { type: 'integer', format: 'int32', default: 0, example: 7 },
        trialRequireCard: { type: 'boolean', default: false, example: true },
        gracePeriodDays: { type: 'integer', format: 'int32', default: 0, example: 3 },
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
    @Request() req: any,
  ) {
    const merchantId = req.user.merchantId;
    return this.billingService.createPlan(merchantId, body);
  }

  @Delete('plans/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a billing plan',
    description: 'Removes a subscription plan if no active or trialing customers are attached to it.',
  })
  @ApiResponse({ status: 204, description: 'Plan successfully deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete plan due to active subscriptions' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async deletePlan(@Param('id') id: string, @Request() req: any) {
    const merchantId = req.user.merchantId;
    await this.billingService.deletePlan(merchantId, id);
  }

  @Post('customers')
  @UsePipes(new ZodValidationPipe(RegisterCustomerSchema))
  @ApiOperation({
    summary: 'Register a customer',
    description: 'Registers a customer under the current merchant, preparing them for subscription charges.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email', example: 'customer@test.com' },
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
        email: { type: 'string', format: 'email', example: 'customer@test.com' },
        nombaToken: { type: 'string', nullable: true, example: null },
        createdAt: { type: 'string', format: 'date-time', example: '2026-07-04T02:00:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async registerCustomer(
    @Body() body: RegisterCustomerDto,
    @Request() req: any,
  ) {
    const merchantId = req.user.merchantId;
    return this.billingService.registerCustomer(merchantId, body);
  }

  @Post('subscriptions/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a canceled subscription',
    description: 'Resets the billing cycle start date and shifts the subscription back to active status.',
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
        currentPeriodEnd: { type: 'string', format: 'date-time', example: '2026-08-04T02:00:00.000Z' },
        trialEnd: { type: 'string', format: 'date-time', nullable: true, example: null },
        createdAt: { type: 'string', format: 'date-time', example: '2026-07-04T02:00:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Subscription is not canceled or card is missing' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  @ApiResponse({ status: 404, description: 'Subscription or associated plan not found' })
  async reactivateSubscription(@Param('id') id: string, @Request() req: any) {
    const merchantId = req.user.merchantId;
    return this.billingService.reactivateSubscription(merchantId, id);
  }
}
