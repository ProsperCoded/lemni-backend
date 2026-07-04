import { Controller, Delete, Param, UseGuards, Request, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@Controller('admin/api-keys')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async revokeKey(@Param('id') id: string, @Request() req: any) {
    // Extract merchantId injected by JwtAuthGuard/Strategy
    const merchantId = req.user.merchantId;
    const success = await this.authService.revokeApiKey(merchantId, id);
    if (!success) {
      throw new NotFoundException('API key not found or does not belong to this merchant');
    }
    return { success: true, message: 'API key successfully revoked' };
  }
}
