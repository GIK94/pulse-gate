import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthedUser, CurrentUser } from '../common/request-context';
import { AddMemberDto, CreateOrgDto, UpdateMemberDto } from './orgs.dto';
import { OrgsService } from './orgs.service';

@ApiTags('organizations')
@ApiCookieAuth()
@ApiSecurity('csrf')
@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.orgs.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateOrgDto) {
    return this.orgs.create(user.id, dto.name);
  }

  @Get(':orgId')
  get(@CurrentUser() user: AuthedUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.orgs.get(user.id, orgId);
  }

  @Get(':orgId/members')
  members(@CurrentUser() user: AuthedUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.orgs.members(user.id, orgId);
  }

  @Post(':orgId/members')
  addMember(
    @CurrentUser() user: AuthedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.orgs.addMember(user.id, orgId, dto);
  }

  @Patch(':orgId/members/:userId')
  updateMember(
    @CurrentUser() user: AuthedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.orgs.updateMember(user.id, orgId, userId, dto);
  }

  @Delete(':orgId/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentUser() user: AuthedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.orgs.removeMember(user.id, orgId, userId);
  }
}
