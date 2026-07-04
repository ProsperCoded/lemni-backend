import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiExcludeController,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DlqService } from './dlq.service';

@ApiExcludeController()
@ApiTags('merchant-dashboard/dlq')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/dlq')
export class DlqController {
  constructor(private readonly dlqService: DlqService) {}

  @Get()
  @ApiOperation({
    summary: 'List dead letter queue jobs',
    description:
      'Returns all jobs that have been moved to the Dead Letter Queue after exhausting their retry attempts. Each entry includes the full payload, error reason, retry history, and failure timestamp.',
  })
  @ApiResponse({
    status: 200,
    description: 'DLQ entries returned successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'dlq-sub_a28deca9-1720051200000' },
          subscriptionId: {
            type: 'string',
            nullable: true,
            example: 'sub_a28deca9',
          },
          payload: {
            type: 'object',
            properties: {
              subscriptionId: { type: 'string', example: 'sub_a28deca9' },
              customerId: { type: 'string', example: 'cust_8a9d2ca8b10' },
              planId: { type: 'string', example: 'plan_7a8dca9' },
              amount: { type: 'number', format: 'float', example: 29.99 },
              merchantId: { type: 'string', example: 'merchant-test-123' },
              retryCount: { type: 'integer', format: 'int32', example: 3 },
            },
          },
          errorReason: {
            type: 'string',
            example: 'Grace period exhausted after 3 retries',
          },
          retryHistory: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                attempt: { type: 'integer', format: 'int32', example: 3 },
                failedAt: {
                  type: 'string',
                  format: 'date-time',
                  example: '2026-07-04T02:00:00.000Z',
                },
                reason: { type: 'string', example: 'card_declined' },
              },
            },
          },
          failedAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-07-04T02:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async listDlq() {
    return this.dlqService.listDlqJobs();
  }

  @Post(':jobId/replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replay a dead letter queue job',
    description:
      'Re-enqueues a specific DLQ job back into the ChargeQueue for retry. The DLQ entry is removed after successful re-enqueue. Use this after resolving the root cause (e.g., updating card details).',
  })
  @ApiParam({
    name: 'jobId',
    description: 'The DLQ job ID to replay',
    example: 'dlq-sub_a28deca9-1720051200000',
  })
  @ApiResponse({
    status: 200,
    description: 'Job re-enqueued successfully',
    schema: {
      type: 'object',
      properties: {
        enqueued: { type: 'boolean', example: true },
        jobId: { type: 'string', example: 'dlq-sub_a28deca9-1720051200000' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  @ApiResponse({ status: 404, description: 'DLQ job not found' })
  async replayDlqJob(@Param('jobId') jobId: string) {
    return this.dlqService.replayDlqJob(jobId);
  }
}
