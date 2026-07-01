// lumina-feed · 下载 Referer（来自实现资料 publisher_rules + 站点启发）
import publisherRules from "./config/publisher-rules.json" with { type: "json" };

export function getRefererForUrl(url: string): string | undefined {
  for (const rule of publisherRules as { referer?: string | null; pdf_urls?: string[] }[]) {
    const ref = rule.referer;
    if (!ref) continue;
    for (const tpl of rule.pdf_urls ?? []) {
      const base = tpl.split("{")[0];
      if (base && url.includes(base)) return ref;
    }
  }
  if (/nature\.com/i.test(url)) return "https://www.nature.com/";
  if (/pmc\.ncbi\.nlm\.nih\.gov|europepmc\.org/i.test(url)) return "https://pmc.ncbi.nlm.nih.gov/";
  if (/frontiersin\.org/i.test(url)) return "https://www.frontiersin.org/";
  if (/plos\.org/i.test(url)) return "https://journals.plos.org/";
  if (/elifesciences\.org/i.test(url)) return "https://elifesciences.org/";
  if (/biorxiv\.org/i.test(url)) return "https://www.biorxiv.org/";
  if (/medrxiv\.org/i.test(url)) return "https://www.medrxiv.org/";
  if (/sagepub\.com/i.test(url)) return "https://journals.sagepub.com/";
  if (/tandfonline\.com/i.test(url)) return "https://www.tandfonline.com/";
  if (/onlinelibrary\.wiley\.com|wiley\.com/i.test(url)) return "https://onlinelibrary.wiley.com/";
  if (/libgen\./i.test(url)) return url.split("/get.php")[0] + "/";
  return undefined;
}
