import { createLogger } from '../../src/logger';

describe('structured log redaction', () => {
  it('masks credential headers and secret fields', () => {
    const lines: string[] = [];
    const logger = createLogger('test', 'info', { write: (s: string) => lines.push(s) });
    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer upstream-token-123',
            cookie: 'sid=abc',
            'x-pulsegate-key': 'pgk_0123456789_abcdefghijklmnopqrstuvwxyzABCDEF',
            accept: 'application/json',
          },
        },
        upstream: { secret: 'sk_live_hidden', name: 'billing' },
        password: 'hunter2hunter2',
      },
      'request',
    );
    const out = lines.join('');
    expect(out).not.toContain('upstream-token-123');
    expect(out).not.toContain('sid=abc');
    expect(out).not.toContain('pgk_0123456789');
    expect(out).not.toContain('sk_live_hidden');
    expect(out).not.toContain('hunter2hunter2');
    expect(out).toContain('application/json');
    expect(out).toContain('billing');
    expect(out).toContain('[REDACTED]');
  });
});
