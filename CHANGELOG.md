# Changelog

本文件记录 Lumina Feed 各版本的用户可见变更。完整提交历史见 [GitHub Releases](https://github.com/hisonWarren/Lumina-feed/releases)。

## [0.4.87] — 2026-07-05

### 修复

- **阅读器 · 多 PDF 标签页**：打开第二个及后续文档时，缩略图列表无法滚动、点击缩略图会跳回第 1 页。根因是页面/缩略图 DOM 使用全局 `id`，隐藏标签页中的节点被误选中；现改为在各自标签容器内按 `data-rd-page` / `data-rd-thumb` 查询，并避免异步恢复阅读位置时覆盖用户已跳转的页码。
- **检索取文 · 粘贴后回车**：在搜索框粘贴内容后直接按 Enter 不触发检索；现于 Enter 时读取输入框当前值再执行搜索。
- **期刊 · 粘贴后回车**：期刊检索框存在相同问题，已一并修复。

## [0.4.86] — 2026-07-03

### 构建与发布

- 安装包文件名含平台与架构（如 `Lumina-Feed-0.4.86-windows-x64.exe`）。
- 多架构并行构建：Windows x64/arm64、macOS x64/arm64、Linux x64/arm64。
- 修复 CI 在无代码签名密钥时因 `CSC_LINK` 报错导致构建失败。
- 修复 Release 资产重复上传（构建阶段 `--publish never`，由单一 publish job 发布）。

### 文档

- README 增加产品截图与更清晰的分平台安装说明。

## [0.4.85] 及更早

见 [Releases 页面](https://github.com/hisonWarren/Lumina-feed/releases) 与各版本 tag 说明。
