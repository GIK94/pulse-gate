import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { HTTP_METHODS } from '@pulsegate/shared';
import { RateLimitDto, trimString } from '../common/dto';

const PREFIX_RE = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;

export class KeyPolicyDto {
  @ApiPropertyOptional({
    enum: HTTP_METHODS,
    isArray: true,
    nullable: true,
    description: 'null = all methods',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.toUpperCase() : v)) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(HTTP_METHODS, { each: true })
  allowedMethods?: string[] | null;

  @ApiPropertyOptional({ example: ['/products'], nullable: true, description: 'null = all routes' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Matches(PREFIX_RE, { each: true, message: 'each route prefix must start with "/"' })
  @MaxLength(256, { each: true })
  allowedPathPrefixes?: string[] | null;

  @ApiPropertyOptional({
    type: RateLimitDto,
    nullable: true,
    description: 'Overrides the project default; null = inherit',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RateLimitDto)
  rateLimit?: RateLimitDto | null;
}

export class CreateKeyDto extends KeyPolicyDto {
  @ApiProperty({ example: 'Production web app' })
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({ example: '2030-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateKeyDto extends KeyPolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  name?: string;
}

export class RotateKeyDto {
  @ApiPropertyOptional({
    default: 0,
    maximum: 604800,
    description: 'Seconds the old key keeps working after rotation (0 = revoke immediately)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(604_800)
  gracePeriodSeconds?: number;
}
