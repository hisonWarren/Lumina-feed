// lumina-feed · Telegram 通道（零依赖：global fetch + Bot API）
// 用法：BotFather 建 bot 拿 token；与 bot 对话或拉群后取 chat_id。token 从 env/钥匙串注入。
import type { Channel, NotifyResult, Rendered } from "../types.ts";
import type { Digest } from "../../schedule/types.ts";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled?: boolean;
  /** 长简报分条发送（Telegram 单条 4096 字符上限） */
  disableWebPagePreview?: boolean;
  timeoutMs?: number;
}

export function telegramChannel(cfg: TelegramConfig, deps: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): Channel {
  const f = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? "https://api.telegram.org";
  return {
    id: "telegram",
    enabled: cfg.enabled ?? true,
    async send(_digest: Digest, rendered: Rendered): Promise<NotifyResult> {
      const url = `${base}/bot${cfg.botToken}/sendMessage`;
      // Telegram 单条上限 4096，按需截断（完整内容回 App 看）
      const text = rendered.tgHtml.length > 4000 ? rendered.tgHtml.slice(0, 3900) + "\n…（详见 App）" : rendered.tgHtml;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 10_000);
      try {
        const res = await f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: cfg.chatId, text, parse_mode: "HTML",
            disable_web_page_preview: cfg.disableWebPagePreview ?? true,
          }),
          signal: ctrl.signal,
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false)
          return { channel: "telegram", ok: false, error: data?.description ?? `HTTP ${res.status}` };
        return { channel: "telegram", ok: true, detail: `message_id ${data?.result?.message_id ?? "?"}` };
      } catch (e) {
        return { channel: "telegram", ok: false, error: String((e as Error)?.message ?? e) };
      } finally {
        clearTimeout(to);
      }
    },
  };
}
