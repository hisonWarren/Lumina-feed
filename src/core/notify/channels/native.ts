// lumina-feed · 原生系统通知通道（B 增强的「本地通知」出口）
// 桌面端默认走 Electron Notification；可注入便于测试 / 换 node-notifier。
import type { Channel, NotifyResult, Rendered } from "../types.ts";
import type { Digest } from "../../schedule/types.ts";

export interface NativeDeps {
  /** 注入通知实现；缺省用 Electron Notification（动态导入） */
  notify?: (title: string, body: string, onClick?: () => void) => void;
  /** 点击通知的回调（通常聚焦窗口 + 打开该订阅简报） */
  onClick?: (digest: Digest) => void;
  enabled?: boolean;
}

async function electronNotify(title: string, body: string, onClick?: () => void) {
  const { Notification } = (await import("electron")) as any;
  const n = new Notification({ title, body });
  if (onClick) n.on("click", onClick);
  n.show();
}

export function nativeChannel(deps: NativeDeps = {}): Channel {
  return {
    id: "native",
    enabled: deps.enabled ?? true,
    async send(digest: Digest, _rendered: Rendered): Promise<NotifyResult> {
      const title = `${digest.subscriptionName} · ${digest.items.length} 篇新文献`;
      const first = digest.items[0];
      const body = first ? `${first.title}${digest.items.length > 1 ? ` 等 ${digest.items.length} 篇` : ""}` : "今日有新命中";
      try {
        const fn = deps.notify ?? electronNotify;
        fn(title, body, deps.onClick ? () => deps.onClick!(digest) : undefined);
        return { channel: "native", ok: true, detail: "shown" };
      } catch (e) {
        return { channel: "native", ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  };
}
