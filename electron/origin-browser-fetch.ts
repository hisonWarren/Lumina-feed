// Hidden BrowserWindow + in-page fetch — passes Cloudflare Turnstile where session.fetch cannot.
// session.net.fetch keeps cf_clearance but still gets 403; Chromium page fetch succeeds after warm.
import { BrowserWindow, app } from "electron";

export type OriginBrowserFetch = {
  fetch: typeof fetch;
  warm: (onStatus?: (label: string) => void) => Promise<void>;
  close: () => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isCloudflareChallengeHtml(html: string): boolean {
  const s = String(html || "");
  // Real journal pages may embed cdn-cgi scripts — require interstitial signals.
  if (/<title[^>]*>\s*Just a moment/i.test(s)) return true;
  if (/cf-browser-verification|id=["']challenge-form["']/i.test(s)) return true;
  if (/Cf-Mitigated|cf-mitigated/i.test(s) && /challenge/i.test(s) && !/Journal Impact Factor/i.test(s)) return true;
  if (/challenges\.cloudflare\.com/i.test(s) && !/Journal Impact Factor|Journal Title/i.test(s)) return true;
  return false;
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return String((input as Request).url || input);
}

/**
 * One hidden window per origin. First navigation clears CF; later requests use in-page fetch
 * (serialized) so cookies + browser TLS stack stay aligned.
 */
export function createOriginBrowserFetch(
  homeUrl: string,
  opts?: {
    /** JS expression → boolean: page looks like real content */
    readyExpr?: string;
    warmTimeoutMs?: number;
  },
): OriginBrowserFetch {
  const origin = new URL(homeUrl).origin;
  const readyExpr =
    opts?.readyExpr ||
    `!/just a moment/i.test(document.title) && /Journal Impact Factor|SCImago|letpub/i.test(document.body ? document.body.innerText : "")`;
  const warmTimeoutMs = opts?.warmTimeoutMs ?? 60_000;

  let win: BrowserWindow | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let warmed = false;
  let closed = false;

  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const destroy = () => {
    closed = true;
    warmed = false;
    if (win && !win.isDestroyed()) {
      try { win.destroy(); } catch { /* ignore */ }
    }
    win = null;
  };

  const ensureWindow = async (): Promise<BrowserWindow> => {
    if (closed) throw new Error("origin_browser_fetch_closed");
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        // Turnstile needs a normal Chromium renderer; sandbox-only can flake ("No available adapters").
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.on("closed", () => {
      win = null;
      warmed = false;
    });
    return win;
  };

  const waitReady = async (w: BrowserWindow, onStatus?: (label: string) => void): Promise<void> => {
    const t0 = Date.now();
    onStatus?.("正在通过人机验证…");
    while (Date.now() - t0 < warmTimeoutMs) {
      if (closed) throw new Error("aborted");
      try {
        const ok = await w.webContents.executeJavaScript(`(!!(${readyExpr}))`);
        if (ok) return;
      } catch { /* navigating */ }
      await sleep(400);
    }
    throw new Error(`Cloudflare challenge timeout @ ${origin}`);
  };

  const warm = async (onStatus?: (label: string) => void): Promise<void> => {
    await enqueue(async () => {
      if (warmed && win && !win.isDestroyed()) return;
      const w = await ensureWindow();
      onStatus?.("正在连接站点…");
      try {
        await w.loadURL(homeUrl);
      } catch {
        /* CF/plugin may reject loadURL; still poll readiness */
      }
      await waitReady(w, onStatus);
      warmed = true;
      onStatus?.("人机验证已通过，开始拉取…");
    });
  };

  const pageFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (!url.startsWith(origin)) {
      throw new Error(`origin_browser_fetch_cross_origin: ${url}`);
    }
    await warm();
    return enqueue(async () => {
      const w = await ensureWindow();
      if (!warmed) {
        try { await w.loadURL(homeUrl); } catch { /* ignore */ }
        await waitReady(w);
        warmed = true;
      }
      if (init?.signal?.aborted) throw new Error("aborted");

      const method = String(init?.method || "GET").toUpperCase();
      const headers: Record<string, string> = { accept: "text/html,*/*" };
      if (init?.headers) {
        const h = init.headers;
        if (h instanceof Headers) h.forEach((v, k) => { headers[k] = v; });
        else if (Array.isArray(h)) for (const [k, v] of h) headers[k] = v;
        else Object.assign(headers, h);
      }

      const payload = await w.webContents.executeJavaScript(
        `(async () => {
          const r = await fetch(${JSON.stringify(url)}, {
            method: ${JSON.stringify(method)},
            credentials: "include",
            headers: ${JSON.stringify(headers)},
          });
          const body = await r.text();
          const hdrs = {};
          r.headers.forEach((v, k) => { hdrs[k] = v; });
          return { status: r.status, statusText: r.statusText, headers: hdrs, body };
        })()`,
      ) as { status: number; statusText: string; headers: Record<string, string>; body: string };

      if (init?.signal?.aborted) throw new Error("aborted");

      if (isCloudflareChallengeHtml(payload.body) || payload.status === 403) {
        warmed = false;
        try { await w.loadURL(homeUrl); } catch { /* ignore */ }
        await waitReady(w);
        warmed = true;
        const retry = await w.webContents.executeJavaScript(
          `(async () => {
            const r = await fetch(${JSON.stringify(url)}, {
              method: ${JSON.stringify(method)},
              credentials: "include",
              headers: ${JSON.stringify(headers)},
            });
            const body = await r.text();
            const hdrs = {};
            r.headers.forEach((v, k) => { hdrs[k] = v; });
            return { status: r.status, statusText: r.statusText, headers: hdrs, body };
          })()`,
        ) as typeof payload;
        if (isCloudflareChallengeHtml(retry.body) || retry.status === 403) {
          throw new Error(`HTTP ${retry.status || 403} @ ${origin} (Cloudflare)`);
        }
        return new Response(retry.body, {
          status: retry.status,
          statusText: retry.statusText,
          headers: retry.headers,
        });
      }

      return new Response(payload.body, {
        status: payload.status,
        statusText: payload.statusText,
        headers: payload.headers,
      });
    });
  };

  try {
    app.once("before-quit", destroy);
  } catch { /* tests */ }

  return {
    fetch: pageFetch as typeof fetch,
    warm,
    close: destroy,
  };
}
