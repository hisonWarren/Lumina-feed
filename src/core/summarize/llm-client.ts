// lumina-feed · 可插拔 LLM 客户端（anthropic | openai | ollama）
// 零依赖 global fetch；baseUrl/fetchImpl 可注入便于测试。
// 安全(ADR-3)：apiKey 由调用方从钥匙串/env 取并传入，绝不写配置文件；Ollama 全本地不出网。
import type { LlmClient, LlmMessage, LlmCompleteOpts } from "./types.ts";
import { mergeModelList, DOUBAO_CURATED_MODELS } from "./model-presets.ts";

export { DOUBAO_CURATED_MODELS };

interface ClientDeps { fetchImpl?: typeof fetch; baseUrl?: string }

function splitSystem(messages: LlmMessage[]): { system?: string; rest: LlmMessage[] } {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  return { system: sys || undefined, rest: messages.filter((m) => m.role !== "system") };
}

// 视觉：把 dataURL 拆为 media_type + base64；定位最后一条 user 消息（图像附到它）。
function lastUserIdx(arr: any[]): number { for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] && arr[i].role === "user") return i; } return -1; }
function dataUrlParts(u: string): { mediaType: string; base64: string } | null {
  const s = String(u || ""); const c = s.indexOf(","); const h = s.slice(0, c);
  if (!h.startsWith("data:") || c < 0) return null;
  const mt = h.slice(5, h.indexOf(";")); return { mediaType: mt || "image/png", base64: s.slice(c + 1) };
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
        body: JSON.stringify({ model: cfg.model, max_tokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.2, system, messages: (() => {
          const imgs = opts.images || []; const li = imgs.length ? lastUserIdx(rest) : -1;
          return rest.map((m, i) => {
            if (i !== li) return { role: m.role, content: m.content };
            const blocks: any[] = [{ type: "text", text: m.content }];
            for (const u of imgs) { const pp = dataUrlParts(u); if (pp) blocks.push({ type: "image", source: { type: "base64", media_type: pp.mediaType, data: pp.base64 } }); }
            return { role: m.role, content: blocks };
          });
        })() }),
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
      const data: any = await res.json();
      return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    },
  };
}

/** OpenAI 兼容路径：标准网关用 /v1/…；火山方舟等 base 已含 /api/v3 时用 /chat/completions（官方文档） */
function openAiCompatPaths(base: string) {
  const b = base.replace(/\/$/, "");
  if (/\/api\/v3$/i.test(b)) return { chat: `${b}/chat/completions`, models: `${b}/models` };
  return { chat: `${b}/v1/chat/completions`, models: `${b}/v1/models` };
}

/** DeepSeek V4 默认 thinking=enabled，content 可能为空；简报/测试需关 thinking 或读 reasoning_content */
function isDeepSeekThinkingCapable(model: string): boolean {
  const m = String(model || "").toLowerCase();
  return /^deepseek-v4-/.test(m) || m === "deepseek-chat" || m === "deepseek-reasoner";
}

function extractOpenAiChoiceText(data: any): string {
  const msg = data?.choices?.[0]?.message;
  if (!msg) return "";
  const content = String(msg.content ?? "").trim();
  if (content) return content;
  return String(msg.reasoning_content ?? "").trim();
}

/** OpenAI Chat Completions（也兼容 OpenAI 兼容网关） */
export function openaiClient(cfg: { model: string; apiKey: string; label?: string }, deps: ClientDeps = {}): LlmClient {
  const f = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? "https://api.openai.com";
  const paths = openAiCompatPaths(base);
  const tag = cfg.label || "openai";
  return {
    id: tag, model: cfg.model,
    async complete(messages, opts: LlmCompleteOpts = {}) {
      const imgs = opts.images || [];
      let msgs: any[] = messages;
      if (imgs.length) { const li = lastUserIdx(messages); msgs = messages.map((m, i) => i !== li ? m : ({ role: m.role, content: [{ type: "text", text: m.content }, ...imgs.map((u) => ({ type: "image_url", image_url: { url: u } }))] })); }
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: msgs,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.2,
      };
      if (isDeepSeekThinkingCapable(cfg.model)) {
        body.thinking = { type: opts.thinking ? "enabled" : "disabled" };
      }
      const res = await f(paths.chat, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`${tag} HTTP ${res.status}`);
      const data: any = await res.json();
      return extractOpenAiChoiceText(data);
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
      const imgs = opts.images || [];
      let msgs: any[] = messages;
      if (imgs.length) { const li = lastUserIdx(messages); const b64 = imgs.map((u) => { const pp = dataUrlParts(u); return pp ? pp.base64 : u; }); msgs = messages.map((m, i) => i !== li ? m : ({ role: m.role, content: m.content, images: b64 })); }
      const res = await f(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.model, messages: msgs, stream: false, options: { temperature: opts.temperature ?? 0.2 } }),
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
      const data: any = await res.json();
      return (data.message?.content ?? "").trim();
    },
  };
}

export interface LlmConfig {
  provider: "anthropic" | "openai" | "ollama" | "deepseek" | "moonshot" | "doubao" | string;
  model: string;
  baseUrl?: string;
}

/** OpenAI 兼容提供方的默认 base（DeepSeek/Moonshot 等；自定义可用 baseUrl 覆盖） */
const OPENAI_COMPAT_BASE: Record<string, string> = {
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com",
  moonshot: "https://api.moonshot.cn",
  doubao: "https://ark.cn-beijing.volces.com/api/v3", // 火山方舟（豆包）OpenAI 兼容端；视觉走既有 openaiClient 的 image_url 路径
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
  return openaiClient({ model: cfg.model, apiKey: key, label: cfg.provider }, { ...deps, baseUrl: base });
}

/** 列出供应商可用模型：云端 GET /v1/models（OpenAI 兼容 + Anthropic），Ollama GET /api/tags。
 *  零依赖 fetch；失败返回 {ok:false,error}，UI 回落内置兜底清单 + 始终可自填（红线7：动态拉取仅增强，不阻塞）。 */
export async function listModels(cfg: LlmConfig, getKey: () => Promise<string | null> | string | null, deps: ClientDeps = {}): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const f = deps.fetchImpl ?? fetch;
  try {
    if (cfg.provider === "ollama") {
      const base = cfg.baseUrl ?? "http://localhost:11434";
      const res = await f(`${base}/api/tags`, { method: "GET" });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const j: any = await res.json();
      const models = Array.isArray(j && j.models) ? j.models.map((m: any) => String((m && m.name) || "")).filter(Boolean) : [];
      return { ok: true, models };
    }
    const key = await getKey();
    if (cfg.provider === "anthropic") {
      if (!key) return { ok: false, error: "缺少 API key" };
      const base = cfg.baseUrl ?? "https://api.anthropic.com";
      const res = await f(`${base}/v1/models`, { method: "GET", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const j: any = await res.json();
      let models = Array.isArray(j && j.data) ? j.data.map((m: any) => String((m && m.id) || "")).filter(Boolean) : [];
      models = mergeModelList(cfg.provider, models);
      return { ok: true, models };
    }
    if (!key) return { ok: false, error: "缺少 API key" };
    const base = cfg.baseUrl ?? OPENAI_COMPAT_BASE[cfg.provider] ?? "https://api.openai.com";
    const paths = openAiCompatPaths(base);
    const res = await f(paths.models, { method: "GET", headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j: any = await res.json();
    let models = Array.isArray(j && j.data) ? j.data.map((m: any) => String((m && m.id) || "")).filter(Boolean) : [];
    models = mergeModelList(cfg.provider, models);
    return { ok: true, models };
  } catch (e: any) { return { ok: false, error: (e && e.message) ? String(e.message) : "拉取失败" }; }
}
