// lumina-feed · 可插拔 LLM 客户端（anthropic | openai | ollama）
// 零依赖 global fetch；baseUrl/fetchImpl 可注入便于测试。
// 安全(ADR-3)：apiKey 由调用方从钥匙串/env 取并传入，绝不写配置文件；Ollama 全本地不出网。
import type { LlmClient, LlmMessage, LlmCompleteOpts } from "./types.ts";

interface ClientDeps { fetchImpl?: typeof fetch; baseUrl?: string }

function splitSystem(messages: LlmMessage[]): { system?: string; rest: LlmMessage[] } {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  return { system: sys || undefined, rest: messages.filter((m) => m.role !== "system") };
}

/** Anthropic Messages API */
export function anthropicClient(cfg: { model: string; apiKey: string; version?: string }, deps: ClientDeps = {}): LlmClient {
  const f = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? "https://api.anthropic.com";
  return {
    id: "anthropic", model: cfg.model,
    async complete(messages, opts: LlmCompleteOpts = {}) {
      const { system, rest } = splitSystem(messages);
      const res = await f(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": cfg.version ?? "2023-06-01" },
        body: JSON.stringify({ model: cfg.model, max_tokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.2, system, messages: rest.map((m) => ({ role: m.role, content: m.content })) }),
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
      const data: any = await res.json();
      return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    },
  };
}

/** OpenAI Chat Completions（也兼容 OpenAI 兼容网关） */
export function openaiClient(cfg: { model: string; apiKey: string }, deps: ClientDeps = {}): LlmClient {
  const f = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? "https://api.openai.com";
  return {
    id: "openai", model: cfg.model,
    async complete(messages, opts: LlmCompleteOpts = {}) {
      const res = await f(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages, max_tokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.2 }),
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`openai HTTP ${res.status}`);
      const data: any = await res.json();
      return (data.choices?.[0]?.message?.content ?? "").trim();
    },
  };
}

/** Ollama 本地（默认 http://localhost:11434，全程不出网） */
export function ollamaClient(cfg: { model: string }, deps: ClientDeps = {}): LlmClient {
  const f = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? "http://localhost:11434";
  return {
    id: "ollama", model: cfg.model,
    async complete(messages, opts: LlmCompleteOpts = {}) {
      const res = await f(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.model, messages, stream: false, options: { temperature: opts.temperature ?? 0.2 } }),
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
      const data: any = await res.json();
      return (data.message?.content ?? "").trim();
    },
  };
}

export interface LlmConfig {
  provider: "anthropic" | "openai" | "ollama" | "deepseek" | "moonshot" | string;
  model: string;
  baseUrl?: string;
}

/** OpenAI 兼容提供方的默认 base（DeepSeek/Moonshot 等；自定义可用 baseUrl 覆盖） */
const OPENAI_COMPAT_BASE: Record<string, string> = {
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com",
  moonshot: "https://api.moonshot.cn",
};

/** 从配置 + 取 key 函数装配（key 来自钥匙串/env） */
export async function llmFromConfig(cfg: LlmConfig, getKey: () => Promise<string | null> | string | null, deps: ClientDeps = {}): Promise<LlmClient> {
  if (cfg.provider === "ollama") return ollamaClient({ model: cfg.model }, { ...deps, baseUrl: cfg.baseUrl });
  const key = await getKey();
  if (!key) throw new Error(`缺少 ${cfg.provider} API key（请置于钥匙串/env，勿写配置）`);
  if (cfg.provider === "anthropic")
    return anthropicClient({ model: cfg.model, apiKey: key }, { ...deps, baseUrl: cfg.baseUrl });
  // openai 及所有 OpenAI 兼容（openai / deepseek / moonshot / 自定义 baseUrl）
  const base = cfg.baseUrl ?? OPENAI_COMPAT_BASE[cfg.provider];
  return openaiClient({ model: cfg.model, apiKey: key }, { ...deps, baseUrl: base });
}
