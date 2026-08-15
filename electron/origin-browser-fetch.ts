// Hidden BrowserWindow + in-page fetch — passes Cloudflare Turnstile where session.fetch cannot.
// session.net.fetch keeps cf_clearance but still gets 403; Chromium page fetch succeeds after warm.
// Interactive Turnstile: briefly show the window so the user can complete the checkbox, then hide.
import { BrowserWindow, app } from "electron";

export type OriginBrowserFetch = {
  fetch: typeof fetch;
  warm: (onStatus?: (label: string) => void) => Promise<void>;
  close: () => void;
  /** Hard-reset queue + window so a stuck warm cannot block later calls forever */
  reset: () => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isCloudflareChallengeHtml(html: string): boolean {
  const s = String(html || "");
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

function aborted(signal?: AbortSignal): boolean {
  return !!(signal && signal.aborted);
}

/**
 * One window per origin. First navigation clears CF; later requests use in-page fetch
 * (serialized). If Turnstile needs a click, the window is shown after a short wait.
 */
export function createOriginBrowserFetch(
  homeUrl: string,
  opts?: {
    readyExpr?: string;
    warmTimeoutMs?: number;
    loadTimeoutMs?: number;
    /** After this many ms still on challenge, show the window for interactive Turnstile */
    showAfterMs?: number;
  },
): OriginBrowserFetch {
  const origin = new URL(homeUrl).origin;
  const readyExpr =
    opts?.readyExpr ||
    `!/just a moment/i.test(document.title) && /Journal Impact Factor|SCImago|letpub/i.test(document.body ? document.body.innerText : "")`;
  const warmTimeoutMs = opts?.warmTimeoutMs ?? 90_000;
  const loadTimeoutMs = opts?.loadTimeoutMs ?? 25_000;
  const showAfterMs = opts?.showAfterMs ?? 8_000;

  let win: BrowserWindow | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let warmed = false;
  let closed = false;
  let gen = 0;

  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const destroyWindow = () => {
    if (win && !win.isDestroyed()) {
      try { win.destroy(); } catch { /* ignore */ }
    }
    win = null;
    warmed = false;
  };

  const hardReset = () => {
    gen += 1;
    closed = false;
    warmed = false;
    destroyWindow();
    // Drop any hung loadURL/warm so later calls are not queued behind a zombie promise.
    chain = Promise.resolve();
  };

  const destroy = () => {
    closed = true;
    gen += 1;
    warmed = false;
    destroyWindow();
    chain = Promise.resolve();
  };

  const ensureWindow = async (): Promise<BrowserWindow> => {
    if (closed) throw new Error("origin_browser_fetch_closed");
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 780,
      autoHideMenuBar: true,
      title: "Lumina · 人机验证",
      webPreferences: {
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

  const loadWithTimeout = async (w: BrowserWindow, url: string, signal?: AbortSignal): Promise<void> => {
    if (aborted(signal) || closed) throw new Error("aborted");
    const nav = w.loadURL(url).catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`loadURL timeout @ ${origin}`)), loadTimeoutMs);
    });
    try {
      await Promise.race([nav, timed]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const waitReady = async (
    w: BrowserWindow,
    onStatus?: (label: string) => void,
    signal?: AbortSignal,
    myGen?: number,
  ): Promise<void> => {
    const t0 = Date.now();
    let shown = false;
    onStatus?.("正在通过人机验证…");
    while (Date.now() - t0 < warmTimeoutMs) {
      if (closed || (myGen != null && myGen !== gen) || aborted(signal)) throw new Error("aborted");
      try {
        const ok = await w.webContents.executeJavaScript(`(!!(${readyExpr}))`);
        if (ok) {
          if (shown && win && !win.isDestroyed()) {
            try { win.hide(); } catch { /* ignore */ }
          }
          return;
        }
      } catch { /* navigating */ }

      // Interactive Turnstile needs a visible window; silent managed challenge often finishes earlier.
      if (!shown && Date.now() - t0 >= showAfterMs) {
        shown = true;
        onStatus?.("请在弹出窗口完成人机验证（勾选后自动继续）…");
        try {
          if (!w.isDestroyed()) {
            w.show();
            w.focus();
          }
        } catch { /* ignore */ }
      }
      await sleep(400);
    }
    if (shown && win && !win.isDestroyed()) {
      try { win.hide(); } catch { /* ignore */ }
    }
    throw new Error(`Cloudflare challenge timeout @ ${origin}`);
  };

  const warm = async (onStatus?: (label: string) => void, signal?: AbortSignal): Promise<void> => {
    const myGen = gen;
    await enqueue(async () => {
      if (myGen !== gen || closed) throw new Error("aborted");
      if (warmed && win && !win.isDestroyed()) return;
      const w = await ensureWindow();
      onStatus?.("正在连接站点…");
      try {
        await loadWithTimeout(w, homeUrl, signal);
      } catch (e) {
        if (String((e as Error)?.message || e).includes("timeout")) {
          // Still poll — CF pages sometimes never fire loadURL 'done'.
          onStatus?.("连接较慢，继续等待人机验证…");
        } else if (aborted(signal) || closed) {
          throw new Error("aborted");
        }
      }
      await waitReady(w, onStatus, signal, myGen);
      if (myGen !== gen) throw new Error("aborted");
      warmed = true;
      onStatus?.("人机验证已通过，开始拉取…");
    });
  };

  const pageFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (!url.startsWith(origin)) {
      throw new Error(`origin_browser_fetch_cross_origin: ${url}`);
    }
    const signal = init?.signal ?? undefined;
    await warm(undefined, signal);
    return enqueue(async () => {
      if (aborted(signal) || closed) throw new Error("aborted");
      const myGen = gen;
      const w = await ensureWindow();
      if (!warmed) {
        try { await loadWithTimeout(w, homeUrl, signal); } catch { /* ignore */ }
        await waitReady(w, undefined, signal, myGen);
        warmed = true;
      }
      if (aborted(signal) || closed || myGen !== gen) throw new Error("aborted");

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

      if (aborted(signal) || closed || myGen !== gen) throw new Error("aborted");

      if (isCloudflareChallengeHtml(payload.body) || payload.status === 403) {
        warmed = false;
        try { await loadWithTimeout(w, homeUrl, signal); } catch { /* ignore */ }
        await waitReady(w, undefined, signal, myGen);
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
    warm: (onStatus) => warm(onStatus),
    close: destroy,
    reset: hardReset,
  };
}
