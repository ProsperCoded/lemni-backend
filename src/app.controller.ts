import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';

import { ApiKeyGuard } from './auth/guards/api-key.guard';

import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('developer-apis/health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Returns server status. Use this to verify the API is running and accessible.',
  })
  @ApiResponse({
    status: 200,
    description: 'Server is healthy and running',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Hello from Lemni PaaS' },
      },
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/v1/health')
  @ApiOperation({
    summary: 'API health check',
    description:
      'Returns API status. Use this to verify the API service is running.',
  })
  @ApiResponse({
    status: 200,
    description: 'API is healthy and running',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2026-07-05T12:03:00Z' },
      },
    },
  })
  healthCheck(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('test-api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Test API key validity',
    description:
      'Verifies that the provided API key in the Authorization header is valid and authorized. Use this to test your API key configuration.',
  })
  @ApiResponse({
    status: 200,
    description: 'API key is valid and authorized',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'authorized' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid, or revoked API key',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
  testApiKey(): { status: string } {
    return { status: 'authorized' };
  }
}
