/** 各供应商设置下拉精选（listModels 全量 API 回落到此；未列出的 ID 仍可自填） */
export const CURATED_MODELS: Record<string, readonly string[]> = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  moonshot: ["kimi-k2.6", "kimi-k2.5", "kimi-k2.7-code"],
  doubao: [
    "doubao-seed-2-1-pro-260628",
    "doubao-seed-1-6-251015",
    "doubao-1-5-vision-pro-32k-250115",
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

export function filterCuratedModels(provider: string, apiModels: string[]): string[] {
  const curated = CURATED_MODELS[provider];
  if (!curated) return apiModels;
  const apiSet = new Set(apiModels);
  const hit = curated.filter((m) => apiSet.has(m));
  return hit.length ? [...hit] : [...curated];
}
