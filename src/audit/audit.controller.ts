import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';
import { CustomerListFilterSchema } from './dto/audit.dto';
import type { CustomerListFilterDto } from './dto/audit.dto';

@ApiTags('merchant-dashboard/audit')
@Controller('admin/customers')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(CustomerListFilterSchema))
  @ApiOperation({
    summary: 'List customers for dispute/audit lookup',
    description:
      'Returns customers belonging to the merchant with their latest subscription status. Supports search by email or customer ID.',
  })
  @ApiResponse({ status: 200, description: 'Customer list retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async listCustomers(
    @Query() query: CustomerListFilterDto,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.auditService.listCustomers(merchantId, query);
  }

  @Get(':id/audit')
  @ApiParam({ name: 'id', description: 'The customer ID' })
  @ApiOperation({
    summary: 'Get full chargeback-evidence audit trail for a customer',
    description:
      'Returns customer profile, signup footprint, subscription history, payment attempts, and lifecycle event timeline for generating dispute evidence packages.',
  })
  @ApiResponse({ status: 200, description: 'Customer audit trail retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async getCustomerAudit(
    @Param('id') id: string,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.auditService.getCustomerAudit(merchantId, id);
  }
}
