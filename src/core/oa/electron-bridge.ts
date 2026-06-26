// lumina-feed · M3 Electron 主进程 PDF 桥（集成层骨架）
// 桌面端把 fetchPdf 的 electronFetch 指向这里：主进程取字节，绕开渲染进程 CORS，
// 且在 main 侧再次守门（纵深防御②）+ 大小/magic 校验。
// electron 动态导入：本模块在非 Electron 环境（如测试）也能被加载，仅调用时才需 electron。
import { isFetchableUrl } from "../summarize/oa-guard.ts";

const MAX = 30 * 1024 * 1024;
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

/** 在 app ready 后调用一次：注册 oa:fetchPdf。 */
export async function registerOaPdfBridge(): Promise<void> {
  const { ipcMain } = (await import("electron")) as any;
  ipcMain.handle("oa:fetchPdf", async (_e: unknown, url: string): Promise<Uint8Array> => {
    if (!isFetchableUrl(url, { allowAltSources: true })) throw new Error("拒绝：无效链接");
    const bytes = await fetchViaNet(url);
    if (bytes.byteLength > MAX) throw new Error("PDF 超出大小上限");
    if (!bytes.subarray(0, 4).equals(PDF_MAGIC)) throw new Error("内容非 PDF");
    return bytes;
  });
}

/** 用 Electron net（走系统代理/证书）抓字节。 */
async function fetchViaNet(url: string): Promise<Buffer> {
  const { net } = (await import("electron")) as any;
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("response", (res: any) => {
      const status = res.statusCode ?? 0;
      if (status >= 400) { reject(new Error(`HTTP ${status}`)); return; }
      res.on("data", (c: Buffer) => {
        total += c.length;
        if (total > MAX) { req.abort(); reject(new Error("PDF 超出大小上限")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

// preload 契约（渲染进程经 contextBridge 拿到）：
//   contextBridge.exposeInMainWorld('luminaOa', {
//     fetchPdf: (url) => ipcRenderer.invoke('oa:fetchPdf', url),
//   });
// 然后 fetchPdf 注入：electronFetch: (url) => window.luminaOa.fetchPdf(url)
