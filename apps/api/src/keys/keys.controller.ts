import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthedUser, CurrentUser } from '../common/request-context';
import { CreateKeyDto, RotateKeyDto, UpdateKeyDto } from './keys.dto';
import { KeysService } from './keys.service';

@ApiTags('api-keys')
@ApiCookieAuth()
@ApiSecurity('csrf')
@Controller('projects/:projectId/keys')
export class KeysController {
  constructor(private readonly keys: KeysService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.keys.list(user.id, projectId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a client key. The raw key is returned once and cannot be retrieved again.',
  })
  create(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateKeyDto,
  ) {
    return this.keys.create(user.id, projectId, dto);
  }

  @Patch(':keyId')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @Body() dto: UpdateKeyDto,
  ) {
    return this.keys.update(user.id, projectId, keyId, dto);
  }

  @Post(':keyId/revoke')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ) {
    return this.keys.revoke(user.id, projectId, keyId);
  }

  @Post(':keyId/rotate')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Issue a replacement key (shown once); old key is revoked or expires after a grace period',
  })
  rotate(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @Body() dto: RotateKeyDto,
  ) {
    return this.keys.rotate(user.id, projectId, keyId, dto);
  }
}
