// lumina-feed · Webhook 通道（零依赖：global fetch + node:crypto）
import { createHmac } from "node:crypto";
import type { Channel, NotifyResult, Rendered } from "../types.ts";
import type { Digest } from "../../schedule/types.ts";

export interface WebhookConfig {
  url: string;
  enabled?: boolean;
  /** HMAC-SHA256 签名密钥（从 env/钥匙串注入，勿写配置文件） */
  secret?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export function webhookChannel(cfg: WebhookConfig, deps: { fetchImpl?: typeof fetch } = {}): Channel {
  const f = deps.fetchImpl ?? fetch;
  return {
    id: "webhook",
    enabled: cfg.enabled ?? true,
    async send(_digest: Digest, rendered: Rendered): Promise<NotifyResult> {
      const body = JSON.stringify(rendered.payload);
      const headers: Record<string, string> = { "content-type": "application/json", ...(cfg.headers ?? {}) };
      if (cfg.secret) headers["x-lumina-signature"] = "sha256=" + createHmac("sha256", cfg.secret).update(body).digest("hex");
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 10_000);
      try {
        const res = await f(cfg.url, { method: "POST", headers, body, signal: ctrl.signal });
        if (!res.ok) return { channel: "webhook", ok: false, error: `HTTP ${res.status}` };
        return { channel: "webhook", ok: true, detail: `HTTP ${res.status}` };
      } catch (e) {
        return { channel: "webhook", ok: false, error: String((e as Error)?.message ?? e) };
      } finally {
        clearTimeout(to);
      }
    },
  };
}
