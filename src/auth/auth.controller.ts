import {
  Controller,
  Delete,
  Param,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@ApiTags('merchant-dashboard/api-keys')
@ApiBearerAuth()
@Controller('admin/api-keys')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
      .merchantId as string;
    const success = await this.authService.revokeApiKey(merchantId, id);
    if (!success) {
      throw new NotFoundException(
        'API key not found or does not belong to this merchant',
      );
    }
    return { success: true, message: 'API key successfully revoked' };
  }
}
