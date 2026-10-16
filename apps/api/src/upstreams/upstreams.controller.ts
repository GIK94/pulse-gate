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
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthedUser, CurrentUser, RateLimit } from '../common/request-context';
import { CreateUpstreamDto, TestUpstreamDto, UpdateUpstreamDto } from './upstreams.dto';
import { UpstreamsService } from './upstreams.service';

@ApiTags('upstreams')
@ApiCookieAuth()
@ApiSecurity('csrf')
@Controller('projects/:projectId/upstreams')
export class UpstreamsController {
  constructor(private readonly upstreams: UpstreamsService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.upstreams.list(user.id, projectId);
  }

  @Post()
  @ApiOperation({
    summary: 'Register an upstream (validated against SSRF rules; starts disabled by default)',
  })
  create(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateUpstreamDto,
  ) {
    return this.upstreams.create(user.id, projectId, dto);
  }

  @Get(':upstreamId')
  get(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('upstreamId', ParseUUIDPipe) upstreamId: string,
  ) {
    return this.upstreams.get(user.id, projectId, upstreamId);
  }

  @Patch(':upstreamId')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('upstreamId', ParseUUIDPipe) upstreamId: string,
    @Body() dto: UpdateUpstreamDto,
  ) {
    return this.upstreams.update(user.id, projectId, upstreamId, dto);
  }

  @Delete(':upstreamId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('upstreamId', ParseUUIDPipe) upstreamId: string,
  ): Promise<void> {
    await this.upstreams.remove(user.id, projectId, upstreamId);
  }

  @Post(':upstreamId/test')
  @HttpCode(200)
  @RateLimit('upstream-test', 'upstreamTestLimit')
  @ApiOperation({ summary: 'Send a test GET to the upstream through the SSRF-safe client' })
  test(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('upstreamId', ParseUUIDPipe) upstreamId: string,
    @Body() dto: TestUpstreamDto,
  ) {
    return this.upstreams.test(user.id, projectId, upstreamId, dto);
  }

  @Get(':upstreamId/history')
  @ApiOperation({ summary: 'Configuration change history (secrets redacted)' })
  history(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('upstreamId', ParseUUIDPipe) upstreamId: string,
  ) {
    return this.upstreams.history(user.id, projectId, upstreamId);
  }
}
