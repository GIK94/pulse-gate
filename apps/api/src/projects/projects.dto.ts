import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { SLUG_RE } from '@pulsegate/shared';
import { RateLimitDto, trimString } from '../common/dto';

export class CreateProjectDto {
  @ApiProperty({ example: 'Acme Store' })
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({
    example: 'acme-store',
    description:
      'Gateway path segment; lowercase letters, digits and dashes (3-48). Immutable once created.',
  })
  @IsOptional()
  @Transform(trimString)
  @Matches(SLUG_RE, { message: 'slug must be 3-48 lowercase letters, digits or dashes' })
  slug?: string;

  @ApiPropertyOptional({ type: RateLimitDto, description: 'Default per-key rate limit' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RateLimitDto)
  rateLimit?: RateLimitDto;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}
