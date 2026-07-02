# Lumina Feed

> 面向科研人员的桌面级「文献检索 · 取文 · 接地阅读」一体化工具。基于 Electron + React 构建，所有 AI 输出可溯源到原文页码，数据来源清晰可查、不伪造。

![Version](https://img.shields.io/badge/version-0.4.84-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey.svg)
![Electron](https://img.shields.io/badge/Electron-31-47848F.svg)
![License](https://img.shields.io/badge/license-Proprietary-red.svg)

[**下载最新 Windows x64 安装包**](https://github.com/hisonWarren/Lumina-feed/releases/latest)

---

## ✨ 功能概览

| 模块 | 说明 |
|---|---|
| **检索取文** | 多源学术检索（OpenAlex 等），一键取全文 PDF：走开放获取（OA）解析链——bioRxiv/medRxiv API、Unpaywall、LibGen、Anna's Archive、Sci-Hub 镜像等，按优先级尝试并校验 PDF 身份。 |
| **接地总结** | 对单篇文献生成 LLM 总结，每条要点**带原文页码引用**，可点击跳转核对，杜绝幻觉。 |
| **内置阅读** | 内置 PDF 阅读器：缩略图实时同步、`Ctrl/⌘ + 滚轮`缩放、逐页翻译、接地问答（对全文提问，回答附页码）。 |
| **订阅简报** | 按主题订阅，定期生成文献简报；摘要缺失时自动隐藏、标题/DOI 可点开对应网页。 |
| **我的文献** | 本地文献库管理（收藏、清单、去重）。 |
| **期刊信息** | 投稿前尽职调查：SCImago 分区、**中科院分区**（LetPub 导入/在线）、**JIF**（[wos-journal.info](https://wos-journal.info/) 导入/在线）、类影响因子、H 指数、预警名单（内置 2025）。 |

### 🛡️ 设计原则：可溯源、不造假

- **AI 只做接地总结/排版**，不臆造事实；总结要点绑定页码引用。
- **期刊数据分级对待**：分区（SCImago，CC BY-NC）、预警名单（中科院公开发布）、中科院分区与 JIF 为第三方汇总（供参考），明确标明数据来源。
- **预警名单遵循官方规则**：只以最新年度为「当前预警」，历史年度作「已移出」提示。更新走「粘贴官方文本 → AI 结构化 → 预览 → 导入」，AI 仅排版权威文本、不新增期刊。

---

## 🚀 快速开始（开发）

### 环境要求

- Node.js ≥ 22.18
- Windows 环境（原生模块 `better-sqlite3` / `keytar` 需要重新编译）

### 安装与启动

```bash
npm install
npx @electron/rebuild -f -w better-sqlite3,keytar   # 重编原生模块
npm run start                                        # 构建并启动
```

### 配置 AI

应用内前往「设置 → 大模型」，支持 DeepSeek / Anthropic / OpenAI / Moonshot / 豆包 / Ollama 等。API Key 存放于操作系统的安全钥匙串（keytar）中，不落明文。

---

## 📦 构建与发布

```bash
npm run dist            # 构建 Windows x64 安装包到 release/ 目录
npm run dist:release    # 打包 + 自动创建 GitHub Release 并上传（需已登录 GitHub CLI）
npm run release:gh      # 仅发布当前版本安装包到 Release
```

> **跨平台说明**：Windows 环境默认只能构建 Windows 目标包。macOS `.dmg` 需在 Mac 环境上构建，Linux 包需在 Linux/WSL/Docker 环境下构建。全平台自动化发布建议使用 GitHub Actions CI。

---

## 📁 项目结构

```text
electron/            # 主进程逻辑 (main, ipc, preload, settings, journal-ipc)
src/core/            # 核心业务逻辑 (无 UI)
  ├── sources/       # 多源检索适配器 (含 UA 与限流处理)
  ├── oa/            # 开放获取取文引擎 (DOI解析, 各大通道, PDF身份校验)
  ├── summarize/     # LLM 客户端与接地总结
  ├── subs/          # 订阅简报 (检索, AI, 归档)
  ├── journal/       # 期刊工具箱 (OpenAlex, SCImago, 预警名单, JIF, CAS分区)
  ├── trust/         # 接地与引用校验
  └── store/secrets/ # SQLite 存储层与系统钥匙串
src/ui/              # React 渲染进程
  ├── LuminaApp.jsx  # 外壳与导航
  ├── lumina-bridge  # 渲染进程 ↔ 主进程安全桥接
  └── modules/       # 业务模块组件 (检索, 阅读, 订阅, 文献库, 期刊, 设置)
tools/               # 构建、校验 (verify)、烟测 (smoke) 与发版脚本
assets/              # 静态图标与资源
```

---

## 🧪 测试

本项目包含结构级测试（`verify`）与基于 Chrome DevTools Protocol 的真实页面烟测（`smoke`）。

```bash
npm run verify                           # 全量结构级校验
npx tsx tools/smoke-journal-lookup.mjs   # 期刊逻辑离线烟测
node tools/smoke-journal-ui.mjs          # 期刊 UI 真机 (CDP) 烟测
```

---

## 🛠️ 技术栈

- **Electron** 31
- **React** 18
- esbuild
- better-sqlite3
- keytar
- pdfjs-dist / pdf-lib
- lucide-react

---

## ⚖️ 合规与免责声明

1. 取文功能完全通过公开的开放获取（OA）渠道和镜像实现，请在您所在地法律与所属机构政策允许的范围内使用。对于非 OA 内容，请遵守相关版权规定。
2. 应用内显示的期刊指标、分区、预警状态仅供参考辅助。您的投稿决策与标准仍需以各期刊或官方评价机构的最终发布数据为准。

## 📄 许可

© 2026 hisonWarren. All rights reserved.
