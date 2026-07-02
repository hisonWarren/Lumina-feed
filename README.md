# Lumina Feed

> 面向科研人员的桌面级「文献检索 · 取文 · 接地阅读」一体化工具。基于 Electron + React 构建，所有 AI 输出可溯源到原文页码，数据来源清晰可查、不伪造。

![version](https://img.shields.io/badge/version-0.4.84-blue) ![platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey) ![electron](https://img.shields.io/badge/Electron-31-47848F) ![license](https://img.shields.io/badge/license-Proprietary-red)

下载安装包：[Releases](https://github.com/hisonWarren/lumina/releases/latest)（Windows x64）。

---

## 功能概览

| 模块 | 说明 |
|---|---|
| **检索取文** | 多源学术检索（OpenAlex 等），一键取全文 PDF：走开放获取（OA）解析链——bioRxiv/medRxiv API、Unpaywall、LibGen、Anna's Archive、Sci-Hub 镜像等，按优先级尝试并校验 PDF 身份。 |
| **接地总结** | 对单篇文献生成 LLM 总结，每条要点**带原文页码引用**，可点击跳转核对，杜绝幻觉。 |
| **阅读** | 内置 PDF 阅读器：缩略图实时同步、`Ctrl/⌘ + 滚轮`缩放、逐页翻译、接地问答（对全文提问，回答附页码）。 |
| **订阅简报** | 按主题订阅，定期生成文献简报；摘要缺失时自动隐藏、标题/DOI 可点开对应网页。 |
| **我的文献** | 本地文献库管理（收藏、清单、去重）。 |
| **期刊信息** | 投稿前尽职调查：SCImago 分区、类影响因子（OpenAlex）、H 指数、OA/DOAJ 正规性、**国际期刊预警名单**（内置中科院 2025 版，当前/历史分层）。 |

### 设计原则：可溯源、不造假

- **AI 只做接地总结/排版**，不臆造事实；总结要点绑定页码引用。
- **期刊数据分级对待**：分区（SCImago，CC BY-NC）、预警名单（中科院公开发布）为可溯来源；官方 JIF / JCR 受商业授权约束，**不抓取数值**，仅提供官方页跳转。
- **预警名单遵循官方规则**：只以最新年度为「当前预警」（红），历史年度作「已移出」提示（黄）。更新走「粘贴官方文本 → AI 结构化 → 预览 → 导入」，AI 仅排版权威文本、不新增期刊。

---

## 快速开始（开发）

要求：**Node.js ≥ 22.18**、Windows（原生模块 `better-sqlite3` / `keytar` 需重编）。

```powershell
npm install
npx @electron/rebuild -f -w better-sqlite3,keytar   # 重编原生模块
npm run start                                        # 构建并启动
```

配置 AI：应用内「设置 → 大模型」，支持 DeepSeek / Anthropic / OpenAI / Moonshot / 豆包 / Ollama。API Key 存于系统钥匙串（keytar），不落明文。

---

## 构建与发布

```powershell
npm run dist            # 打 Windows x64 安装包 → release/
npm run dist:release    # 打包 + 自动创建 GitHub Release 并上传安装包（需 gh 已登录）
npm run release:gh      # 仅发布当前版本安装包到 Release
```

> 跨平台说明：Windows 上只能打 Windows 目标；macOS `.dmg` 需在 Mac 上构建，Linux 需 WSL/Docker。真正的全平台发布建议用 GitHub Actions CI。

---

## 项目结构

```
electron/            主进程：main · ipc · preload · settings · journal-ipc
src/core/            纯逻辑（无 UI）
  sources/           多源检索适配器（含 UA/限流）
  oa/                开放获取取文：DOI 解析 · 各通道 · PDF 身份校验
  summarize/         LLM 客户端 · 接地总结
  subs/              订阅简报（检索 · AI · 归档）
  journal/           期刊工具：OpenAlex · SCImago · 预警名单 · 编排
  trust/             接地/引用校验
  store/ secrets/    SQLite 存储 · 钥匙串
src/ui/
  LuminaApp.jsx      外壳 + 导航
  lumina-bridge.js   渲染进程 ↔ 主进程桥接
  modules/           FindFetch · Reader · Subscriptions · Library · Journals · Settings · SummaryDrawer
tools/               构建 · 校验(verify) · 烟测(smoke) · 发版(gh-release)
assets/              图标
```

---

## 测试

```powershell
npm run verify              # 全量结构级校验
npx tsx tools/smoke-journal-lookup.mjs   # 期刊逻辑离线烟测
node tools/smoke-journal-ui.mjs          # 期刊 UI 真机（CDP）烟测
```

`tools/` 下有大量 `verify-*.mjs`（结构级）与 `smoke-*.mjs`（真机 CDP）测试脚本。

---

## 技术栈

Electron 31 · React 18 · esbuild · better-sqlite3 · keytar · pdfjs-dist · pdf-lib · lucide-react

## 合规与免责

- 取文通过公开的开放获取渠道，请在所在地法律与机构政策允许范围内使用；对非 OA 内容请遵守版权。
- 期刊指标/分区/预警仅供参考，投稿决策请以官方权威来源为准。

## 许可

© hisonWarren. 保留所有权利（Proprietary）。
