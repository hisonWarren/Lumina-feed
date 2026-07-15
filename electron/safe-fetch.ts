// Electron net.fetch / undici: header values must be ByteString (≤255).
// Non-Latin-1 (e.g. U+2019 ’) in UA, Cookie, Authorization, etc. → uncaught TypeError dialog.
import { app, dialog, session } from "electron";
import { isByteStringError, sanitizeHeadersInit, toByteStringHeader } from "../src/core/net/byte-string.ts";

/** Stable ASCII UA — never include product names with fancy punctuation or CJK. */
export const ASCII_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function installAsciiUserAgent(): void {
  try {
    app.userAgentFallback = ASCII_UA;
  } catch { /* older Electron */ }
  try {
    session.defaultSession.setUserAgent(ASCII_UA);
  } catch { /* ignore */ }
}

function withSanitizedInit(init?: RequestInit): RequestInit | undefined {
  if (!init) {
    return { headers: { "User-Agent": ASCII_UA } };
  }
  const headers = sanitizeHeadersInit(init.headers) as Record<string, string> | Headers | [string, string][] | undefined;
  const asRecord = (): Record<string, string> => {
    if (!headers) return {};
    if (headers instanceof Headers) {
      const o: Record<string, string> = {};
      headers.forEach((v, k) => { o[k] = v; });
      return o;
    }
    if (Array.isArray(headers)) {
      const o: Record<string, string> = {};
      for (const [k, v] of headers) o[k] = v;
      return o;
    }
    return { ...headers };
  };
  const h = asRecord();
  const hasUa = Object.keys(h).some((k) => k.toLowerCase() === "user-agent");
  if (!hasUa) h["User-Agent"] = ASCII_UA;
  else {
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === "user-agent") {
        const cleaned = toByteStringHeader(h[k]) ?? ASCII_UA;
        h[k] = cleaned;
      }
    }
  }
  return { ...init, headers: h };
}

/** Wrap session.fetch / global fetch so request headers cannot trip ByteString. */
export function wrapFetch(base: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = withSanitizedInit(init);
    try {
      return await base(input, next);
    } catch (e) {
      if (!isByteStringError(e)) throw e;
      // Cookie / auto headers may still inject non-Latin1 — retry once without credentials.
      const retry: RequestInit = { ...next, credentials: "omit" };
      return base(input, retry);
    }
  }) as typeof fetch;
}

export function installSafeGlobalFetch(): void {
  const g = globalThis as typeof globalThis & { fetch: typeof fetch; __luminaSafeFetch?: boolean };
  if (g.__luminaSafeFetch) return;
  g.fetch = wrapFetch(g.fetch.bind(g));
  g.__luminaSafeFetch = true;
}

/** Suppress only ByteString crashes (Chromium may still inject bad Cookie/UA). Other errors keep a dialog. */
export function installByteStringExceptionGuard(): void {
  process.on("uncaughtException", (err) => {
    if (isByteStringError(err)) {
      console.error("[lumina] suppressed ByteString header error:", err?.message || err);
      return;
    }
    console.error("[lumina] uncaughtException:", err);
    try {
      dialog.showErrorBox("Error", String((err as Error)?.stack || err));
    } catch { /* too early / headless */ }
  });
}

export async function sessionFetchSafe(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const ses = session.defaultSession;
  const next = withSanitizedInit(init);
  const base =
    typeof ses.fetch === "function"
      ? (ses.fetch.bind(ses) as typeof fetch)
      : (globalThis.fetch as typeof fetch);
  return wrapFetch(base)(url, next);
}
