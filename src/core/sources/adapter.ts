// lumina-feed · SourceAdapter 统一接口 + 共享助手
// 各适配器把 QuerySpec 翻成自家语法，处理分页/速率/字段映射，统一吐 SearchHit[]。
import type { SearchHit } from "./model.ts";
import type { QuerySpec } from "./querySpec.ts";
import { safeHeaderEmail } from "../net/byte-string.ts";

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

function politeUa(): string {
  return `lumina-feed/1.0 (mailto:${safeHeaderEmail(identity.email)})`;
}

/** 统一 JSON GET（带 UA + 超时 + 礼貌 mailto） */
export async function getJson(url: string, opts: SearchOpts = {}): Promise<any> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(url, { headers: { accept: "application/json", "user-agent": politeUa() }, signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${new URL(url).host}`);
  return res.json();
}

/** 统一文本 GET（arXiv Atom XML 用） */
export async function getText(url: string, opts: SearchOpts = {}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(url, { headers: { accept: "application/atom+xml,application/xml", "user-agent": politeUa() }, signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${new URL(url).host}`);
  return res.text();
}

/** 简易令牌桶限速（守 ToS，如 PubMed 无 key ≤3 req/s） */
export class RateLimiter {
  private last = 0;
  constructor(private minIntervalMs: number) {}
  async wait(): Promise<void> {
    const gap = this.minIntervalMs - (Date.now() - this.last);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    this.last = Date.now();
  }
}

export const yearOf = (iso?: string): number | undefined => (iso ? new Date(iso).getUTCFullYear() : undefined);
