// lumina-feed · M1 数据模型
// SearchHit = 各源适配器统一吐出的命中；Paper = 归一化入库的统一模型。

export type StudyType =
  | "rct" | "systematic-review" | "meta-analysis" | "guideline"
  | "cohort" | "case-control" | "cross-sectional" | "case-report"
  | "review" | "preprint" | "editorial" | "other";

/** 适配器统一命中（见总卷 3.2） */
export interface SearchHit {
  source: string;            // pubmed | europepmc | crossref | openalex | arxiv | biorxiv
  doi?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  title: string;
  abstract?: string;
  authors: string[];
  journal?: string;
  year?: number;
  pubDate?: string;          // ISO date（首次发表/上线）
  type?: StudyType[];
  isPreprint?: boolean;
  peerReviewed?: boolean;
  retracted?: boolean;
  language?: string;
  oaStatus?: string;         // gold | green | hybrid | bronze | closed | unknown
  oaUrl?: string;
  citationCount?: number;
  /** 版本归并线索：preprint 的「已发表 DOI」/ published 的「preprint DOI」 */
  relatedDoi?: string;
}

/** 一条文献版本（版本归并后 versions[] 里的元素） */
export interface PaperVersion {
  source: string;
  doi?: string;
  isPreprint?: boolean;
  pubDate?: string;
  year?: number;
  oaUrl?: string;
}

/** 归一化入库模型（对应 SQLite papers 表） */
export interface Paper {
  id: string;                // 去重主键（规范化 DOI 或 标题指纹+首作者+年）
  doi?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  title: string;
  abstract?: string;
  authors: string[];
  journal?: string;
  journalAbbrev?: string;
  issn?: string;
  pubDate?: string;
  year?: number;
  volume?: string;
  issue?: string;
  pages?: string;
  studyTypes: StudyType[];
  mesh?: string[];
  keywords?: string[];
  language?: string;
  source: string;            // 代表来源（版本归并后取「最新/正式」那条）
  isPreprint: boolean;
  peerReviewed: boolean;
  retracted: boolean;
  citationCount?: number;
  oaStatus?: string;
  oaUrl?: string;
  /** 版本归并线索：来自 Crossref/bioRxiv 的关联 DOI（preprint↔published） */
  relatedDoi?: string;
  versions: PaperVersion[];  // 含 preprint↔published 归并历史
  ingestedAt: string;
}
