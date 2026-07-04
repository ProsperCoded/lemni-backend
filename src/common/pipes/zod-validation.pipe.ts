import { PipeTransform, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    // Only validate body or query payloads; ignore route params if not targeted
    if (metadata.type !== 'body' && metadata.type !== 'query') {
      return value;
    }

    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.errors,
      });
    }
    return result.data;
  }
}
