import { performance } from 'node:perf_hooks';
import { Inject, Injectable } from '@nestjs/common';
import {
  buildUpstreamTarget,
  classifyUpstreamError,
  createUpstreamDispatcher,
  sanitizeGatewayPath,
  SsrfError,
  validateUpstreamUrl,
} from '@pulsegate/shared';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export interface UpstreamTestResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
  testedAt: string;
}

/**
 * Performs a single GET against an upstream using the same SSRF-safe
 * connection path as the gateway. Response bodies are discarded and errors are
 * reduced to stable codes, so nothing from the upstream (or its credentials)
 * is echoed back to the caller.
 */
@Injectable()
export class UpstreamTester {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async test(input: {
    baseUrl: string;
    path?: string;
    connectTimeoutMs: number;
    responseTimeoutMs: number;
    authHeader?: { name: string; value: string };
  }): Promise<UpstreamTestResult> {
    const testedAt = new Date().toISOString();
    const t0 = performance.now();
    const elapsed = () => Math.round(performance.now() - t0);
    let url: URL;
    try {
      url = await validateUpstreamUrl(input.baseUrl, this.config.ssrf);
    } catch (err) {
      return {
        ok: false,
        status: null,
        latencyMs: elapsed(),
        error: err instanceof SsrfError ? err.code : 'invalid_url',
        testedAt,
      };
    }
    const sanitized = sanitizeGatewayPath(input.path ?? '/');
    if (!sanitized.ok)
      return { ok: false, status: null, latencyMs: 0, error: 'invalid_path', testedAt };
    const target = buildUpstreamTarget(url, sanitized.path, '');
    const dispatcher = createUpstreamDispatcher({
      allowPrivate: this.config.ssrf.allowPrivate,
      connectTimeoutMs: input.connectTimeoutMs,
      maxConnections: 1,
    });
    try {
      const headers: Record<string, string> = {
        'user-agent': 'PulseGate-ConnectionTest/1.0',
        accept: '*/*',
      };
      if (input.authHeader) headers[input.authHeader.name] = input.authHeader.value;
      const timeout = Math.min(input.responseTimeoutMs, 30_000);
      const res = await dispatcher.request({
        origin: target.origin,
        path: target.path,
        method: 'GET',
        headers,
        headersTimeout: timeout,
        bodyTimeout: timeout,
      });
      await res.body.dump({ limit: 64 * 1024 }).catch(() => undefined);
      return {
        ok: res.statusCode < 500,
        status: res.statusCode,
        latencyMs: elapsed(),
        error: res.statusCode >= 500 ? `upstream_${res.statusCode}` : null,
        testedAt,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        latencyMs: elapsed(),
        error: classifyUpstreamError(err).code,
        testedAt,
      };
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }
}
