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
    description: 'Returns server status. Use this to verify the API is running and accessible.',
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

  @Get('test-api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Test API key validity',
    description: 'Verifies that the provided API key in the Authorization header is valid and authorized. Use this to test your API key configuration.',
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
