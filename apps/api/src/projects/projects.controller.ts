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
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiCookieAuth()
@ApiSecurity('csrf')
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('orgs/:orgId/projects')
  list(@CurrentUser() user: AuthedUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.projects.list(user.id, orgId);
  }

  @Post('orgs/:orgId/projects')
  create(
    @CurrentUser() user: AuthedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user.id, orgId, dto);
  }

  @Get('projects/:projectId')
  get(@CurrentUser() user: AuthedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projects.get(user.id, projectId);
  }

  @Patch('projects/:projectId')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.id, projectId, dto);
  }

  @Delete('projects/:projectId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<void> {
    await this.projects.remove(user.id, projectId);
  }
}
