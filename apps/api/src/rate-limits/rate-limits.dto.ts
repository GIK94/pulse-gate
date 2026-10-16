import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, MaxLength, Min } from 'class-validator';
import { HTTP_METHODS } from '@pulsegate/shared';

export class RouteRuleDto {
  @ApiProperty({ example: '/orders', description: 'Gateway path prefix the rule applies to' })
  @Matches(/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/, { message: 'pathPrefix must start with "/"' })
  @MaxLength(256)
  pathPrefix: string;

  @ApiPropertyOptional({ enum: HTTP_METHODS, nullable: true, description: 'null = any method' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(HTTP_METHODS)
  method?: string | null;

  @ApiProperty({ example: 60 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  requests: number;

  @ApiProperty({ example: 60 })
  @IsInt()
  @Min(1)
  @Max(86_400)
  windowSeconds: number;
}
