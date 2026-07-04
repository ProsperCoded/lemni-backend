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
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@ApiTags('merchant-dashboard/auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Register a new merchant account',
    description:
      'Create a new merchant account with email and password. Password must be at least 8 characters. Email must be unique.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password', 'name'],
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'acme@example.com',
          description: 'Unique merchant email address',
        },
        password: {
          type: 'string',
          format: 'password',
          example: 'SecurePassword123',
          minLength: 8,
          description: 'Password (minimum 8 characters)',
        },
        name: {
          type: 'string',
          example: 'Acme Corporation',
          description: 'Merchant display name',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Merchant successfully registered',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
        email: { type: 'string', format: 'email', example: 'acme@example.com' },
        name: { type: 'string', example: 'Acme Corporation' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or weak password' })
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
    description:
      'Authenticates merchant credentials and returns access token (1h expiry) and refresh token (7d expiry). Use access token for protected endpoints.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'acme@example.com',
          description: 'Registered merchant email',
        },
        password: {
          type: 'string',
          format: 'password',
          example: 'SecurePassword123',
          description: 'Merchant account password',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        accessToken: {
          type: 'string',
          example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          description: 'JWT access token (valid for 1 hour)',
        },
        refreshToken: {
          type: 'string',
          example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          description: 'JWT refresh token (valid for 7 days)',
        },
        merchant: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Refresh access token using refresh token',
    description:
      'Exchange a valid refresh token for a new access token (1h expiry). Use this before your access token expires to maintain an active session.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refreshToken'],
      properties: {
        refreshToken: {
          type: 'string',
          example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          description: 'Valid refresh token from login response',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    schema: {
      type: 'object',
      properties: {
        accessToken: {
          type: 'string',
          example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          description: 'New JWT access token (valid for 1 hour)',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshAccessToken(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout (invalidate session)',
    description:
      'Notifies the server of logout. Client should immediately discard stored tokens. Tokens are stateless; this is a notification endpoint.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully logged out',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Successfully logged out. Please discard tokens.',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
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
      'Creates and returns a new API key for merchant API authentication. The full key is returned only once - store it securely. Use test keys for development and live keys for production.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['environment'],
      properties: {
        environment: {
          type: 'string',
          enum: ['test', 'live'],
          example: 'test',
          description: 'API key environment. Use "test" for development, "live" for production.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'API key successfully generated',
    schema: {
      type: 'object',
      properties: {
        rawKey: {
          type: 'string',
          example: 'sk_test_abc123def456_xyz789abc123def456xyz789abc123',
          description: 'Complete API key. Store this securely - you will not see it again.',
        },
        keyId: {
          type: 'string',
          example: 'abc123def456',
          description: 'Key identifier for reference in dashboards',
        },
        message: {
          type: 'string',
          example: 'Store this key safely. You will not be able to see it again.',
          description: 'Security reminder',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid environment value' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT token' })
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
    description:
      'Returns a list of all API keys owned by the authenticated merchant, including their status and creation date. The secret part is never returned.',
  })
  @ApiResponse({
    status: 200,
    description: 'API keys retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'abc123def456',
            description: 'Key identifier',
          },
          environment: {
            type: 'string',
            enum: ['test', 'live'],
            example: 'test',
            description: 'Key environment',
          },
          isActive: {
            type: 'boolean',
            example: true,
            description: 'Whether the key is active (false if revoked)',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-07-04T10:00:00Z',
            description: 'Key creation timestamp',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT token' })
  async listKeys(@Request() req: Record<string, unknown>) {
    const merchantId = (req.user as Record<string, unknown>)
      .sub as string;
    return this.authService.listApiKeys(merchantId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke an API key',
    description:
      'Marks the specified API key as inactive immediately. All future requests using this key will be rejected with a 403 Forbidden response.',
  })
  @ApiResponse({
    status: 200,
    description: 'API key successfully revoked',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'API key successfully revoked' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT token' })
  @ApiResponse({
    status: 404,
    description: 'API key not found or does not belong to this merchant',
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
