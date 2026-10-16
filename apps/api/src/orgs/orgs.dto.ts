import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length, MaxLength } from 'class-validator';

export const ROLES = ['owner', 'admin', 'member'] as const;

export class CreateOrgDto {
  @ApiProperty({ example: 'Acme Inc' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name: string;
}

export class AddMemberDto {
  @ApiProperty({ example: 'teammate@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role: (typeof ROLES)[number];
}

export class UpdateMemberDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role: (typeof ROLES)[number];
}
