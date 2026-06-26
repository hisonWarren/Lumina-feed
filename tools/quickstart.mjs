#!/usr/bin/env node
// lumina-feed · 快速启动：环境检查 + 一键验证 / 交互菜单
// 运行：npm run quickstart  或  node tools/quickstart.mjs [--verify|--menu]

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_NODE = [22, 18];

const ACTIONS = [
  { key: "1", label: "全里程碑验证 (190 项)", npm: "verify" },
  { key: "2", label: "M1 数据底座", npm: "verify:data-core" },
  { key: "3", label: "M3 合法 OA 全文", npm: "verify:oa-fulltext" },
  { key: "4", label: "M4 总结管线", npm: "verify:summarize" },
  { key: "5", label: "M5 调度 + 推送", npm: "verify:scheduler-push" },
  { key: "6", label: "M6 导出", npm: "verify:export" },
  { key: "7", label: "证据可信性", npm: "verify:trust" },
  { key: "q", label: "退出", npm: null },
];

function parseNodeVersion(raw) {
  const m = /^v?(\d+)\.(\d+)/.exec(String(raw ?? ""));
  return m ? [+m[1], +m[2]] : [0, 0];
}

function nodeOk() {
  const [major, minor] = parseNodeVersion(process.version);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

function banner() {
  console.log("\n  Lumina Feed · 快速启动");
  console.log("  " + "─".repeat(46));
  console.log(`  Node ${process.version}  ·  目录 ${ROOT}`);
  console.log("  " + "─".repeat(46) + "\n");
}

function fail(msg, code = 1) {
  console.error(`  ✗ ${msg}\n`);
  process.exitCode = code;
}

function checkEnv() {
  if (!nodeOk()) {
    fail(`需要 Node ≥ ${MIN_NODE.join(".")}，当前 ${process.version}`);
    return false;
  }
  return true;
}

function runNpmScript(script) {
  const r = spawnSync("npm", ["run", script], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  process.exitCode = r.status ?? 1;
}

function printMenu() {
  console.log("  选择要运行的测试：\n");
  for (const a of ACTIONS) {
    console.log(`    ${a.key}) ${a.label}`);
  }
  console.log("");
}

async function interactiveMenu() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    printMenu();
    const ans = (await rl.question("  请输入编号 [1]: ")).trim() || "1";
    const action = ACTIONS.find((a) => a.key === ans.toLowerCase());
    if (!action || !action.npm) {
      console.log("\n  已退出。\n");
      process.exitCode = 0;
      return;
    }
    console.log(`\n  → npm run ${action.npm}\n`);
    runNpmScript(action.npm);
  } finally {
    rl.close();
  }
}

function usage() {
  console.log(`用法:
  node tools/quickstart.mjs           默认：全里程碑验证
  node tools/quickstart.mjs --verify  同上
  node tools/quickstart.mjs --menu    交互菜单
  node tools/quickstart.mjs --help    显示帮助

  也可：npm run quickstart [-- --menu]
`);
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    usage();
    return;
  }
  banner();
  if (!checkEnv()) return;

  if (arg === "--menu" || arg === "-m") {
    await interactiveMenu();
    return;
  }

  console.log("  → npm run verify（零依赖沙箱验证）\n");
  runNpmScript("verify");
}

main().catch((err) => {
  fail(err?.message ?? String(err));
});
