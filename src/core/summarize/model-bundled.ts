/** 内置模型清单（发版兜底；与 config/model-catalog.json 保持同步） */
export const MODEL_CATALOG_SOURCES: Record<string, string> = {
  openai: "https://developers.openai.com/api/docs/models",
  anthropic: "https://platform.claude.com/docs/en/about-claude/models/overview",
  deepseek: "https://api-docs.deepseek.com/news/news260424",
  moonshot: "https://platform.moonshot.cn/docs",
  doubao: "https://www.volcengine.com/docs/82379",
};

export const CURATED_MODELS: Record<string, readonly string[]> = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
  anthropic: [
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
  ],
  openai: [
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
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

export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  deepseek: "deepseek-v4-flash",
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  moonshot: "kimi-k2.6",
  doubao: "doubao-seed-2-1-pro-260628",
  ollama: "llama3.3",
};

export const OLLAMA_MODEL_PRESETS = ["llama3.3", "qwen2.5", "deepseek-r1", "llava", "qwen2-vl"];
