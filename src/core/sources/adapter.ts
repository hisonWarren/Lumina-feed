// lumina-feed · SourceAdapter 统一接口 + 共享助手
// 各适配器把 QuerySpec 翻成自家语法，处理分页/速率/字段映射，统一吐 SearchHit[]。
import type { SearchHit } from "./model.ts";
import type { QuerySpec } from "./querySpec.ts";

export interface SearchOpts {
  since?: string;           // 仅取该时间之后（增量）
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch; // 注入便于测试
  keys?: Record<string, string>; // 源 id → 钥匙串密钥（main 注入，绝不来自 AppSettings）
  disabledSources?: string[]; // P8 · 用户禁用的源 id
}

export interface SourceAdapter {
  id: string;
  search(q: QuerySpec, opts?: SearchOpts): Promise<SearchHit[]>;
  citedBy?(id: { doi?: string; pmid?: string }, opts?: SearchOpts): Promise<SearchHit[]>;
}

/** 礼貌署名：建议全局设置（PubMed tool+email、Crossref/OpenAlex mailto） */
export interface PoliteIdentity { tool?: string; email?: string }
let identity: PoliteIdentity = { tool: "lumina-feed", email: undefined };
export function setPoliteIdentity(id: PoliteIdentity) { identity = { ...identity, ...id }; }
export function getPoliteIdentity(): PoliteIdentity { return identity; }

function debugLog(location: string, message: string, data: Record<string, unknown>, hypothesisId: string): void {
  // #region agent log
  fetch("http://127.0.0.1:7739/ingest/f72715b3-174b-4276-af51-ebbb6cf6f9e2", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "07b43d" },
    body: JSON.stringify({
      sessionId: "07b43d",
      runId: "pre-fix",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function firstNonLatin1(s: string): { index: number; code: number } | null {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 255) return { index: i, code };
  }
  return null;
}

function safeHeaderEmail(raw?: string): string {
  const email = String(raw || "unknown").trim() || "unknown";
  const bad = firstNonLatin1(email);
  if (!bad) return email;
  debugLog("adapter.ts:safeHeaderEmail", "fallback non-latin email", {
    originalSample: email.slice(0, 80),
    badIndex: bad.index,
    badCode: bad.code,
  }, "H1");
  return "unknown";
}

/** 统一 JSON GET（带 UA + 超时 + 礼貌 mailto） */
export async function getJson(url: string, opts: SearchOpts = {}): Promise<any> {
  const f = opts.fetchImpl ?? fetch;
  const ua = `lumina-feed/1.0 (mailto:${safeHeaderEmail(identity.email)})`;
  const nonLatin = firstNonLatin1(ua);
  debugLog("adapter.ts:getJson", "about to fetch json", {
    host: (() => { try { return new URL(url).host; } catch { return "invalid_url"; } })(),
    uaLength: ua.length,
    hasNonLatin1: !!nonLatin,
    nonLatinIndex: nonLatin?.index ?? -1,
    nonLatinCode: nonLatin?.code ?? -1,
    emailSample: String(identity.email ?? "unknown").slice(0, 80),
  }, "H1");
  let res: Response;
  try {
    res = await f(url, { headers: { accept: "application/json", "user-agent": ua }, signal: opts.signal });
  } catch (e: unknown) {
    debugLog("adapter.ts:getJson", "fetch threw", {
      error: String((e as Error)?.message || e),
      host: (() => { try { return new URL(url).host; } catch { return "invalid_url"; } })(),
    }, "H2");
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${new URL(url).host}`);
  return res.json();
}

/** 统一文本 GET（arXiv Atom XML 用） */
export async function getText(url: string, opts: SearchOpts = {}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const ua = `lumina-feed/1.0 (mailto:${safeHeaderEmail(identity.email)})`;
  const nonLatin = firstNonLatin1(ua);
  debugLog("adapter.ts:getText", "about to fetch text", {
    host: (() => { try { return new URL(url).host; } catch { return "invalid_url"; } })(),
    uaLength: ua.length,
    hasNonLatin1: !!nonLatin,
    nonLatinIndex: nonLatin?.index ?? -1,
    nonLatinCode: nonLatin?.code ?? -1,
    emailSample: String(identity.email ?? "unknown").slice(0, 80),
  }, "H1");
  let res: Response;
  try {
    res = await f(url, { headers: { accept: "application/atom+xml,application/xml", "user-agent": ua }, signal: opts.signal });
  } catch (e: unknown) {
    debugLog("adapter.ts:getText", "fetch threw", {
      error: String((e as Error)?.message || e),
      host: (() => { try { return new URL(url).host; } catch { return "invalid_url"; } })(),
    }, "H2");
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${new URL(url).host}`);
  return res.text();
}

/** 简易令牌桶限速（守 ToS，如 PubMed 无 key ≤3 req/s） */
export class RateLimiter {
  private last = 0;
  private minIntervalMs: number;
  constructor(minIntervalMs: number) { this.minIntervalMs = minIntervalMs; }
  async wait(): Promise<void> {
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }
}

export const yearOf = (iso?: string): number | undefined => (iso ? new Date(iso).getUTCFullYear() : undefined);
