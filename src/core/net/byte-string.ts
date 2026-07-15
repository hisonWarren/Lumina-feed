/** HTTP header values must be ByteString (code points ≤ 255). Electron/undici throw otherwise. */

export function firstNonLatin1(s: string): { index: number; code: number } | null {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 255) return { index: i, code };
  }
  return null;
}

/** Drop code points > 255 (keeps Latin-1). Empty after strip → undefined so callers can omit the header. */
export function toByteStringHeader(value: string): string | undefined {
  const s = String(value ?? "");
  if (!s) return s;
  if (!firstNonLatin1(s)) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 255) out += s[i];
  }
  return out.length ? out : undefined;
}

export function isByteStringError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || "");
  return /ByteString/i.test(msg) || /greater than 255/i.test(msg);
}

/** Sanitize a HeadersInit so every value is ByteString-safe. Drops entries that become empty. */
export function sanitizeHeadersInit(headers?: HeadersInit | null): HeadersInit | undefined {
  if (headers == null) return undefined;
  if (headers instanceof Headers) {
    const next = new Headers();
    headers.forEach((value, key) => {
      const v = toByteStringHeader(value);
      if (v != null) next.set(key, v);
    });
    return next;
  }
  if (Array.isArray(headers)) {
    const next: [string, string][] = [];
    for (const pair of headers) {
      if (!pair || pair.length < 2) continue;
      const v = toByteStringHeader(String(pair[1]));
      if (v != null) next.push([String(pair[0]), v]);
    }
    return next;
  }
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (v == null) continue;
    const cleaned = toByteStringHeader(String(v));
    if (cleaned != null) next[k] = cleaned;
  }
  return next;
}

/** Polite-pool email for User-Agent mailto: — ASCII only, else "unknown". */
export function safeHeaderEmail(raw?: string): string {
  const email = String(raw || "").trim();
  if (!email) return "unknown";
  if (firstNonLatin1(email) || !/^[\x21-\x7E]+@[\x21-\x7E]+$/.test(email)) return "unknown";
  return email;
}
