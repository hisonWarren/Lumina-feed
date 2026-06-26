#!/usr/bin/env node
// Windows 打包 wrapper：设置国内镜像后调用 electron-builder
import { spawnSync } from "node:child_process";

if (process.platform === "win32") {
  process.env.ELECTRON_MIRROR ??= "https://npmmirror.com/mirrors/electron/";
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= "https://npmmirror.com/mirrors/electron-builder-binaries/";
}

const r = spawnSync("npx", ["electron-builder", "--win", "--x64"], {
  stdio: "inherit",
  shell: true,
});
process.exit(r.status ?? 1);
