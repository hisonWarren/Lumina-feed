// src/core/sources/rate-limit.ts
// Hardened rate limiting + retry for the 17-source fan-out (fixes review F4).
// - per-source min-interval gate (keyed registry)
// - 429/503-aware exponential backoff WITH jitter, honoring Retry-After
// - bounded retries; returns the last Response (caller treats non-ok as source failure)
// Semantic Scholar's unauthenticated pool REQUIRES exponential backoff (Allen AI release notes).
export interface RetryOpts { maxRetries?: number; baseMs?: number; maxMs?: number; signal?: AbortSignal; }

const limiters = new Map<string, { last: number; min: number }>();
export function registerLimiter(source: string, minIntervalMs: number): void { limiters.set(source, { last: 0, min: minIntervalMs }); }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function jitter(ms: number): number { return Math.round(ms * (0.5 + Math.random())); }

export async function gate(source: string): Promise<void> {
  const l = limiters.get(source);
  if (!l) return;
  const waitMs = l.min - (Date.now() - l.last);
  if (waitMs > 0) await sleep(waitMs);
  l.last = Date.now();
}

export async function fetchWithRetry(
  source: string, url: string, init: RequestInit, fetchImpl: typeof fetch, opts: RetryOpts = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseMs = opts.baseMs ?? 800;
  const maxMs = opts.maxMs ?? 8000;
  let attempt = 0;
  for (;;) {
    await gate(source);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: opts.signal ?? init.signal });
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      await sleep(jitter(Math.min(maxMs, baseMs * 2 ** attempt)));
      attempt++; continue;
    }
    if (res.status !== 429 && res.status !== 503) return res;
    if (attempt >= maxRetries) return res;
    const ra = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : jitter(Math.min(maxMs, baseMs * 2 ** attempt));
    await sleep(backoff);
    attempt++;
  }
}

export const DEFAULT_INTERVALS: Record<string, number> = {
  pubmed: 350, semanticscholar: 1100, core: 600, lens: 1500, dblp: 1000, hal: 800,
  osf: 600, zenodo: 800, datacite: 350, doaj: 600, openaire: 800,
  crossref: 200, openalex: 150, europepmc: 200, arxiv: 350, biorxiv: 350, medrxiv: 350,
  libgen: 1200, annas: 1200, scihub: 800, default: 250,
};
export function installDefaultLimiters(): void { for (const [s, ms] of Object.entries(DEFAULT_INTERVALS)) registerLimiter(s, ms); }
