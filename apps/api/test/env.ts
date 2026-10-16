// Test environment. Uses a dedicated database and Redis logical DB so tests never touch dev data.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://pulsegate:pulsegate@localhost:55432/pulsegate_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/1';
process.env.API_KEY_PEPPER = 'test-pepper-not-secret';
process.env.ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 7).toString('base64')}`;
process.env.ALLOW_PRIVATE_UPSTREAMS = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.LOGIN_RATE_LIMIT_PER_IP = '10000';
process.env.ARGON2_MEMORY_KIB = '1024';
process.env.ARGON2_TIME_COST = '1';
