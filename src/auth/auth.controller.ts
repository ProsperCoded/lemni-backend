import {
  Controller,
  Delete,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  NotFoundException,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Register a new merchant account',
    description: 'Create a new merchant account with email and password',
  })
  @ApiResponse({ status: 201, description: 'Merchant successfully registered' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async signup(
    @Body() body: { email: string; password: string; name: string },
  ) {
    return this.authService.signup(body.email, body.password, body.name);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Authenticate merchant and receive JWT tokens',
    description: 'Returns access token (1h) and refresh token (7d)',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      example: {
        accessToken: 'eyJhbG...',
        refreshToken: 'eyJhbG...',
        merchant: { id: 'uuid', email: 'test@example.com', name: 'Acme' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Refresh access token using refresh token',
    description: 'Returns a new access token (1h)',
  })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshAccessToken(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout (token invalidation on client)',
    description: 'Server-side logout - client should discard tokens',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout() {
    return { message: 'Successfully logged out. Please discard tokens.' };
  }
}

@ApiTags('merchant-dashboard/api-keys')
@ApiBearerAuth()
@Controller('admin/api-keys')
export class ApiKeysController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Generate a new API key',
    description:
      'Creates and returns a new API key. Store it securely - you will not see it again.',
  })
  @ApiResponse({
    status: 201,
    description: 'API key successfully generated',
    schema: {
      example: {
        rawKey: 'sk_test_abc123def456_xyz789abc123def456xyz789abc123',
        keyId: 'abc123def456',
        message: 'Store this key safely. You will not be able to see it again.',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async generateKey(
    @Body() body: { environment: 'test' | 'live' },
    @Request() req: Record<string, unknown>,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .sub as string;
    return this.authService.createApiKey(merchantId, body.environment);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List all API keys for the merchant',
    description: 'Returns a list of API keys with their metadata (without the secret)',
  })
  @ApiResponse({
    status: 200,
    description: 'API keys retrieved',
    schema: {
      example: [
        {
          id: 'abc123def456',
          environment: 'test',
          isActive: true,
          createdAt: '2026-07-04T10:00:00Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  async listKeys(@Request() req: Record<string, unknown>) {
    const merchantId = (req.user as Record<string, unknown>)
      .sub as string;
    return this.authService.listApiKeys(merchantId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Revoke an API key',
    description:
      'Marks the specified API key as inactive immediately, blocking any subsequent API requests using it.',
  })
  @ApiResponse({ status: 200, description: 'API key successfully revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized JWT session token' })
  @ApiResponse({
    status: 404,
    description: 'API key not found or does not belong to the merchant',
  })
  async revokeKey(
    @Param('id') id: string,
    @Request() req: Record<string, unknown>,
  ) {
    const merchantId = (req.user as Record<string, unknown>)
      .sub as string;
    const success = await this.authService.revokeApiKey(merchantId, id);
    if (!success) {
      throw new NotFoundException(
        'API key not found or does not belong to this merchant',
      );
    }
    return { success: true, message: 'API key successfully revoked' };
  }
}
