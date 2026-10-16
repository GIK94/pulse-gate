import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

/**
 * A deliberately small, dependency-free "Acme Store" API used as a safe local
 * upstream for demos, tests and k6 scenarios. It is NOT part of the gateway:
 * PulseGate proxies to it exactly as it would to any registered upstream.
 */
const PRODUCTS = [
  { id: 1, name: 'Mechanical Keyboard', category: 'peripherals', priceCents: 12900, stock: 42 },
  { id: 2, name: 'USB-C Dock', category: 'peripherals', priceCents: 18900, stock: 17 },
  { id: 3, name: '27" Monitor', category: 'displays', priceCents: 32900, stock: 8 },
  { id: 4, name: 'Noise-cancelling Headphones', category: 'audio', priceCents: 24900, stock: 23 },
  { id: 5, name: 'Webcam 4K', category: 'video', priceCents: 9900, stock: 61 },
  { id: 6, name: 'Desk Mat', category: 'accessories', priceCents: 2900, stock: 120 },
];

const SENSITIVE = new Set([
  'authorization',
  'cookie',
  'x-demo-upstream-token',
  'x-api-key',
  'x-pulsegate-key',
]);

export interface DemoOptions {
  slowDefaultMs: number;
  slowMaxMs: number;
  maxBodyBytes: number;
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createDemoUpstream(opts: DemoOptions): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://demo.local');
    // HEAD is served like GET; Node omits the body automatically.
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/health') return send(res, 200, { status: 'ok' });

      if (parts[0] === 'products' && parts.length === 1 && method === 'GET') {
        const category = url.searchParams.get('category');
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 50);
        const items = PRODUCTS.filter((p) => !category || p.category === category).slice(0, limit);
        return send(
          res,
          200,
          { data: items, count: items.length },
          { 'cache-control': 'no-store' },
        );
      }

      if (parts[0] === 'products' && parts.length === 2 && method === 'GET') {
        const product = PRODUCTS.find((p) => String(p.id) === parts[1]);
        return product
          ? send(res, 200, { data: product })
          : send(res, 404, { error: 'product_not_found' });
      }

      if (url.pathname === '/orders' && method === 'POST') {
        const raw = await readBody(req, opts.maxBodyBytes);
        let body: { productId?: unknown; quantity?: unknown };
        try {
          body = JSON.parse(raw.toString('utf8') || '{}');
        } catch {
          return send(res, 400, { error: 'invalid_json' });
        }
        const product = PRODUCTS.find((p) => p.id === body.productId);
        const quantity = Number(body.quantity ?? 1);
        if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
          return send(res, 422, {
            error: 'invalid_order',
            detail: 'productId must exist and quantity must be 1-100',
          });
        }
        return send(res, 201, {
          data: {
            id: randomUUID(),
            productId: product.id,
            quantity,
            totalCents: product.priceCents * quantity,
            status: 'created',
          },
        });
      }

      if (url.pathname === '/slow' && method === 'GET') {
        const requested = Number(url.searchParams.get('delay') ?? opts.slowDefaultMs);
        const delay = Math.max(
          0,
          Math.min(Number.isFinite(requested) ? requested : opts.slowDefaultMs, opts.slowMaxMs),
        );
        await new Promise((r) => setTimeout(r, delay));
        return send(res, 200, { data: { delayedMs: delay } });
      }

      if (url.pathname === '/fail') {
        const requested = Number(url.searchParams.get('status') ?? 500);
        const status = requested >= 500 && requested <= 599 ? requested : 500;
        return send(res, status, { error: 'simulated_failure', status });
      }

      // Echo: reflects what the upstream received, to verify gateway forwarding.
      if (parts[0] === 'echo') {
        const raw =
          method === 'GET' || method === 'HEAD'
            ? Buffer.alloc(0)
            : await readBody(req, opts.maxBodyBytes);
        return send(res, 200, {
          method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          // Credential values are masked; presence is still visible for verification.
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [k, SENSITIVE.has(k) ? '[present]' : v]),
          ),
          bodyBytes: raw.length,
          body: raw.length && raw.length <= 4096 ? raw.toString('utf8') : null,
        });
      }

      if (url.pathname === '/large' && method === 'GET') {
        const bytes = Math.min(
          Number(url.searchParams.get('bytes') ?? 1024) || 1024,
          50 * 1024 * 1024,
        );
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes });
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        let left = bytes;
        while (left > 0) {
          const n = Math.min(left, chunk.length);
          if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) {
            await new Promise((r) => res.once('drain', r));
          }
          left -= n;
        }
        return res.end();
      }

      if (url.pathname === '/set-cookie' && method === 'GET') {
        return send(
          res,
          200,
          { ok: true },
          { 'set-cookie': 'tracking=1; Path=/', 'x-demo': 'kept' },
        );
      }

      return send(res, 404, { error: 'not_found', path: url.pathname });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      if (!res.headersSent)
        send(res, status, { error: status === 413 ? 'payload_too_large' : 'internal_error' });
      else res.destroy();
    }
  });
}
