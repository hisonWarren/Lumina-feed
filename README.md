# Lumina Feed · 干净基线

> v0.3.0-minimal · 仅 **检索取文 + 接地总结抽屉**。权威文档在仓库根 `文档/`。

## 命令

```powershell
npm install
npx @electron/rebuild -f -w better-sqlite3,keytar
npm run verify
npm run start
```

## 目录（仅保留）

```
electron/          main · ipc · preload · settings
renderer/          入口
src/core/
  aggregate/ sources/ oa/ summarize/ store/ trust/ secrets/
  model · querySpec · normalize · dedupe
src/ui/
  LuminaApp.jsx · lib-store.js · lumina-bridge.js · themes.js
  modules/FindFetch.jsx · SummaryDrawer.jsx
tools/             build-electron · verify · quickstart
assets/ · icon.png
```

## 已移除（勿再引入）

订阅调度 · 推送 worker · 导出 · 旧 Observatory UI · 影子图书馆 · 旧 190 项 verify

详见 [BASELINE.md](./BASELINE.md)。
