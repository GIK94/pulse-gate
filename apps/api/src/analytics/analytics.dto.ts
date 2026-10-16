import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { HTTP_METHODS, REQUEST_OUTCOMES } from '@pulsegate/shared';

export const RANGES = {
  '15m': { ms: 15 * 60_000, bucket: '30 seconds' },
  '1h': { ms: 60 * 60_000, bucket: '1 minute' },
  '24h': { ms: 24 * 60 * 60_000, bucket: '15 minutes' },
  '7d': { ms: 7 * 24 * 60 * 60_000, bucket: '1 hour' },
} as const;
export type RangeKey = keyof typeof RANGES;
const RANGE_KEYS = Object.keys(RANGES);

export const PROJECT_DIMENSIONS = [
  'route',
  'method',
  'status',
  'apiKey',
  'upstream',
  'outcome',
] as const;
export const ORG_DIMENSIONS = [...PROJECT_DIMENSIONS, 'project'] as const;
export type Dimension = (typeof ORG_DIMENSIONS)[number];

export class RangeQueryDto {
  @ApiPropertyOptional({ enum: RANGE_KEYS, default: '1h' })
  @IsOptional()
  @IsIn(RANGE_KEYS)
  range?: RangeKey;
}

export class BreakdownQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({ enum: ORG_DIMENSIONS, default: 'route' })
  @IsOptional()
  @IsIn(ORG_DIMENSIONS)
  dimension?: Dimension;
}

export class RequestsQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({ description: 'Exact status (e.g. 404) or class (2xx, 3xx, 4xx, 5xx)' })
  @IsOptional()
  @Matches(/^([1-5]xx|[1-5]\d\d)$/)
  status?: string;

  @ApiPropertyOptional({ enum: HTTP_METHODS })
  @IsOptional()
  @IsIn(HTTP_METHODS)
  method?: string;

  @ApiPropertyOptional({ enum: REQUEST_OUTCOMES })
  @IsOptional()
  @IsIn(REQUEST_OUTCOMES)
  outcome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  apiKeyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  upstreamId?: string;

  @ApiPropertyOptional({ description: 'Path prefix filter, e.g. /orders' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  path?: string;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
