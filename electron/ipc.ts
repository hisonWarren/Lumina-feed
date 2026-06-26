// lumina-feed · IPC 路由（渲染进程 ← preload → 主进程）
import { ipcMain } from "electron";
import type { Store } from "../src/core/store/index.ts";
import type { Scheduler } from "../src/core/schedule/scheduler.ts";
import type { SecretStore } from "../src/core/notify/keyvault.ts";
import { rawToSpec, type QuerySpec } from "../src/core/querySpec.ts";
import { aggregateSearch } from "../src/core/aggregate.ts";
import { exportPapers, type ExportFormat, trendByYear, countByType, summarize } from "../src/core/export/index.ts";
import { llmFromConfig } from "../src/core/summarize/llm-client.ts";
import { makeOaFullTextProvider } from "../src/core/oa/provider.ts";
import { sqliteSummaryCache } from "../src/core/summarize/summaries.repo.ts";
import { summarizeGrounded } from "../src/core/trust/index.ts";
import { saveGrounding } from "../src/core/trust/audit.ts";
import { loadAppSettings, saveAppSettings } from "./settings.ts";
import type { SummarizeOptions } from "../src/core/summarize/types.ts";

export interface IpcDeps {
  store: Store;
  scheduler: Scheduler;
  secrets: SecretStore;
  rebuildScheduler: () => Promise<void>;
  focusWindow: () => void;
}

export function registerIpc(deps: IpcDeps): void {
  const { store, scheduler, secrets } = deps;

  // ── 检索：本地库(FTS5) + 可选在线聚合入库 ──
  ipcMain.handle("search:local", (_e, spec: QuerySpec, opts) => store.papers.search(spec, opts));
  ipcMain.handle("search:online", async (_e, raw: string, filters) => {
    const spec = rawToSpec(raw, filters);
    const agg = await aggregateSearch(spec, { limit: 30 });
    store.papers.upsertMany(agg.papers);
    return { perSource: agg.perSource, count: agg.papers.length };
  });

  // ── 订阅 CRUD ──
  ipcMain.handle("subs:list", () => store.subs.list());
  ipcMain.handle("subs:get", (_e, id: string) => store.subs.get(id));
  ipcMain.handle("subs:save", (_e, sub) => store.subs.save(sub));
  ipcMain.handle("subs:remove", (_e, id: string) => store.subs.remove(id));
  ipcMain.handle("subs:runNow", (_e, id: string) => scheduler.runNow(id));

  // ── 单篇总结（带 grounding） ──
  ipcMain.handle("summarize:paper", async (_e, paperId: string, opts: SummarizeOptions) => {
    const paper = store.papers.getById(paperId);
    if (!paper) throw new Error("文献不存在");
    const settings = await loadAppSettings(store);
    if (!settings.llm) throw new Error("未配置 LLM");
    const llm = await llmFromConfig(settings.llm, () => secrets.get(`${settings.llm!.provider}_key`));
    const fullText = makeOaFullTextProvider({ email: settings.contactEmail });
    const cache = sqliteSummaryCache(store.db);
    const res = await summarizeGrounded(paper, opts, { llm, fullText, cache, ground: {} });
    if (res) saveGrounding(store.db, paper.id, res.model, res.sourceBasis, res.grounded);
    return res;
  });

  // ── 文献状态（人工 screening；AI 不裁判） ──
  ipcMain.handle("state:set", (_e, paperId: string, patch: { read?: boolean; screening?: string; starred?: boolean }) => {
    store.db.prepare(
      `INSERT INTO paper_state(paper_id,read,screening,starred) VALUES(?,?,?,?)
       ON CONFLICT(paper_id) DO UPDATE SET read=COALESCE(?,read), screening=COALESCE(?,screening), starred=COALESCE(?,starred)`
    ).run(paperId, patch.read ? 1 : 0, patch.screening ?? null, patch.starred ? 1 : 0, patch.read == null ? null : patch.read ? 1 : 0, patch.screening ?? null, patch.starred == null ? null : patch.starred ? 1 : 0);
    return true;
  });

  // ── 导出（M6） ──
  ipcMain.handle("export:papers", (_e, paperIds: string[], format: ExportFormat) => {
    const papers = paperIds.map((id) => store.papers.getById(id)).filter(Boolean) as any[];
    return exportPapers(papers, format);
  });
  ipcMain.handle("stats:trends", (_e, paperIds: string[]) => {
    const papers = paperIds.map((id) => store.papers.getById(id)).filter(Boolean) as any[];
    return { byYear: trendByYear(papers), byType: countByType(papers), summary: summarize(papers) };
  });

  // ── 设置 / 通道 / 自启 ──
  ipcMain.handle("settings:get", () => loadAppSettings(store));
  ipcMain.handle("settings:save", async (_e, s) => { await saveAppSettings(store, s); await deps.rebuildScheduler(); return true; });
  ipcMain.handle("secrets:set", (_e, key: string, value: string) => secrets.set(key, value));
  ipcMain.handle("scheduler:tick", () => scheduler.tick());
}
