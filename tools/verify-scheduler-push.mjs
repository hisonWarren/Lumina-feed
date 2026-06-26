// lumina-feed · 调度与推送 行为门（可在沙箱真跑）
// 运行：node --experimental-strip-types tools/verify-scheduler-push.mjs
import http from "node:http";
import { createHmac } from "node:crypto";

import { isDue, withinQuietHours, lastScheduledInstant, nextRunAt, partsInTz } from "../src/core/schedule/due.ts";
import { Scheduler } from "../src/core/schedule/scheduler.ts";
import { Notifier } from "../src/core/notify/notifier.ts";
import { renderDigest } from "../src/core/notify/format.ts";
import { webhookChannel } from "../src/core/notify/channels/webhook.ts";
import { telegramChannel } from "../src/core/notify/channels/telegram.ts";
import { emailChannel } from "../src/core/notify/channels/email.ts";
import { nativeChannel } from "../src/core/notify/channels/native.ts";
import { setAutostart } from "../src/core/schedule/autostart.ts";
import { searchEuropePmc } from "../src/core/sources/europepmc.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };
const TZ = "Asia/Shanghai";
const silent = () => {};

// ───────────────────────── A. 调度判定 ─────────────────────────
console.log("— A. 调度判定（时区/安静时段/补漏跑） —");
{
  const now = new Date("2026-06-26T01:00:00Z"); // 09:00 CST, Friday
  ok(partsInTz(now, TZ).hour === 9 && partsInTz(now, TZ).weekday === 5, "tz 墙钟 09:00 周五");
  const daily = { freq: "daily", time: "08:00", tz: TZ };
  ok(lastScheduledInstant(daily, now).toISOString() === "2026-06-26T00:00:00.000Z", "daily 实例=今天08:00 CST");
  ok(isDue(daily, "2026-06-25T00:30:00Z", now).due === true, "昨天跑过→今天到点 due");
  ok(isDue(daily, "2026-06-26T00:05:00Z", now).due === false, "今天已跑→not due");
  ok(isDue(daily, "2026-06-23T00:10:00Z", now).due === true, "关机3天后→catch-up due");
  ok(withinQuietHours(now, TZ, [22, 8]) === false, "09:00 不在安静[22,8)");
  ok(withinQuietHours(new Date("2026-06-26T15:00:00Z"), TZ, [22, 8]) === true, "23:00 在安静[22,8)");
  ok(withinQuietHours(new Date("2026-06-25T23:00:00Z"), TZ, [22, 8]) === true, "07:00 在安静[22,8)");
  const weekly = { freq: "weekly", time: "08:00", tz: TZ, weekday: 5 };
  ok(isDue(weekly, "2026-06-19T00:10:00Z", now).due === true, "weekly 上周五→本周五 due");
  ok(isDue(weekly, "2026-06-26T00:10:00Z", now).due === false, "weekly 本周已跑→not due");
  const hourly = { freq: "hourly", tz: TZ, everyMinutes: 30 };
  ok(isDue(hourly, new Date(now.getTime() - 31 * 60000).toISOString(), now).due === true, "hourly 31min→due");
  ok(isDue(hourly, new Date(now.getTime() - 10 * 60000).toISOString(), now).due === false, "hourly 10min→not due");
  ok(nextRunAt(daily, now).toISOString() === "2026-06-27T00:00:00.000Z", "下次=明天08:00 CST");
}

// ───────────────────────── B. 调度引擎端到端 ─────────────────────────
console.log("— B. 调度引擎（due/去重/安静延迟/禁用/catch-up） —");
function makeEngine({ lastRunAt = null, enabled = true, items, nowISO }) {
  let CURRENT = new Date(nowISO);
  const store = [{ id: "s1", name: "测试订阅", query: { raw: "x" }, schedule: { freq: "daily", time: "08:00", tz: TZ, quietHours: [22, 8] }, enabled, lastRunAt, seenIds: [] }];
  const notified = [];
  const sched = new Scheduler({
    clock: { now: () => CURRENT },
    logger: silent,
    loadSubscriptions: () => store,
    saveSubscription: (sub) => { const i = store.findIndex((s) => s.id === sub.id); store[i] = sub; },
    runDigest: async () => ({ items }),
    notify: async (d) => { notified.push(d); },
  });
  return { sched, store, notified, setNow: (iso) => { CURRENT = new Date(iso); } };
}
const ITEMS = [
  { id: "doi:a", title: "Paper A", journal: "NEJM", year: 2026, isPreprint: false, tldr: "A 结论", sourceBasis: "fulltext" },
  { id: "doi:b", title: "Paper B", journal: "bioRxiv", year: 2026, isPreprint: true, tldr: "B 结论", sourceBasis: "abstract" },
];
{
  // due → 推送
  const e = makeEngine({ lastRunAt: "2026-06-25T00:30:00Z", items: ITEMS, nowISO: "2026-06-26T01:00:00Z" });
  const r1 = await e.sched.tick();
  ok(r1[0].newCount === 2 && e.notified.length === 1, "due→推送2篇,notify 1次");
  ok(e.store[0].lastRunAt === "2026-06-26T01:00:00.000Z" && e.store[0].seenIds.length === 2, "lastRunAt 推进 + seenIds 记 2");
  // 同日再 tick → not_due
  const r2 = await e.sched.tick();
  ok(r2[0].skipped === "not_due" && e.notified.length === 1, "同日再 tick→not_due,不重复推");
  // 去重：runNow 两次,第二次 no_new
  await e.sched.runNow("s1");
  const before = e.notified.length;
  const rn = await e.sched.runNow("s1");
  ok(rn.skipped === "no_new" && e.notified.length === before, "去重:相同命中→no_new");
}
{
  // 安静时段：到点但 23:00 → 延迟,不推不推进
  const e = makeEngine({ lastRunAt: "2026-06-25T00:30:00Z", items: ITEMS, nowISO: "2026-06-26T15:00:00Z" }); // 23:00 CST
  const r = await e.sched.tick();
  ok(r[0].skipped === "quiet_hours" && e.notified.length === 0, "安静时段→延迟(quiet_hours)不推送");
  ok(e.store[0].lastRunAt === "2026-06-25T00:30:00Z", "安静时段 lastRunAt 不推进(留待补发)");
}
{
  // 禁用
  const e = makeEngine({ lastRunAt: null, enabled: false, items: ITEMS, nowISO: "2026-06-26T01:00:00Z" });
  const r = await e.sched.tick();
  ok(r[0].skipped === "disabled" && e.notified.length === 0, "禁用→skipped disabled");
}
{
  // catch-up：关机3天
  const e = makeEngine({ lastRunAt: "2026-06-23T00:10:00Z", items: ITEMS, nowISO: "2026-06-26T01:00:00Z" });
  const r = await e.sched.tick();
  ok(r[0].newCount === 2, "catch-up:关机3天后开机→补发");
}

// ───────────────────────── C. 通道(真 HTTP) ─────────────────────────
console.log("— C. 推送通道（webhook/telegram 走真 HTTP；email/native 假实现） —");
const received = [];
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ url: req.url, method: req.method, headers: req.headers, body });
    if (req.url.includes("/sendMessage")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, result: { message_id: 42 } })); }
    else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); }
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const digest = { subscriptionId: "s1", subscriptionName: "急性心梗 · SGLT2", date: "2026-06-26", generatedAt: "2026-06-26T01:00:00Z", items: ITEMS, stats: { total: 2, preprints: 1 } };
const rendered = renderDigest(digest, { productName: "Lumina Feed" });

{
  // webhook + HMAC
  const ch = webhookChannel({ url: `${BASE}/hook`, secret: "topsecret" });
  const r = await ch.send(digest, rendered);
  const got = received.find((x) => x.url === "/hook");
  const expSig = "sha256=" + createHmac("sha256", "topsecret").update(got.body).digest("hex");
  ok(r.ok === true, "webhook 发送 ok");
  ok(got && JSON.parse(got.body).type === "lumina.digest" && JSON.parse(got.body).count === 2, "webhook payload 正确(type+count)");
  ok(got.headers["x-lumina-signature"] === expSig, "webhook HMAC 签名校验通过");
}
{
  // telegram
  const ch = telegramChannel({ botToken: "TKN", chatId: "999" }, { baseUrl: BASE });
  const r = await ch.send(digest, rendered);
  const got = received.find((x) => x.url === "/botTKN/sendMessage");
  const jb = got ? JSON.parse(got.body) : {};
  ok(r.ok === true && r.detail.includes("42"), "telegram 发送 ok(message_id 42)");
  ok(got && jb.chat_id === "999" && jb.parse_mode === "HTML" && jb.text.includes("急性心梗"), "telegram 请求正确(chat_id+HTML+内容)");
}
{
  // email 假 transport
  let captured = null;
  const ch = emailChannel({ from: "a@x", to: "b@y", enabled: true }, { transport: { sendMail: async (m) => { captured = m; return { messageId: "mid-1" }; } } });
  const r = await ch.send(digest, rendered);
  ok(r.ok === true && r.detail === "mid-1", "email 发送 ok(注入 transport)");
  ok(captured.to === "b@y" && captured.subject.includes("急性心梗") && captured.html.includes("证据简报"), "email 内容正确(to+subject+html)");
}
{
  // native 假 notify
  let cap = null;
  const ch = nativeChannel({ notify: (title, body) => { cap = { title, body }; } });
  const r = await ch.send(digest, rendered);
  ok(r.ok === true && cap.title.includes("2 篇") && cap.body.includes("Paper A"), "native 通知正确(标题含数量+正文含首篇)");
}

// ───────────────────────── D. Notifier 扇出(部分失败) ─────────────────────────
console.log("— D. Notifier 扇出 + 部分失败容错 —");
{
  const good = nativeChannel({ notify: () => {} });
  const bad = { id: "boom", enabled: true, send: async () => { throw new Error("通道炸了"); } };
  const off = { id: "off", enabled: false, send: async () => ({ channel: "off", ok: true }) };
  const n = new Notifier([good, bad, off]);
  const results = await n.dispatch(digest);
  ok(results.length === 2, "只发启用通道(2/3)");
  ok(results.some((r) => r.ok) && results.some((r) => !r.ok && r.error.includes("炸")), "一个成功一个失败→部分成功不互相影响");
}

// ───────────────────────── E. 渲染(反幻觉/合规) ─────────────────────────
console.log("— E. 渲染产物（徽章/合规） —");
{
  ok(rendered.subject.includes("2 篇") && rendered.subject.includes("2026-06-26"), "subject 含数量+日期");
  ok(rendered.text.includes("预印本") && rendered.text.includes("基于全文"), "text 含预印本标识 + 依据徽章");
  ok(rendered.html.includes("同行评议") || rendered.html.includes("预印本"), "html 含评议状态徽章");
  ok(rendered.tgHtml.includes("<b>") && rendered.tgHtml.includes("Paper A"), "telegram HTML 含粗体标题");
  const lower = JSON.stringify(rendered.payload).toLowerCase();
  ok(!/abstract:|full[_ ]?text content|fulltextbody/.test(lower) && rendered.payload.items[0].sourceBasis === "fulltext", "payload 只含元数据+依据,不含受版权全文正文");
}

// ───────────────────────── F. 自启(注入后端) ─────────────────────────
console.log("— F. 开机自启（注入后端） —");
{
  let enabled = false;
  const backend = { isEnabled: async () => enabled, enable: async () => { enabled = true; }, disable: async () => { enabled = false; } };
  ok((await setAutostart(true, backend)) === true, "setAutostart(true)→enabled");
  ok((await setAutostart(false, backend)) === false, "setAutostart(false)→disabled");
}

// ───────────────────────── G. Europe PMC 适配器(注入 fetch) ─────────────────────────
console.log("— G. Europe PMC 适配器（注入 fetch，解析/since/preprint） —");
{
  const CANNED = { resultList: { result: [
    { source: "MED", id: "1", doi: "10.1/new", title: "Recent RCT", authorString: "Lee J, Kim S", journalTitle: "NEJM", pubYear: "2026", firstPublicationDate: "2026-06-25", isOpenAccess: "Y",
      fullTextUrlList: { fullTextUrl: [{ url: "https://oa.example/html", documentStyle: "html", availabilityCode: "OA" }] } },
    { source: "PPR", id: "2", doi: "10.1101/pp", title: "A Preprint", authorString: "Alvarez M", pubYear: "2026", firstPublicationDate: "2026-06-26", pubType: "preprint" },
    { source: "MED", id: "3", doi: "10.1/old", title: "Old paper", pubYear: "2020", firstPublicationDate: "2020-01-01" },
  ] } };
  const fakeFetch = async () => ({ ok: true, json: async () => CANNED });
  const since = "2026-06-20T00:00:00Z";
  const items = await searchEuropePmc({ raw: "test" }, { fetchImpl: fakeFetch, sinceISO: since });
  ok(items.length === 2, "since 过滤掉 2020 旧文(3→2)");
  const pre = items.find((i) => i.doi === "10.1101/pp");
  ok(pre && pre.isPreprint === true && pre.type === "preprint", "PPR 识别为预印本");
  const oa = items.find((i) => i.doi === "10.1/new");
  ok(oa && oa.url === "https://oa.example/html", "优先取 OA 全文 HTML 链接");
  ok(oa && Array.isArray(oa.authors) && oa.authors[0] === "Lee J", "作者解析");
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
