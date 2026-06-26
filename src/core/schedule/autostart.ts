// lumina-feed · 开机自启（B 增强）
// 工程真相：让「定时本地通知」在不开 App 时也成立，需要进程在登录后常驻：
//   ① 设为登录启动项（本文件）  ② App 不在关窗口时退出（保留托盘，见 electron/scheduler-main.ts）
//   ③ Scheduler.start() 的 tick 循环负责按时触发  ④ catch-up 兜住关机/休眠错过的那次。
// 后端可注入，便于测试；真实实现用 auto-launch（跨平台）或 Electron 内置 login-item（mac/win）。

export interface AutostartBackend {
  isEnabled(): Promise<boolean>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}

/** 跨平台（含 Linux）：npm i auto-launch。动态导入，未装时调用才报错。 */
export function autoLaunchBackend(opts: { appName: string; appPath?: string; isHidden?: boolean }): AutostartBackend {
  let inst: any = null;
  const get = async () => {
    if (inst) return inst;
    const AutoLaunch = (await import("auto-launch")).default as any;
    inst = new AutoLaunch({ name: opts.appName, path: opts.appPath, isHidden: opts.isHidden ?? true });
    return inst;
  };
  return {
    async isEnabled() { return (await get()).isEnabled(); },
    async enable() { const a = await get(); if (!(await a.isEnabled())) await a.enable(); },
    async disable() { const a = await get(); if (await a.isEnabled()) await a.disable(); },
  };
}

/** Electron 内置（mac/win 无需额外依赖）：app.setLoginItemSettings。 */
export function electronLoginItemBackend(opts: { openAsHidden?: boolean; args?: string[] } = {}): AutostartBackend {
  const getApp = async () => (await import("electron")).app as any;
  return {
    async isEnabled() { const app = await getApp(); return !!app.getLoginItemSettings().openAtLogin; },
    async enable() { const app = await getApp(); app.setLoginItemSettings({ openAtLogin: true, openAsHidden: opts.openAsHidden ?? true, args: opts.args ?? ["--lumina-autostart"] }); },
    async disable() { const app = await getApp(); app.setLoginItemSettings({ openAtLogin: false }); },
  };
}

export async function setAutostart(enabled: boolean, backend: AutostartBackend): Promise<boolean> {
  if (enabled) await backend.enable(); else await backend.disable();
  return backend.isEnabled();
}
