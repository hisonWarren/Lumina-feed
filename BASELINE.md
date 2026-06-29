# 干净基线清单 · v0.4.0 + 全链

## 当前能力

| 模块 | 文件 | 说明 |
|------|------|------|
| 检索取文 | `FindFetch.jsx` · `fetch-meta.js` | 检索 · 多源取文 UI · 阅读闭环 · 总结 · 收藏 |
| 订阅简报 | `Subscriptions.jsx` | 订阅轨 · 成本闸 · 全量 batch 取文 · 按关键词/期刊 |
| 我的文献 | `Library.jsx` · `cite.js` | 工作集 · 清单 · 全文来源 badge · 跨篇分析 |
| 阅读器 | `Reader.jsx` 等 | P1–P3 · 四区 · 双车道 · 证据/推断 · 写作 · 读图 |
| 设置 | `Settings.jsx` · `model-presets.ts` | LLM 精选清单 · 测试连接 · 钥匙串 · 主题 |
| 引擎取文 | `alt-sources.ts` · `provider.ts` · `locate/` | USP 20 源（17 开放 API + LibGen + Anna + Sci-Hub 桩）· 标识符 A 车道 · 取文链 |
| 导航 | `LuminaApp.jsx` · `brand-logo.js` | 顶栏重做（logo/tagline/居中药丸导航/徽标/主题菜单）· 深度 token |

## 已应用 patch

| 包 | verify |
|---|---|
| `synra_patch_lumina_summary_drawer` | `verify-lumina-summary-drawer.mjs` |
| `synra_patch_lumina_reader_engine` | `verify-lumina-reader-engine.mjs` |
| `synra_patch_lumina_reader_p3` | `verify-lumina-reader-p3.mjs` |
| `synra_patch_lumina_settings` | `verify-lumina-settings.mjs` |
| `synra_patch_lumina_library` | `verify-lumina-library.mjs` |
| `synra_patch_lumina_library_lists` | `verify-lumina-library-lists.mjs` |
| `synra_patch_lumina_subscriptions` | `verify-lumina-subscriptions.mjs` |
| `synra_patch_lumina_subscriptions_journal` | `verify-lumina-subscriptions-journal.mjs` |
| `synra_patch_lumina_subscriptions_engine` | `verify-lumina-subscriptions-engine.mjs` |
| `synra_patch_lumina_library_engine` | `verify-lumina-library-engine.mjs`（已被 engine_finish 超集覆盖） |
| `synra_patch_lumina_engine_finish` | `verify-lumina-engine-finish.mjs` |
| `synra_patch_lumina_engine_final` | `verify-lumina-engine-final.mjs` |
| `synra_patch_lumina_reader_plus_foundation` | `verify-lumina-reader-plus-foundation.mjs` |
| `synra_patch_lumina_reader_plus_evidence` | `verify-lumina-reader-plus-evidence.mjs` |
| `synra_patch_lumina_reader_plus_writing` | `verify-lumina-reader-plus-writing.mjs` |
| `synra_patch_lumina_reader_plus_inference` | `verify-lumina-reader-plus-inference.mjs` |
| `synra_patch_lumina_reader_plus_vision` | `verify-lumina-reader-plus-vision.mjs` |
| `synra_patch_lumina_reader_plus_corpus` | `verify-lumina-reader-plus-corpus.mjs` |
| `synra_patch_lumina_reader_plus_ux` | `verify-lumina-reader-plus-ux.mjs` |
| `synra_patch_lumina_reader_plus_stats` | `verify-lumina-reader-plus-stats.mjs` |
| `synra_patch_lumina_reader_plus_polish` | `verify-lumina-reader-plus-polish.mjs` |
| `synra_patch_lumina_shell_redesign` | `verify-lumina-shell-redesign.mjs` |
| `synra_patch_lumina_realmachine_fixes` | `verify-lumina-realmachine-fixes.mjs` |
| `synra_patch_lumina_shell_polish` | `verify-lumina-shell-polish.mjs` |
| `synra_patch_lumina_provider_translate` | `verify-lumina-provider-translate.mjs` |
| `synra_patch_lumina_reader_nav_find` | `verify-lumina-reader-nav-find.mjs` |
| `synra_patch_lumina_polish_persist` | `verify-lumina-polish-persist.mjs` |
| `synra_patch_lumina_finish` | `verify-lumina-finish.mjs` |
| `synra_patch_lumina_multidoc_open` | `verify-lumina-multidoc-open.mjs` |
| `synra_patch_lumina_packaging` | `verify-lumina-packaging.mjs` |
| `synra_patch_lumina_search_settings` | `verify-lumina-search-settings.mjs` |
| `synra_patch_lumina_background` | `verify-lumina-background.mjs` |
| `synra_patch_lumina_reader_plus_graph` | `verify-lumina-reader-plus-graph.mjs` |
| `synra_patch_lumina_provider_doubao` | `verify-lumina-provider-doubao.mjs` |
| `synra_patch_lumina_finish_all` | `verify-lumina-finish-all.mjs` |
| `synra_patch_lumina_open_sources` | `verify-lumina-open-sources.mjs`（P0+P2 共 **17** 检索源） |
| `synra_patch_lumina_results_paging` | `verify-lumina-results-paging.mjs` · `test-paginate.mjs`（15/15） |
| `synra_patch_lumina_reader_hilite_fix` | `verify-lumina-reader-hilite-fix.mjs`（12/12）· `apply-hilite-fix.mjs` |
| **直推·订阅简报 2.0** | `verify-lumina-subs-digest-sync.mjs`（26/26） |

## 验收

```powershell
npm run verify          # 扫描 tools/verify-lumina-*.mjs，**43/43** 零红不变量
npm run verify:fetch-meta
npm run verify:model-presets
npx @electron/rebuild
npm start
npm run dist            # NSIS：Lumina Feed Setup 0.4.0.exe（Windows 可设 CSC_IDENTITY_AUTO_DISCOVERY=false）
npm run dist:dir        # win-unpacked
```

**本机数据**：`%APPDATA%\Lumina Feed\`（`lumina.db` · `pdfs/`）；设置「关于」可查看路径并清空。与旧 dev 目录 `%APPDATA%\lumina-feed` 分离。

**本地 PDF 打开（dev）**：`npx electron . "C:\path\file.pdf"`（须已 `build:electron`）

### 打包（真机·逐 OS；verify 19/19 仅配置形态 ≠ 打包成功）

```powershell
npm i -D electron-builder   # 首次
npm run build:electron
npm run dist                # → release/
```

### 真机烟测（需 Electron CDP）

```powershell
npx electron . --remote-debugging-port=9222
$env:LUMINA_TEST_KEY="<密钥>"   # 仅 env/钥匙串，勿写进仓库
node tools/smoke-untested-patches.mjs   # 新补丁：search_settings/background/graph/doubao
node tools/smoke-real-machine.mjs
node tools/smoke-full-ai.mjs            # provider 须与 Key 匹配（DeepSeek 或豆包 ep-）
node tools/smoke-post-patch.mjs
npx tsx tools/live-smoke-sources.mjs      # 17 源活体 API（报告 sources-live.json）
node tools/smoke-open-sources-man.mjs       # MAN-OS 开放源真机（FindFetch + 设置）
```

报告输出：`/.smoke-artifacts/`（`untested-patches-report.json` · `post-patch-report.json` · `report.json` · `full-ai-report.json` · `sources-live.json` · `man-os-report.json` · 截图）。

**打包烟测**：`npx electron-builder --dir` → `release/win-unpacked/`（2026-06-28 本机已通过 exe 构建）。

**已知问题与待办**：见仓库根 [`文档/07_真机测试发现_ISSUES.md`](../文档/07_真机测试发现_ISSUES.md)（含 P0–P3 分级、文件行号、复现步骤、人工验收表）。

真机：LLM 测试连接真连通见 reader_plus_polish `EXIT_CRITERIA.md`（须 `npm run build:electron`）
