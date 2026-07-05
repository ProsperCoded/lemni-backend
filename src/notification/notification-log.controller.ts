import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  Request,
  UsePipes,
  HttpCode,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { NotificationLogService } from './notification-log.service';
import {
  NotificationLogFilterSchema,
  MarkNotificationsReadSchema,
} from './dto/notification-log.dto';
import type {
  NotificationLogFilterDto,
  MarkNotificationsReadDto,
} from './dto/notification-log.dto';

@ApiTags('merchant-dashboard/notifications')
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationLogController {
  constructor(
    private readonly notificationLogService: NotificationLogService,
  ) {}

  @Get()
  @UsePipes(new ZodValidationPipe(NotificationLogFilterSchema))
  @ApiOperation({
    summary: 'List notification audit logs',
    description:
      'Returns persisted billing/system/subscription event notifications for the merchant, regardless of Telegram delivery status.',
  })
  @ApiResponse({ status: 200, description: 'Notification logs retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async list(
    @Query() query: NotificationLogFilterDto,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.notificationLogService.list(merchantId, query);
  }

  @Post('mark-read')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(MarkNotificationsReadSchema))
  @ApiOperation({
    summary: 'Mark notification(s) as read',
    description:
      'Marks specific notification IDs as read, or all of them if `all: true` is passed.',
  })
  @ApiResponse({ status: 200, description: 'Notifications marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async markRead(
    @Body() body: MarkNotificationsReadDto,
    @Request() req: ExpressRequest,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.notificationLogService.markRead(merchantId, body);
  }

  @Delete()
  @ApiOperation({
    summary: 'Clear notification history',
    description: 'Permanently deletes all notification logs for the merchant.',
  })
  @ApiResponse({ status: 200, description: 'Notification history cleared' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async clear(@Request() req: ExpressRequest) {
    const merchantId = (req.user as Record<string, unknown>)
      .merchantId as string;
    return this.notificationLogService.clear(merchantId);
  }
}
