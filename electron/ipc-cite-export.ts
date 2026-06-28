// electron/ipc-cite-export.ts
// New IPC: cite:export — writes .ris/.bib for one or many papers via the OS save dialog.
// Register inside electron/ipc.ts. Renderer calls bridge.exportCitation(items, fmt).
import { ipcMain, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { citeFile, citeFileBatch, type CiteFormat, type CiteInput } from "../src/core/cite/export.ts";

export function registerCiteExport(){
  ipcMain.handle('cite:export', async (_e, items:CiteInput[], fmt:CiteFormat)=>{
    try{
      const list = Array.isArray(items) ? items : [items];
      const out  = list.length>1 ? citeFileBatch(list,fmt) : citeFile(list[0],fmt);
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: out.name,
        filters:[ fmt==='ris' ? { name:'RIS', extensions:['ris'] } : { name:'BibTeX', extensions:['bib'] } ]
      });
      if(canceled || !filePath) return { ok:false, reason:'canceled' };
      await writeFile(filePath, out.text, 'utf8');
      return { ok:true, path:filePath, count:list.length };
    }catch(err:any){
      return { ok:false, reason:String((err && err.message) || err) };
    }
  });
}
