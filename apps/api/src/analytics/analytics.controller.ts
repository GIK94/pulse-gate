import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { AuthedUser, CurrentUser } from '../common/request-context';
import {
  BreakdownQueryDto,
  PROJECT_DIMENSIONS,
  RangeQueryDto,
  RequestsQueryDto,
} from './analytics.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiCookieAuth()
@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly access: AccessService,
  ) {}

  @Get('projects/:projectId/analytics/summary')
  @ApiOperation({
    summary: 'Totals, success/error rates, latency percentiles and rate-limited count',
  })
  async projectSummary(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() q: RangeQueryDto,
  ) {
    await this.access.requireProject(user.id, projectId);
    return this.analytics.summary({ kind: 'project', id: projectId }, q.range);
  }

  @Get('projects/:projectId/analytics/timeseries')
  async projectTimeseries(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() q: RangeQueryDto,
  ) {
    await this.access.requireProject(user.id, projectId);
    return this.analytics.timeseries({ kind: 'project', id: projectId }, q.range);
  }

  @Get('projects/:projectId/analytics/breakdown')
  @ApiOperation({ summary: `Top values by dimension (${PROJECT_DIMENSIONS.join(', ')})` })
  async projectBreakdown(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() q: BreakdownQueryDto,
  ) {
    await this.access.requireProject(user.id, projectId);
    return this.analytics.breakdown({ kind: 'project', id: projectId }, q.dimension, q.range);
  }

  @Get('projects/:projectId/analytics/upstream-health')
  async upstreamHealth(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.access.requireProject(user.id, projectId);
    return this.analytics.upstreamHealth(projectId);
  }

  @Get('projects/:projectId/requests')
  @ApiOperation({ summary: 'Recent request metadata with filters and cursor pagination' })
  async requests(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() q: RequestsQueryDto,
  ) {
    await this.access.requireProject(user.id, projectId);
    return this.analytics.requests(projectId, q);
  }

  @Get('projects/:projectId/requests/:requestId')
  async request(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    await this.access.requireProject(user.id, projectId);
    return this.analytics.request(projectId, requestId);
  }

  @Get('orgs/:orgId/analytics/summary')
  async orgSummary(
    @CurrentUser() user: AuthedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: RangeQueryDto,
  ) {
    await this.access.requireOrg(user.id, orgId);
    return this.analytics.summary({ kind: 'org', id: orgId }, q.range);
  }

  @Get('orgs/:orgId/analytics/timeseries')
  async orgTimeseries(
    @CurrentUser() user: AuthedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: RangeQueryDto,
  ) {
    await this.access.requireOrg(user.id, orgId);
    return this.analytics.timeseries({ kind: 'org', id: orgId }, q.range);
  }

  @Get('orgs/:orgId/analytics/breakdown')
  async orgBreakdown(
    @CurrentUser() user: AuthedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: BreakdownQueryDto,
  ) {
    await this.access.requireOrg(user.id, orgId);
    return this.analytics.breakdown({ kind: 'org', id: orgId }, q.dimension ?? 'project', q.range);
  }
}
