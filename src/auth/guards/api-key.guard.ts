import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization scheme. Use Bearer <API_KEY>');
    }

    const authContext = await this.authService.validateApiKey(token);
    if (!authContext) {
      throw new UnauthorizedException('Invalid or inactive API key');
    }

    // Attach merchant info and environment mode to the request context
    request.merchantId = authContext.merchantId;
    request.environment = authContext.environment;

    return true;
  }
}
export interface AuthenticatedRequest extends Request {
  merchantId: string;
  environment: 'test' | 'live';
}
