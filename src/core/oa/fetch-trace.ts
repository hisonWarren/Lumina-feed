// fetch-trace · 取文过程可观测步骤（P2 Fetch Trace）
export type FetchTraceStatus = "pending" | "running" | "ok" | "fail" | "skip";

export interface FetchTraceStep {
  id: string;
  label: string;
  status: FetchTraceStatus;
  detail?: string;
  ms?: number;
}

export type FetchTraceCallback = (ev: {
  type: "init" | "step" | "done";
  steps: FetchTraceStep[];
  result?: { ok: true; source: string } | { ok: false; reason: string };
}) => void;

export const FETCH_TRACE_TEMPLATE: Omit<FetchTraceStep, "status">[] = [
  { id: "identifiers", label: "元数据 / 标识符" },
  { id: "biorxiv_api", label: "bioRxiv API" },
  { id: "unpaywall", label: "Unpaywall" },
  { id: "openalex", label: "OpenAlex" },
  { id: "europepmc", label: "Europe PMC" },
  { id: "crossref", label: "Crossref / 出版商" },
  { id: "extended", label: "DOAJ / Zenodo / CORE 等" },
  { id: "libgen", label: "LibGen" },
  { id: "annas", label: "Anna's Archive" },
  { id: "scihub", label: "Sci-Hub" },
  { id: "download", label: "下载 PDF" },
];

export function createTraceState(): FetchTraceStep[] {
  return FETCH_TRACE_TEMPLATE.map((s) => ({ ...s, status: "pending" as FetchTraceStatus }));
}

export function makeTraceEmitter(cb?: FetchTraceCallback) {
  const steps = createTraceState();
  const snapshot = () => steps.map((s) => ({ ...s }));
  const emit = (
    type: "init" | "step" | "done",
    result?: { ok: true; source: string } | { ok: false; reason: string },
  ) => {
    if (!cb) return;
    cb({ type, steps: snapshot(), result });
  };
  const patch = (id: string, status: FetchTraceStatus, detail?: string, ms?: number) => {
    const i = steps.findIndex((s) => s.id === id);
    if (i >= 0) steps[i] = { ...steps[i], status, detail, ms: ms ?? steps[i].ms };
    emit("step");
  };
  const skipRest = (afterOkId: string) => {
    let found = false;
    for (const s of steps) {
      if (s.id === afterOkId) { found = true; continue; }
      if (found && s.status === "pending") s.status = "skip";
    }
  };
  emit("init");
  return { patch, skipRest, done: emit };
}

/** 候选 source 字段 → trace 步骤 id */
export function traceStepForSource(source: string): string {
  const s = source.toLowerCase();
  if (/scihub|sci-hub/.test(s)) return "scihub";
  if (/annas/.test(s)) return "annas";
  if (/libgen/.test(s)) return "libgen";
  if (/biorxiv|medrxiv/.test(s)) return "biorxiv_api";
  if (/unpaywall/.test(s)) return "unpaywall";
  if (/openalex/.test(s)) return "openalex";
  if (/europepmc|pmc/.test(s)) return "europepmc";
  if (/crossref|publisher|elife|frontiers|plos|arxiv/.test(s)) return "crossref";
  if (/paper_oa|identifier/.test(s)) return "identifiers";
  return "extended";
}
