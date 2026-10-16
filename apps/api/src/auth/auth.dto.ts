import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @ApiProperty({ example: 'dev@example.com' })
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 10, maxLength: 128 })
  @IsString()
  @Length(10, 128)
  password: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({ example: 'Acme Inc' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  organizationName?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'demo@pulsegate.local' })
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @Length(1, 128)
  password: string;
}
