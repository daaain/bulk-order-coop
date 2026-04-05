import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupMiniflare, teardownMiniflare, appFetch } from './helpers';

describe('GET /api/health', () => {
  beforeAll(setupMiniflare);
  afterAll(teardownMiniflare);

  it('returns 200 with status ok', async () => {
    const res = await appFetch('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
