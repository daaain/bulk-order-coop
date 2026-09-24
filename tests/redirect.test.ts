import { describe, it, expect } from 'vitest';
import { safeRedirect } from '../src/lib/redirect';

const origin = 'https://coop.example';

describe('safeRedirect', () => {
  it('keeps same-origin paths, including query and hash', () => {
    expect(safeRedirect('/orders/abc/submission', origin)).toBe('/orders/abc/submission');
    expect(safeRedirect('/orders?page=2#top', origin)).toBe('/orders?page=2#top');
  });

  it('returns null for empty values', () => {
    expect(safeRedirect(null, origin)).toBeNull();
    expect(safeRedirect(undefined, origin)).toBeNull();
    expect(safeRedirect('', origin)).toBeNull();
  });

  it('rejects relative and absolute URLs', () => {
    expect(safeRedirect('orders', origin)).toBeNull();
    expect(safeRedirect('https://evil.example/', origin)).toBeNull();
    expect(safeRedirect('javascript:alert(1)', origin)).toBeNull();
  });

  it('rejects paths that resolve to another origin', () => {
    expect(safeRedirect('//evil.example', origin)).toBeNull();
    expect(safeRedirect('/\\evil.example', origin)).toBeNull();
    expect(safeRedirect('/\t/evil.example', origin)).toBeNull();
    expect(safeRedirect('/\n/evil.example', origin)).toBeNull();
  });
});
