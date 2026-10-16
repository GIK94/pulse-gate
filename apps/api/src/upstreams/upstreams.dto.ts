import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { trimString } from '../common/dto';

const PREFIX_RE = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;
const PREFIX_MSG = 'must start with "/" and contain only URL path characters';
const upperArray = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.toUpperCase() : v)) : value;

export class UpstreamAuthDto {
  @ApiProperty({ enum: ['none', 'bearer', 'header'] })
  @IsIn(['none', 'bearer', 'header'])
  type: 'none' | 'bearer' | 'header';

  @ApiPropertyOptional({ example: 'X-Api-Key', description: 'Header name when type = "header"' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  headerName?: string;

  @ApiPropertyOptional({
    description:
      'Credential value. Write-only: encrypted at rest and never returned. Omit on update to keep the existing secret.',
    writeOnly: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 4096)
  secret?: string;
}

export class CreateUpstreamDto {
  @ApiProperty({ example: 'Acme Store API' })
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({ example: 'https://api.acme-store.com' })
  @Transform(trimString)
  @IsString()
  @MaxLength(2048)
  baseUrl: string;

  @ApiPropertyOptional({
    example: '/',
    description: 'Gateway path prefix routed to this upstream (longest match wins)',
  })
  @IsOptional()
  @Matches(PREFIX_RE, { message: `matchPrefix ${PREFIX_MSG}` })
  @MaxLength(256)
  matchPrefix?: string;

  @ApiPropertyOptional({ default: true, description: 'Remove matchPrefix before forwarding' })
  @IsOptional()
  @IsBoolean()
  stripMatchPrefix?: boolean;

  @ApiPropertyOptional({ enum: HTTP_METHODS, isArray: true })
  @IsOptional()
  @Transform(upperArray)
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(HTTP_METHODS, { each: true })
  allowedMethods?: string[];

  @ApiPropertyOptional({
    example: ['/v1'],
    description: 'Gateway paths permitted for this upstream',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Matches(PREFIX_RE, { each: true, message: `each allowedPathPrefixes entry ${PREFIX_MSG}` })
  @MaxLength(256, { each: true })
  allowedPathPrefixes?: string[];

  @ApiPropertyOptional({ default: 3000 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(30_000)
  connectTimeoutMs?: number;

  @ApiPropertyOptional({ default: 15000 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(300_000)
  responseTimeoutMs?: number;

  @ApiPropertyOptional({ type: UpstreamAuthDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpstreamAuthDto)
  auth?: UpstreamAuthDto;

  @ApiPropertyOptional({
    default: false,
    description: 'New upstreams start disabled so they can be tested first',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateUpstreamDto extends PartialType(CreateUpstreamDto) {}

export class TestUpstreamDto {
  @ApiPropertyOptional({
    example: '/health',
    description: 'Path (relative to the base URL) to GET',
  })
  @IsOptional()
  @Matches(PREFIX_RE, { message: `path ${PREFIX_MSG}` })
  @MaxLength(512)
  path?: string;
}
