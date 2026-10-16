import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Response } from 'express';
import {
  AppRequest,
  CurrentUser,
  AuthedUser,
  Public,
  RateLimit,
  SESSION_COOKIE,
} from '../common/request-context';
import { SessionsService } from '../common/sessions.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService, SessionResult } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/api',
      expires,
    };
  }

  private respond(res: Response, s: SessionResult) {
    res.cookie(SESSION_COOKIE, s.token, this.cookieOptions(s.expiresAt));
    return { user: s.user, csrfToken: s.csrfToken };
  }

  @Public()
  @RateLimit('register', 'loginIpLimit')
  @Post('register')
  @ApiOperation({ summary: 'Create an account and a personal organization; starts a session' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.register(dto, req.headers['user-agent']));
  }

  @Public()
  @RateLimit('login', 'loginIpLimit')
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start a session (sets an HttpOnly cookie) and return the CSRF token' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(dto, req.headers['user-agent']));
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (req.sessionInfo) await this.sessions.destroy(req.sessionInfo.id);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Current user, organizations and the CSRF token for this session' })
  async me(@CurrentUser() user: AuthedUser, @Req() req: AppRequest) {
    return {
      user,
      organizations: await this.auth.me(user.id),
      csrfToken: req.sessionInfo?.csrfToken,
    };
  }
}
