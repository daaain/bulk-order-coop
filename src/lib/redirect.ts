/**
 * Validates a redirect target so we never bounce users to off-site URLs.
 * Accepts only paths starting with `/` that still resolve to the current
 * origin once parsed — which catches tricks like `//evil.com`, `/\evil.com`
 * or `/\t/evil.com` (browsers strip tabs and newlines). Returns the
 * normalised path, or null for anything malformed or cross-origin.
 */
export function safeRedirect(
  value: string | null | undefined,
  origin: string = globalThis.location?.origin ?? 'http://localhost',
): string | null {
  if (!value || !value.startsWith('/')) return null;
  let resolved: URL;
  try {
    resolved = new URL(value, origin);
  } catch {
    return null;
  }
  if (resolved.origin !== new URL(origin).origin) return null;
  return resolved.pathname + resolved.search + resolved.hash;
}
