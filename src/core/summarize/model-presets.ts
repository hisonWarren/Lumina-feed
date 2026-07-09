/**
 * 各供应商官网推荐模型（置顶；与 API /v1/models 合并，不因 API 缺项而隐藏）。
 * 内置常量见 model-bundled.ts；远程 manifest 见 config/model-catalog.json。
 */
import { getCuratedModels } from "./model-catalog.ts";

export {
  MODEL_CATALOG_SOURCES,
  CURATED_MODELS,
  PROVIDER_DEFAULT_MODEL,
  OLLAMA_MODEL_PRESETS,
} from "./model-bundled.ts";

import { CURATED_MODELS } from "./model-bundled.ts";

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
 * 合并 API 模型列表：官网推荐项始终置顶（即使 /v1/models 未返回），API 额外项按字母序追加。
 */
export function mergeModelList(provider: string, apiModels: string[]): string[] {
  const curated = getCuratedModels(provider);
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
    for (const m of curated) push(m);
  }
  for (const m of api.slice().sort((a, b) => a.localeCompare(b))) push(m);
  if (out.length) return out;
  return curated ? [...curated] : api;
}

/** @deprecated 使用 mergeModelList */
export function filterCuratedModels(provider: string, apiModels: string[]): string[] {
  return mergeModelList(provider, apiModels);
}
