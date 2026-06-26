// lumina-feed · 证据可信性 · 切句 + 数字/统计量抽取
// 切句兼容中英；数字抽取覆盖最危险的幻觉类型（效应量/p/CI/样本量/百分比）。

/** 切句：在 。！？.!? 与换行处断，兼顾小数点/缩写不误断。 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  const normalized = text.replace(/\s+/g, " ").trim();
  // 在中文句末标点或英文句末标点(后接空白/结尾)处切；避免把 "0.75" / "e.g." 切开
  const parts = normalized
    .split(/(?<=[。！？；])|(?<=[.!?;])(?=\s+[A-Z0-9“"(\[])|(?<=[.!?])$/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [normalized];
}

/** 抽取「数值型断言」token：百分比、p 值、CI、HR/OR/RR、n=、纯数字（含小数/千分位）。 */
export function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  const patterns: RegExp[] = [
    /\bp\s*[<>=]\s*0?\.\d+/gi,                       // p<0.05
    /\b(?:hr|or|rr|aor)\s*[=:]?\s*\d+(?:\.\d+)?/gi,  // HR 0.75
    /\b\d+(?:\.\d+)?\s*%/g,                           // 25%
    /\b(?:n)\s*[=:]\s*\d[\d,]*/gi,                    // n=1200
    /\b95\s*%?\s*ci[^0-9]*\d+(?:\.\d+)?[^0-9]+\d+(?:\.\d+)?/gi, // 95% CI 0.6-0.9
    /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,             // 1,200 / 12,345.6
    /\b\d+\.\d+\b/g,                                  // 0.75
    /\b\d{2,}\b/g,                                    // 1200, 25（两位以上,避免抓「1 个」噪声）
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.add(m[0].toLowerCase().replace(/\s+/g, ""));
  return [...out];
}

/** 把一个数值 token 归一成「可比对的数字串」集合（剥单位/符号，留数字本体）。 */
export function numericCores(token: string): string[] {
  const nums = token.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return nums.map((n) => n.replace(/,/g, ""));
}

/** 源文本里出现过的所有数字本体（用于核验总结中的数字是否「凭空出现」）。 */
export function sourceNumberSet(source: string): Set<string> {
  const s = new Set<string>();
  for (const m of source.matchAll(/\d+(?:[.,]\d+)*/g)) s.add(m[0].replace(/,/g, ""));
  return s;
}

/** 简易 token 化（小写、去标点、分词），中文按字 + 英文按词混合。 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const en = lower.match(/[a-z][a-z0-9-]+/g) ?? [];
  const zh = (lower.match(/[\u4e00-\u9fff]/g) ?? []);
  return [...en, ...zh];
}

/** n-gram（默认 3）用于片段相似。 */
export function ngrams(tokens: string[], n = 3): string[] {
  if (tokens.length < n) return tokens.length ? [tokens.join(" ")] : [];
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}
