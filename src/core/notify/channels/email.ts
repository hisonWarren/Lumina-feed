// lumina-feed · Email 通道（SMTP）
// 真实实现用 nodemailer（动态导入，未装则仅在创建默认 transport 时报错，便于无依赖测试）。
// 安全：SMTP 密码经 env / 系统钥匙串注入，绝不写入配置文件。
import type { Channel, NotifyResult, Rendered } from "../types.ts";
import type { Digest } from "../../schedule/types.ts";

/** 与 nodemailer transporter 的最小契约（便于注入假实现） */
export interface MailTransport {
  sendMail(msg: { from: string; to: string; subject: string; text: string; html: string }): Promise<{ messageId?: string }>;
}

export interface EmailConfig {
  from: string;
  to: string;
  enabled?: boolean;
  smtp?: { host: string; port: number; secure?: boolean; user: string };
}

export interface EmailDeps {
  /** 注入现成 transport（测试/复用）；否则用 nodemailer + getPassword 现建 */
  transport?: MailTransport;
  /** 取 SMTP 密码（钥匙串/env），仅默认 transport 路径需要 */
  getPassword?: () => Promise<string> | string;
}

async function defaultTransport(cfg: EmailConfig, getPassword?: EmailDeps["getPassword"]): Promise<MailTransport> {
  if (!cfg.smtp) throw new Error("缺少 SMTP 配置");
  const nodemailer: any = (await import("nodemailer")).default;
  const pass = getPassword ? await getPassword() : process.env.SMTP_PASS;
  if (!pass) throw new Error("缺少 SMTP 密码（请置于 env SMTP_PASS 或钥匙串）");
  return nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure ?? cfg.smtp.port === 465,
    auth: { user: cfg.smtp.user, pass },
  });
}

export function emailChannel(cfg: EmailConfig, deps: EmailDeps = {}): Channel {
  return {
    id: "email",
    enabled: cfg.enabled ?? true,
    async send(_digest: Digest, rendered: Rendered): Promise<NotifyResult> {
      try {
        const tx = deps.transport ?? (await defaultTransport(cfg, deps.getPassword));
        const info = await tx.sendMail({ from: cfg.from, to: cfg.to, subject: rendered.subject, text: rendered.text, html: rendered.html });
        return { channel: "email", ok: true, detail: info?.messageId ?? "sent" };
      } catch (e) {
        return { channel: "email", ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  };
}
