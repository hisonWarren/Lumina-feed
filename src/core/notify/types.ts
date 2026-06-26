// lumina-feed · 推送通道类型
import type { Digest } from "../schedule/types.ts";

export interface NotifyResult {
  channel: string;
  ok: boolean;
  detail?: string;
  error?: string;
}

/** 简报渲染为各通道所需的载体（一次渲染，多通道复用） */
export interface Rendered {
  subject: string;
  text: string;       // 纯文本（邮件 fallback / 原生通知）
  html: string;       // 邮件 HTML
  tgHtml: string;     // Telegram parse_mode=HTML 安全子集
  payload: unknown;   // Webhook JSON
}

export interface Channel {
  id: string;
  enabled: boolean;
  send(digest: Digest, rendered: Rendered): Promise<NotifyResult>;
}

export type { Digest };
