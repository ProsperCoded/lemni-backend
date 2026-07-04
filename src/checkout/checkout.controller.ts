import { Controller, Post, Get, Body, Param, UseGuards, Request, UsePipes, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiParam } from '@nestjs/swagger';
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

@Controller('api/v1')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @ApiTags('developer-apis/checkout')
  @ApiHeader({ name: 'Authorization', description: 'Bearer <API_KEY>', required: true })
  @Post('pay')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @UsePipes(new ZodValidationPipe(OneTimePaymentSchema))
  @ApiOperation({
    summary: 'Create a one-time checkout session',
    description: 'Generates a payment URL for a singular checkout charge.',
  })
  @ApiResponse({ status: 200, description: 'Checkout session successfully created' })
  @ApiResponse({ status: 401, description: 'Unauthorized API key' })
  async createOneTimePayment(
    @Body() body: OneTimePaymentDto,
    @Request() req: any,
  ) {
    return this.checkoutService.createOneTimePayment(req.merchantId, req.environment, body);
  }

  @ApiTags('developer-apis/checkout')
  @ApiHeader({ name: 'Authorization', description: 'Bearer <API_KEY>', required: true })
  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @UsePipes(new ZodValidationPipe(SubscriptionPaymentSchema))
  @ApiOperation({
    summary: 'Create a subscription checkout session',
    description: 'Generates a payment URL to register a customer to a recurring pricing plan.',
  })
  @ApiResponse({ status: 200, description: 'Checkout session successfully created' })
  @ApiResponse({ status: 401, description: 'Unauthorized API key' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async createSubscriptionPayment(
    @Body() body: SubscriptionPaymentDto,
    @Request() req: any,
  ) {
    return this.checkoutService.createSubscriptionPayment(req.merchantId, req.environment, body);
  }

  @ApiTags('developer-apis/checkout')
  @Get('sessions/:id/status')
  @ApiOperation({
    summary: 'Poll checkout session status',
    description: 'Enables frontend checkouts or backend applications to poll for session completion status.',
  })
  @ApiParam({ name: 'id', description: 'The unique session ID / transaction ID' })
  @ApiResponse({ status: 200, description: 'Session status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getCheckoutSessionStatus(@Param('id') id: string) {
    return this.checkoutService.getCheckoutSessionStatus(id);
  }

  @ApiTags('developer-apis/checkout')
  @Post('checkout/plans/:planId/sessions')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PublicPlanSessionSchema))
  @ApiOperation({
    summary: 'Generate public plan checkout session',
    description: 'Allows off-the-shelf payment links to initialize checkout sessions for customer emails.',
  })
  @ApiParam({ name: 'planId', description: 'The static pricing plan ID' })
  @ApiResponse({ status: 200, description: 'Checkout session generated' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async createPublicPlanSession(
    @Param('planId') planId: string,
    @Body() body: PublicPlanSessionDto,
  ) {
    return this.checkoutService.createPublicPlanSession(planId, body);
  }
}
