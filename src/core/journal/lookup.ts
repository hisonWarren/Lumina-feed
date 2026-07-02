// lumina-feed · 期刊画像编排（纯逻辑：live OpenAlex + 数据集合并）
// 数据集（SCImago / 预警）由 electron 层加载后注入，保持 core 无磁盘依赖。
import type { JournalProfile, FieldProvenance } from "./types.ts";
import type { ScimagoDataset } from "./scimago.ts";
import type { WarningDataset } from "./warning-list.ts";
import { scimagoLookup } from "./scimago.ts";
import { warningLookup } from "./warning-list.ts";
import { fetchSourceByIssn, searchSourcesByName, type OaSource } from "./openalex-source.ts";
import { looksLikeIssn } from "./issn.ts";

export interface LookupDeps {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  scimago?: ScimagoDataset | null;
  warning?: WarningDataset | null;
}

function buildProfile(query: string, src: OaSource, deps: LookupDeps): JournalProfile {
  const provenance: Record<string, FieldProvenance> = {};
  const oa: FieldProvenance = { source: "OpenAlex" };
  if (src.impact2yr != null) provenance.impact2yr = oa;
  if (src.hIndex != null) provenance.hIndex = oa;
  if (src.worksCount != null) provenance.worksCount = oa;
  if (src.isOa != null) provenance.isOa = oa;
  if (src.isInDoaj != null) provenance.isInDoaj = { source: "OpenAlex / DOAJ" };

  const issns = src.issns && src.issns.length ? src.issns : (src.issnL ? [src.issnL] : []);
  const profile: JournalProfile = {
    ok: true,
    query,
    name: src.name,
    publisher: src.publisher,
    homepage: src.homepage,
    issnL: src.issnL,
    issns,
    impact2yr: src.impact2yr,
    hIndex: src.hIndex,
    worksCount: src.worksCount,
    citedByCount: src.citedByCount,
    isOa: src.isOa,
    isInDoaj: src.isInDoaj,
    warning: null,
    provenance,
  };

  const sj = scimagoLookup(deps.scimago, issns);
  if (sj) {
    profile.scimago = {
      sjr: sj.sjr,
      bestQuartile: sj.bestQuartile,
      rank: sj.rank,
      hIndex: sj.hIndex,
      country: sj.country,
      categories: sj.categories,
      year: sj.year,
    };
    provenance.scimago = { source: "SCImago Journal Rank", year: sj.year };
  }

  const wn = warningLookup(deps.warning, issns, src.name);
  if (wn) {
    profile.warning = wn;
    provenance.warning = { source: "国际期刊预警名单", year: wn.year };
  }

  return profile;
}

/** 主查询：ISSN 精确 / 刊名检索 */
export async function lookupJournal(query: string, deps: LookupDeps = {}): Promise<JournalProfile> {
  const q = String(query || "").trim();
  if (!q) return { ok: false, query: q, warning: null, provenance: {}, error: "empty_query" };

  if (looksLikeIssn(q)) {
    const src = await fetchSourceByIssn(q, deps);
    if (src) return buildProfile(q, src, deps);
    // ISSN 未命中 OpenAlex：仍尝试数据集直查（仅分区/预警）
    return { ok: false, query: q, warning: null, provenance: {}, error: "not_found" };
  }

  const list = await searchSourcesByName(q, deps);
  if (!list.length) return { ok: false, query: q, warning: null, provenance: {}, error: "not_found" };
  const profile = buildProfile(q, list[0], deps);
  if (list.length > 1) {
    profile.candidates = list.map((s) => ({
      id: s.id || s.issnL || s.name || "",
      name: s.name || "",
      issnL: s.issnL,
      publisher: s.publisher,
    }));
  }
  return profile;
}
