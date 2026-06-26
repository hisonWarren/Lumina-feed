#!/usr/bin/env node
// lumina-feed · 自托管推送 worker（C 可选：真正推到手机/邮箱，24/7）
// 复用同一套核心：Scheduler + Notifier + Europe PMC 适配器。
// 运行：
//   node --experimental-strip-types worker/push-worker.mjs --once     # 给系统 cron / systemd timer
//   node --experimental-strip-types worker/push-worker.mjs --daemon   # 给 pm2 / Docker 常驻
// 配置：LUMINA_CONFIG=/path/config.json（订阅 + 通道开关 + SMTP/收件信息，但密钥走 env）
// 密钥(env)：SMTP_PASS / TELEGRAM_BOT_TOKEN / WEBHOOK_SECRET / LLM_API_KEY
// 合规：单次礼貌请求 + email 署名 + 仅推元数据/AI 总结/链接；全文仅经合法 OA。
import fs from "node:fs";
import path from "node:path";
import { Scheduler } from "../src/core/schedule/scheduler.ts";
import { Notifier } from "../src/core/notify/notifier.ts";
import { emailChannel } from "../src/core/notify/channels/email.ts";
import { telegramChannel } from "../src/core/notify/channels/telegram.ts";
import { webhookChannel } from "../src/core/notify/channels/webhook.ts";
import { searchEuropePmc } from "../src/core/sources/europepmc.ts";

const CONFIG_PATH = process.env.LUMINA_CONFIG ?? path.resolve(process.cwd(), "worker/config.json");
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const STATE_PATH = cfg.statePath ?? path.resolve(path.dirname(CONFIG_PATH), "lumina-state.json");

// ── 状态：lastRun/seenIds 落 JSON 文件，跨 cron 运行幂等 ──
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return {}; } }
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), { mode: 0o600 }); }

const state = loadState();

// ── 订阅：config.subscriptions + state 合并出 lastRunAt/seenIds ──
function loadSubscriptions() {
  return (cfg.subscriptions ?? []).map((s) => ({
    ...s,
    lastRunAt: state[s.id]?.lastRunAt ?? null,
    seenIds: state[s.id]?.seenIds ?? [],
  }));
}
function saveSubscription(sub) {
  state[sub.id] = { lastRunAt: sub.lastRunAt, seenIds: sub.seenIds };
  saveState(state);
}

// ── runDigest：真实 Europe PMC 取增量 +（可选）LLM 总结 ──
async function runDigest(sub, sinceISO) {
  const items = await searchEuropePmc(sub.query ?? {}, {
    email: cfg.contactEmail,           // 礼貌署名（强烈建议在 config 填）
    pageSize: cfg.pageSize ?? 25,
    sinceISO,
  });
  // 可选总结：配置开启且有 LLM key 时，给前 N 条加 tldr（此处示意，真实接 M4）
  if (cfg.summarize?.enabled && process.env.LLM_API_KEY) {
    for (const it of items.slice(0, cfg.summarize.max ?? 10)) {
      it.tldr = it.tldr ?? `（摘要要点占位 · 接入 M4 后填充）`;
      it.sourceBasis = "abstract"; // 推送链路默认基于摘要；全文总结在桌面端合法 OA 取回后进行
    }
  }
  return { items };
}

// ── 通道：从 config（收件/host）+ env（密钥）组装 ──
function buildNotifier() {
  const chans = [];
  if (cfg.channels?.email?.enabled) chans.push(emailChannel(cfg.channels.email)); // 密码读 env SMTP_PASS
  if (cfg.channels?.telegram?.enabled)
    chans.push(telegramChannel({ ...cfg.channels.telegram, botToken: process.env.TELEGRAM_BOT_TOKEN ?? "" }));
  if (cfg.channels?.webhook?.enabled)
    chans.push(webhookChannel({ ...cfg.channels.webhook, secret: process.env.WEBHOOK_SECRET }));
  return new Notifier(chans, { productName: cfg.productName ?? "Lumina Feed" });
}

async function main() {
  const mode = process.argv.includes("--daemon") ? "daemon" : "once";
  const notifier = buildNotifier();
  const scheduler = new Scheduler({
    loadSubscriptions, saveSubscription, runDigest,
    notify: (digest) => notifier.dispatch(digest),
    onResult: (r) => {
      const tag = r.error ? "ERROR" : r.skipped ?? `pushed ${r.newCount}`;
      console.log(`[${new Date().toISOString()}] ${r.subscriptionId}: ${tag}${r.error ? " — " + r.error : ""}`);
    },
  });

  if (mode === "daemon") {
    console.log("lumina worker · daemon 模式（内置 tick 循环）");
    scheduler.start(cfg.tickMs ?? 60_000);
    process.on("SIGINT", () => { scheduler.stop(); process.exit(0); });
    process.on("SIGTERM", () => { scheduler.stop(); process.exit(0); });
  } else {
    console.log("lumina worker · once 模式（适配系统 cron / systemd timer）");
    const results = await scheduler.tick();
    const pushed = results.filter((r) => r.newCount > 0).length;
    console.log(`完成：${results.length} 订阅，${pushed} 个有推送。`);
    process.exit(0);
  }
}

main().catch((e) => { console.error("worker 失败：", e); process.exit(1); });
