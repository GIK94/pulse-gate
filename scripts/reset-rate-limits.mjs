#!/usr/bin/env node
// Clears gateway rate-limit counters (all projects, or one project id) so load-test
// scenarios start from a clean window. Usage:
//   REDIS_URL=redis://localhost:56379 node scripts/reset-rate-limits.mjs [projectId]
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:56379', { lazyConnect: true });
await redis.connect();
const pattern = process.argv[2] ? `pg:rl:{${process.argv[2]}}:*` : 'pg:rl:*';
let cursor = '0';
let deleted = 0;
do {
  const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
  cursor = next;
  if (keys.length) deleted += await redis.del(...keys);
} while (cursor !== '0');
console.log(`deleted ${deleted} rate-limit counter key(s) matching ${pattern}`);
await redis.quit();
