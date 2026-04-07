/**
 * Validates a redirect target so we never bounce users to off-site URLs.
 * Accepts only same-origin paths starting with `/` and not `//` or `/\`.
 */
export function safeRedirect(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}
