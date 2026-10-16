import { loadAppConfig } from '../../src/config/app-config';
import { withEnv } from '../helpers';

describe('production configuration guards', () => {
  const strongKey = `prod:${Buffer.alloc(32, 9).toString('base64')}`;
  const prod = {
    NODE_ENV: 'production',
    API_KEY_PEPPER: 'a'.repeat(16) + 'Zq81x0LmN2pR7sT4vW',
    ENCRYPTION_KEYS: strongKey,
    ALLOW_PRIVATE_UPSTREAMS: 'false',
    COOKIE_SECURE: 'true',
  };

  it('accepts a hardened production config and defaults to strict settings', async () => {
    const cfg = await withEnv(prod, async () => loadAppConfig());
    expect(cfg.cookieSecure).toBe(true);
    expect(cfg.ssrf.requireHttps).toBe(true);
    expect(cfg.ssrf.allowPrivate).toBe(false);
    expect(cfg.swaggerEnabled).toBe(false);
  });

  it.each([
    [{ ALLOW_PRIVATE_UPSTREAMS: 'true' }, /ALLOW_PRIVATE_UPSTREAMS/],
    [{ API_KEY_PEPPER: 'dev-only-pepper-change-me-in-production' }, /API_KEY_PEPPER/],
    [{ ENCRYPTION_KEYS: 'dev:ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=' }, /development key/],
    [{ COOKIE_SECURE: 'false' }, /COOKIE_SECURE/],
  ])('refuses unsafe production setting %o', async (override, message) => {
    await expect(withEnv({ ...prod, ...override }, async () => loadAppConfig())).rejects.toThrow(
      message,
    );
  });
});
