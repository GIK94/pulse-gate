import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class RateLimitDto {
  @ApiProperty({ example: 600, minimum: 1, maximum: 1_000_000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  requests: number;

  @ApiProperty({ example: 60, minimum: 1, maximum: 86400 })
  @IsInt()
  @Min(1)
  @Max(86_400)
  windowSeconds: number;
}

export const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
