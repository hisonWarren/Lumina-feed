// lumina-feed · 不可自动抓取的社交/登录墙落地页（跳过候选，避免 22s 超时）
/** ResearchGate / Academia 等：无稳定公开 PDF API，需浏览器登录 */
const NON_AUTOMATABLE = [
  /(^|\.)researchgate\.net$/i,
  /(^|\.)academia\.edu$/i,
  /(^|\.)mendeley\.com$/i,
  /(^|\.)sciencedirect\.com$/i, // 摘要页非 PDF；直链由出版商规则处理
];

export function isNonAutomatableLandingUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    if (NON_AUTOMATABLE.some((re) => re.test(host))) return true;
    // RG 偶发 .pdf 链仍要登录 cookie
    if (/researchgate\.net/i.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

export function socialLandingLabel(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const h = new URL(url).host.toLowerCase();
    if (/researchgate/.test(h)) return "ResearchGate";
    if (/academia\.edu/.test(h)) return "Academia";
    if (/mendeley/.test(h)) return "Mendeley";
  } catch { /* ignore */ }
  return undefined;
}
