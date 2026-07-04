import { Controller, Post, Delete, Body, Param, UseGuards, Request, HttpCode, HttpStatus, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreatePlanSchema, RegisterCustomerSchema } from './dto/billing.dto';
import type { CreatePlanDto, RegisterCustomerDto } from './dto/billing.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @ApiTags('merchant-dashboard/plans')
  @Post('plans')
  @UsePipes(new ZodValidationPipe(CreatePlanSchema))
  @ApiOperation({
    summary: 'Create a billing plan',
    description: 'Registers a new recurring or one-time subscription plan in the system.',
  })
  @ApiResponse({ status: 201, description: 'Plan successfully created' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async createPlan(
    @Body() body: CreatePlanDto,
    @Request() req: any,
  ) {
    const merchantId = req.user.merchantId;
    return this.billingService.createPlan(merchantId, body);
  }

  @ApiTags('merchant-dashboard/plans')
  @Delete('plans/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a billing plan',
    description: 'Removes a subscription plan if no active or trialing customers are attached to it.',
  })
  @ApiResponse({ status: 240, description: 'Plan successfully deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete plan due to active subscriptions' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async deletePlan(@Param('id') id: string, @Request() req: any) {
    const merchantId = req.user.merchantId;
    await this.billingService.deletePlan(merchantId, id);
  }

  @ApiTags('merchant-dashboard/customers')
  @Post('customers')
  @UsePipes(new ZodValidationPipe(RegisterCustomerSchema))
  @ApiOperation({
    summary: 'Register a customer',
    description: 'Registers a customer under the current merchant, preparing them for subscription charges.',
  })
  @ApiResponse({ status: 201, description: 'Customer successfully registered' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async registerCustomer(
    @Body() body: RegisterCustomerDto,
    @Request() req: any,
  ) {
    const merchantId = req.user.merchantId;
    return this.billingService.registerCustomer(merchantId, body);
  }

  @ApiTags('merchant-dashboard/subscriptions')
  @Post('subscriptions/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a canceled subscription',
    description: 'Resets the billing cycle start date and shifts the subscription back to active status.',
  })
  @ApiResponse({ status: 200, description: 'Subscription successfully reactivated' })
  @ApiResponse({ status: 400, description: 'Subscription is not canceled or card is missing' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  @ApiResponse({ status: 404, description: 'Subscription or associated plan not found' })
  async reactivateSubscription(@Param('id') id: string, @Request() req: any) {
    const merchantId = req.user.merchantId;
    return this.billingService.reactivateSubscription(merchantId, id);
  }
}
