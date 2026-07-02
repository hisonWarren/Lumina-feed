# Lumina Feed

> 面向科研人员的桌面级「文献检索 · 取文 · 接地阅读」一体化工具。基于 Electron + React 构建，AI 输出均可溯源到原文页码，数据来源清晰、不伪造。

![Version](https://img.shields.io/badge/version-0.4.86-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)
![License](https://img.shields.io/badge/license-Proprietary-red.svg)

## 下载

在 [Releases](https://github.com/hisonWarren/Lumina-feed/releases/latest) 页面按平台与 CPU 架构选择对应安装包（文件名含 `windows` / `macos` / `linux` 与 `x64` / `arm64`）：

| 平台 | 适用设备 | 文件名示例 |
|------|----------|------------|
| **Windows** | 64 位 Intel / AMD | `Lumina-Feed-*-windows-x64.exe` |
| **Windows** | ARM 笔记本（如骁龙本） | `Lumina-Feed-*-windows-arm64.exe` |
| **macOS** | Apple 芯片（M 系列） | `Lumina-Feed-*-macos-arm64.dmg` |
| **macOS** | Intel Mac | `Lumina-Feed-*-macos-x64.dmg` |
| **Linux** | x86_64 桌面 / 笔记本 | `Lumina-Feed-*-linux-x86_64.AppImage` |
| **Linux** | ARM64（树莓派、ARM 本等） | `Lumina-Feed-*-linux-arm64.AppImage` |

> 不提供 32 位（x86/ia32）Windows 包——Win10/11 主流环境均为 64 位。安装包由 GitHub Actions 在推送版本标签时自动构建并发布。

## 功能

| 模块 | 说明 |
|---|---|
| **检索取文** | 多源学术检索（OpenAlex 等），按优先级尝试开放获取（OA）解析链，一键获取可校验的全文 PDF。 |
| **接地总结** | 对文献生成 LLM 总结，每条要点带原文页码引用，可点击核对，杜绝幻觉。 |
| **内置阅读** | PDF 阅读器：缩略图同步、缩放、逐页翻译、接地问答（回答附页码）。 |
| **订阅简报** | 按主题订阅，定期生成文献简报。 |
| **我的文献** | 本地文献库管理（收藏、清单、去重）。 |
| **期刊信息** | 投稿前尽职调查：SCImago 分区、中科院分区、JIF、类影响因子、H 指数、预警名单。 |

## 设计原则：可溯源、不造假

- **AI 只做接地总结与排版**，不臆造事实；要点绑定原文页码。
- **期刊数据分级标注来源**：官方分区、公开预警名单与第三方汇总指标区分呈现，仅供参考。
- **指标以官方为准**：应用内显示的分区、指标、预警状态均为辅助参考，投稿决策请以期刊或官方评价机构的最终发布为准。

## 开发

```bash
# 环境：Node.js ≥ 22.18（Windows，含原生模块编译）
npm install
npx @electron/rebuild -f -w better-sqlite3,keytar
npm run start
```

AI 配置在应用内「设置 → 大模型」，API Key 存于系统钥匙串（keytar），不落明文。

## 合规与免责

1. 取文功能通过公开的开放获取（OA）渠道实现，请在所在地法律与所属机构政策允许的范围内使用；对于非 OA 内容，请遵守相关版权规定。
2. 应用内的期刊指标、分区与预警状态仅供参考，最终以官方发布为准。

## 许可

© 2026 hisonWarren. All rights reserved.
