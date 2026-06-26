// lumina-feed · 简报渲染（纯函数）
// 合规：只渲染元数据 + 你配置生成的 AI 总结 + 原文链接；绝不在推送里塞受版权全文。
// 反幻觉：每条标注 sourceBasis（基于全文/基于摘要）。预印本显式标「未经同行评议」。
import type { Digest, DigestItem, Rendered } from "./types.ts";

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function basisLabel(b: DigestItem["sourceBasis"]): string {
  return b === "fulltext" ? "基于全文" : b === "abstract" ? "基于摘要" : "";
}

export interface RenderOptions {
  productName?: string;
  /** 简报页深链（点击通知/邮件回到 App） */
  appDeepLink?: string;
  language?: "zh" | "en";
}

export function renderDigest(d: Digest, opts: RenderOptions = {}): Rendered {
  const product = opts.productName ?? "Lumina Feed";
  const subject = `${product} · ${d.subscriptionName} · ${d.items.length} 篇新文献 (${d.date})`;

  // ── 纯文本 ──
  const textLines: string[] = [`${product} 每日简报 — ${d.subscriptionName}`, `${d.date} · ${d.items.length} 篇新命中`, ""];
  d.items.forEach((it, i) => {
    textLines.push(`${i + 1}. ${it.title}`);
    const meta = [it.journal, it.year, it.isPreprint ? "预印本·未经同行评议" : null].filter(Boolean).join(" · ");
    if (meta) textLines.push(`   ${meta}`);
    if (it.tldr) textLines.push(`   ▸ ${it.tldr}${basisLabel(it.sourceBasis) ? `（${basisLabel(it.sourceBasis)}）` : ""}`);
    if (it.url) textLines.push(`   ${it.url}`);
    textLines.push("");
  });
  textLines.push("— AI 仅排序与总结，纳入/排除由你决定 · 全文仅经合法 OA 获取");
  const text = textLines.join("\n");

  // ── 邮件 HTML（内联样式，邮件客户端友好） ──
  const itemHtml = d.items.map((it, i) => {
    const tags: string[] = [];
    if (it.type) tags.push(chip(esc(it.type), "#2E4A8B"));
    tags.push(it.isPreprint ? chip("预印本 · 未评议", "#B5852A") : chip("同行评议", "#2F7A57"));
    if (basisLabel(it.sourceBasis)) tags.push(chip(basisLabel(it.sourceBasis), it.sourceBasis === "fulltext" ? "#2F7A57" : "#B5852A"));
    const title = it.url ? `<a href="${esc(it.url)}" style="color:#16181D;text-decoration:none">${esc(it.title)}</a>` : esc(it.title);
    return `
      <tr><td style="padding:14px 0;border-bottom:1px solid #ECECEC">
        <div style="font:600 16px Georgia,serif;color:#16181D;line-height:1.35">${i + 1}. ${title}</div>
        <div style="font:12px ui-monospace,monospace;color:#888;margin-top:5px">${[esc(it.journal ?? ""), it.year ?? ""].filter(Boolean).join(" · ")}</div>
        ${it.tldr ? `<div style="font:13px sans-serif;color:#444;margin-top:7px">▸ ${esc(it.tldr)}</div>` : ""}
        <div style="margin-top:8px">${tags.join(" ")}</div>
      </td></tr>`;
  }).join("");
  const html = `
  <div style="max-width:640px;margin:0 auto;font-family:sans-serif;background:#fff;padding:24px">
    <div style="font:11px ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#B5852A">每日证据简报</div>
    <div style="font:600 26px Georgia,serif;color:#16181D;margin:6px 0 2px">${esc(d.subscriptionName)}</div>
    <div style="font:13px sans-serif;color:#888">${d.date} · ${d.items.length} 篇新命中</div>
    <table style="width:100%;border-collapse:collapse;margin-top:14px">${itemHtml}</table>
    <div style="font:11px sans-serif;color:#aaa;margin-top:18px;line-height:1.6">
      AI 仅排序与总结，纳入/排除由你决定 · 全文仅经合法 OA 获取，链接指向原文。
      ${opts.appDeepLink ? `<br><a href="${esc(opts.appDeepLink)}" style="color:#2E4A8B">在 ${esc(product)} 中打开 →</a>` : ""}
    </div>
  </div>`;

  // ── Telegram（HTML 子集：b / a / i） ──
  const tgLines = [`<b>${esc(product)} · ${esc(d.subscriptionName)}</b>`, `${d.date} · ${d.items.length} 篇新命中`, ""];
  d.items.slice(0, 12).forEach((it, i) => {
    const t = it.url ? `<a href="${esc(it.url)}">${esc(it.title)}</a>` : `<b>${esc(it.title)}</b>`;
    tgLines.push(`${i + 1}. ${t}`);
    const sub = [esc(it.journal ?? ""), it.year ?? "", it.isPreprint ? "预印本" : ""].filter(Boolean).join(" · ");
    if (sub) tgLines.push(`<i>${sub}</i>`);
    if (it.tldr) tgLines.push(`▸ ${esc(it.tldr)}`);
    tgLines.push("");
  });
  if (d.items.length > 12) tgLines.push(`…另有 ${d.items.length - 12} 篇，详见 App`);
  const tgHtml = tgLines.join("\n");

  // ── Webhook JSON ──
  const payload = {
    product, type: "lumina.digest",
    subscription: { id: d.subscriptionId, name: d.subscriptionName },
    date: d.date, generatedAt: d.generatedAt, count: d.items.length, stats: d.stats,
    items: d.items.map((it) => ({
      id: it.id, title: it.title, authors: it.authors, journal: it.journal, year: it.year,
      doi: it.doi, url: it.url, isPreprint: !!it.isPreprint, type: it.type,
      tldr: it.tldr ?? null, sourceBasis: it.sourceBasis ?? null,
    })),
    notice: "metadata + AI summary only; full text via legal OA; AI ranks/summarizes, user decides inclusion",
  };

  return { subject, text, html, tgHtml, payload };
}

function chip(label: string, color: string): string {
  return `<span style="display:inline-block;font:11px sans-serif;color:${color};border:1px solid ${color}33;border-radius:6px;padding:2px 8px;margin-right:4px">${label}</span>`;
}
