import {
  assertProductionEncryptionKeys,
  assertProductionSecret,
  envBool,
  envInt,
  envList,
  envStr,
  isProduction,
  resolveAllowPrivateUpstreams,
  SecretBox,
} from '@pulsegate/shared';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface LimitConfig {
  requests: number;
  windowSeconds: number;
}

export interface AppConfig {
  production: boolean;
  host: string;
  port: number;
  redisUrl: string;
  corsOrigins: string[];
  trustProxy: boolean;
  cookieSecure: boolean;
  sessionTtlHours: number;
  sessionIdleHours: number;
  registrationEnabled: boolean;
  apiKeyPepper: string;
  secretBox: SecretBox;
  ssrf: { allowPrivate: boolean; requireHttps: boolean; allowedPorts: number[] };
  gatewayPublicUrl: string;
  swaggerEnabled: boolean;
  managementLimit: LimitConfig;
  loginIpLimit: LimitConfig;
  loginEmailLimit: LimitConfig;
  upstreamTestLimit: LimitConfig;
  maxBodyBytes: string;
}

export function loadAppConfig(): AppConfig {
  const production = isProduction();
  const apiKeyPepper = envStr('API_KEY_PEPPER');
  assertProductionSecret('API_KEY_PEPPER', apiKeyPepper);
  assertProductionEncryptionKeys(process.env.ENCRYPTION_KEYS);
  const corsOrigins = envList('CORS_ORIGINS', production ? [] : ['http://localhost:5173']);
  const cookieSecure = envBool('COOKIE_SECURE', production);
  if (production && !cookieSecure) throw new Error('COOKIE_SECURE must be true in production');
  return {
    production,
    host: envStr('API_HOST', '0.0.0.0'),
    port: envInt('API_PORT', 4000, 1, 65535),
    redisUrl: envStr('REDIS_URL'),
    corsOrigins,
    trustProxy: envBool('TRUST_PROXY', false),
    cookieSecure,
    sessionTtlHours: envInt('SESSION_TTL_HOURS', 24 * 7, 1),
    sessionIdleHours: envInt('SESSION_IDLE_HOURS', 24, 1),
    registrationEnabled: envBool('REGISTRATION_ENABLED', true),
    apiKeyPepper,
    secretBox: SecretBox.fromEnv(process.env.ENCRYPTION_KEYS),
    ssrf: {
      allowPrivate: resolveAllowPrivateUpstreams(),
      requireHttps: envBool('UPSTREAM_REQUIRE_HTTPS', production),
      allowedPorts: envList('UPSTREAM_ALLOWED_PORTS').map((p) => {
        const n = Number(p);
        if (!Number.isInteger(n) || n < 1 || n > 65535)
          throw new Error(`Invalid port in UPSTREAM_ALLOWED_PORTS: ${p}`);
        return n;
      }),
    },
    gatewayPublicUrl: envStr('GATEWAY_PUBLIC_URL', 'http://localhost:8787').replace(/\/$/, ''),
    swaggerEnabled: envBool('SWAGGER_ENABLED', !production),
    managementLimit: {
      requests: envInt('MGMT_RATE_LIMIT_REQUESTS', 600, 1),
      windowSeconds: envInt('MGMT_RATE_LIMIT_WINDOW_SECONDS', 60, 1),
    },
    loginIpLimit: { requests: envInt('LOGIN_RATE_LIMIT_PER_IP', 20, 1), windowSeconds: 60 },
    loginEmailLimit: { requests: envInt('LOGIN_RATE_LIMIT_PER_EMAIL', 10, 1), windowSeconds: 900 },
    upstreamTestLimit: { requests: envInt('UPSTREAM_TEST_RATE_LIMIT', 20, 1), windowSeconds: 60 },
    maxBodyBytes: envStr('API_MAX_BODY', '100kb'),
  };
}
