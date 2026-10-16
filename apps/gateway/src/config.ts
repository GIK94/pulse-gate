import { hostname } from 'node:os';
import {
  assertProductionEncryptionKeys,
  assertProductionSecret,
  envBool,
  envInt,
  envStr,
  resolveAllowPrivateUpstreams,
  SecretBox,
} from '@pulsegate/shared';

export interface GatewayConfig {
  host: string;
  port: number;
  adminPort: number;
  gatewayId: string;
  redisUrl: string;
  apiKeyPepper: string;
  secretBox: SecretBox;
  allowPrivateUpstreams: boolean;
  trustProxy: boolean;
  maxRequestBodyBytes: number;
  maxResponseBodyBytes: number;
  maxConcurrency: number;
  maxUpstreamTimeoutMs: number;
  upstreamMaxConnections: number;
  configCacheTtlMs: number;
  configStaleMaxMs: number;
  keyCacheMaxEntries: number;
  rateLimitFailureMode: 'closed' | 'open';
  redisCommandTimeoutMs: number;
  analytics: {
    flushIntervalMs: number;
    batchSize: number;
    maxBuffer: number;
    streamMaxLen: number;
  };
  shutdownGraceMs: number;
  accessLog: boolean;
  logLevel: string;
}

export function loadGatewayConfig(): GatewayConfig {
  const apiKeyPepper = envStr('API_KEY_PEPPER');
  assertProductionSecret('API_KEY_PEPPER', apiKeyPepper);
  assertProductionEncryptionKeys(process.env.ENCRYPTION_KEYS);
  const failureMode = envStr('RATE_LIMIT_FAILURE_MODE', 'closed');
  if (failureMode !== 'closed' && failureMode !== 'open') {
    throw new Error('RATE_LIMIT_FAILURE_MODE must be "closed" or "open"');
  }
  return {
    host: envStr('GATEWAY_HOST', '0.0.0.0'),
    port: envInt('GATEWAY_PORT', 8787, 1, 65535),
    adminPort: envInt('GATEWAY_ADMIN_PORT', 9464, 0, 65535),
    gatewayId: envStr('GATEWAY_ID', hostname()),
    redisUrl: envStr('REDIS_URL'),
    apiKeyPepper,
    secretBox: SecretBox.fromEnv(process.env.ENCRYPTION_KEYS),
    allowPrivateUpstreams: resolveAllowPrivateUpstreams(),
    trustProxy: envBool('TRUST_PROXY', false),
    maxRequestBodyBytes: envInt('GATEWAY_MAX_REQUEST_BODY_BYTES', 10 * 1024 * 1024, 0),
    maxResponseBodyBytes: envInt('GATEWAY_MAX_RESPONSE_BODY_BYTES', 50 * 1024 * 1024, 1),
    maxConcurrency: envInt('GATEWAY_MAX_CONCURRENCY', 2000, 1),
    maxUpstreamTimeoutMs: envInt('GATEWAY_MAX_UPSTREAM_TIMEOUT_MS', 120_000, 100),
    upstreamMaxConnections: envInt('GATEWAY_UPSTREAM_MAX_CONNECTIONS', 256, 1),
    configCacheTtlMs: envInt('GATEWAY_CONFIG_CACHE_TTL_MS', 5_000, 0),
    configStaleMaxMs: envInt('GATEWAY_CONFIG_STALE_MAX_MS', 60_000, 0),
    keyCacheMaxEntries: envInt('GATEWAY_KEY_CACHE_MAX', 50_000, 100),
    rateLimitFailureMode: failureMode,
    redisCommandTimeoutMs: envInt('GATEWAY_REDIS_COMMAND_TIMEOUT_MS', 1000, 10),
    analytics: {
      flushIntervalMs: envInt('ANALYTICS_FLUSH_INTERVAL_MS', 250, 10),
      batchSize: envInt('ANALYTICS_BATCH_SIZE', 500, 1),
      maxBuffer: envInt('ANALYTICS_MAX_BUFFER', 50_000, 100),
      streamMaxLen: envInt('ANALYTICS_STREAM_MAXLEN', 1_000_000, 1000),
    },
    shutdownGraceMs: envInt('SHUTDOWN_GRACE_MS', 15_000, 0),
    accessLog: envBool('GATEWAY_ACCESS_LOG', false),
    logLevel: envStr('LOG_LEVEL', 'info'),
  };
}
