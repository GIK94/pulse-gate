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
  Put,
} from '@nestjs/common';
import { ApiCookieAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { RateLimitDto } from '../common/dto';
import { AuthedUser, CurrentUser } from '../common/request-context';
import { RouteRuleDto } from './rate-limits.dto';
import { RateLimitsService } from './rate-limits.service';

@ApiTags('rate-limits')
@ApiCookieAuth()
@ApiSecurity('csrf')
@Controller('projects/:projectId/rate-limits')
export class RateLimitsController {
  constructor(private readonly limits: RateLimitsService) {}

  @Get()
  get(@CurrentUser() user: AuthedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.limits.get(user.id, projectId);
  }

  @Put('default')
  updateDefault(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RateLimitDto,
  ) {
    return this.limits.updateDefault(user.id, projectId, dto);
  }

  @Post('rules')
  createRule(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RouteRuleDto,
  ) {
    return this.limits.createRule(user.id, projectId, dto);
  }

  @Patch('rules/:ruleId')
  updateRule(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: RouteRuleDto,
  ) {
    return this.limits.updateRule(user.id, projectId, ruleId, dto);
  }

  @Delete('rules/:ruleId')
  @HttpCode(204)
  async deleteRule(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ): Promise<void> {
    await this.limits.deleteRule(user.id, projectId, ruleId);
  }
}
