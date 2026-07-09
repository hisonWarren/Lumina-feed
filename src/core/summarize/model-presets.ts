/** 各供应商推荐模型（置顶展示；listModels 成功时仍会合并 API 返回的全量可用 ID） */
export const CURATED_MODELS: Record<string, readonly string[]> = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
  anthropic: [
    "claude-sonnet-4-6",
    "claude-opus-4-8",
    "claude-haiku-4-5",
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
  ],
  openai: [
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
    "o3-mini",
    "o4-mini",
  ],
  moonshot: ["kimi-k2.6", "kimi-k2.5", "kimi-k2.7-code", "kimi-k2-turbo-preview"],
  doubao: [
    "doubao-seed-2-1-pro-260628",
    "doubao-seed-1-6-251015",
    "doubao-1-5-vision-pro-32k-250115",
    "doubao-1-5-pro-32k-250115",
  ],
};

/** 新用户 / 切换供应商时的默认 Model ID */
export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  deepseek: "deepseek-v4-flash",
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  moonshot: "kimi-k2.6",
  doubao: "doubao-seed-2-1-pro-260628",
  ollama: "llama3.3",
};

/** Ollama 本地：以 /api/tags 为准；此为无引擎/拉取失败时的兜底 */
export const OLLAMA_MODEL_PRESETS = ["llama3.3", "qwen2.5", "deepseek-r1", "llava", "qwen2-vl"];

export const DOUBAO_CURATED_MODELS = CURATED_MODELS.doubao;

/** 排除 embedding / 语音 / 图像等非对话模型，避免 /v1/models 列表过长难选。 */
export function isLikelyChatModel(provider: string, id: string): boolean {
  const s = String(id || "").toLowerCase();
  if (!s) return false;
  if (provider === "openai" || provider === "custom") {
    if (/embed|whisper|tts|dall-e|davinci|babbage|moderation|realtime|transcribe|audio|sora|gpt-image|omni-moderation/.test(s)) return false;
    if (s.startsWith("ft:") || s.startsWith("ft-")) return false;
  }
  if (provider === "anthropic") return s.includes("claude");
  if (provider === "moonshot") return s.includes("kimi") || s.includes("moonshot");
  if (provider === "doubao") return s.includes("doubao") || s.startsWith("ep-");
  if (provider === "deepseek") return s.includes("deepseek");
  return true;
}

/**
 * 合并 API 模型列表：推荐项置顶，其余按字母序追加（去重）。
 * 无 API 结果时回落到推荐清单。
 */
export function mergeModelList(provider: string, apiModels: string[]): string[] {
  const curated = CURATED_MODELS[provider];
  const api = (apiModels || []).map(String).filter((m) => m && isLikelyChatModel(provider, m));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (m: string) => {
    const t = String(m || "").trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (curated) {
    const apiSet = new Set(api);
    for (const m of curated) {
      if (!api.length || apiSet.has(m)) push(m);
    }
  }
  for (const m of api.slice().sort((a, b) => a.localeCompare(b))) push(m);
  if (out.length) return out;
  return curated ? [...curated] : api;
}

/** @deprecated 使用 mergeModelList；保留别名避免外部引用断裂 */
export function filterCuratedModels(provider: string, apiModels: string[]): string[] {
  return mergeModelList(provider, apiModels);
}
