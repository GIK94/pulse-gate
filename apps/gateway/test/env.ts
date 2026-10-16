process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://pulsegate:pulsegate@localhost:55432/pulsegate_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/2';
process.env.API_KEY_PEPPER = 'test-pepper-not-secret';
process.env.ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 7).toString('base64')}`;
process.env.ALLOW_PRIVATE_UPSTREAMS = 'true';
process.env.LOG_LEVEL = 'silent';
process.env.GATEWAY_CONFIG_CACHE_TTL_MS = '60000';
