import { createDemoUpstream } from './app';

const port = Number(process.env.PORT ?? 4100);
const server = createDemoUpstream({
  slowDefaultMs: Number(process.env.DEMO_SLOW_DEFAULT_MS ?? 1500),
  slowMaxMs: Number(process.env.DEMO_SLOW_MAX_MS ?? 30000),
  maxBodyBytes: 1024 * 1024,
});

server.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', msg: `demo upstream listening on :${port}` }));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
