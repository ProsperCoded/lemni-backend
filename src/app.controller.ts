import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';

import { ApiKeyGuard } from './auth/guards/api-key.guard';

import { ApiTags } from '@nestjs/swagger';

@ApiTags('developer-apis/health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('test-api-key')
  @UseGuards(ApiKeyGuard)
  testApiKey(): { status: string } {
    return { status: 'authorized' };
  }
}
