// lumina-feed · Notifier
// 一次渲染，扇出到所有启用通道；任一通道失败不影响其它（部分成功）。
import type { Channel, NotifyResult } from "./types.ts";
import type { Digest } from "../schedule/types.ts";
import { renderDigest, type RenderOptions } from "./format.ts";

export class Notifier {
  private channels: Channel[];
  private opts: RenderOptions;
  constructor(channels: Channel[], opts: RenderOptions = {}) {
    this.channels = channels;
    this.opts = opts;
  }
  setChannels(channels: Channel[]) { this.channels = channels; }

  async dispatch(digest: Digest): Promise<NotifyResult[]> {
    const rendered = renderDigest(digest, this.opts);
    const active = this.channels.filter((c) => c.enabled);
    if (active.length === 0) return [{ channel: "(none)", ok: false, error: "无启用通道" }];
    const settled = await Promise.allSettled(active.map((c) => c.send(digest, rendered)));
    return settled.map((s, i) =>
      s.status === "fulfilled" ? s.value
        : { channel: active[i].id, ok: false, error: String((s.reason as Error)?.message ?? s.reason) });
  }
}
