#!/usr/bin/env node
// 结构级验证 · patch settings（纯渲染层；复用引擎既有 settings:get/save + secrets:set）。
// JSX 计括号。真实持久化/钥匙串写入/主题视觉须真机确认。
import fs from "node:fs"; import path from "node:path";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}

console.log("\n— 1. 文件与前置（themes.js + 壳）—");
exists("src/ui/modules/Settings.jsx")?ok("Settings.jsx 新增"):bad("缺 Settings.jsx");
exists("src/ui/LuminaApp.jsx")?ok("LuminaApp.jsx 在"):bad("缺 LuminaApp.jsx");
if(exists("src/ui/themes.js")){ const s=read("src/ui/themes.js"); /THEMES/.test(s)&&/isLight/.test(s)?ok("themes.js（THEMES + isLight）在"):bad("themes.js 缺导出"); } else bad("缺 themes.js");

console.log("\n— 2. 语法/平衡 —");
["src/ui/modules/Settings.jsx","src/ui/LuminaApp.jsx"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡"); });

console.log("\n— 3. 大模型配置（provider/model/baseURL/key）—");
if(exists("src/ui/modules/Settings.jsx")){ const s=read("src/ui/modules/Settings.jsx");
  /deepseek/.test(s)&&/anthropic/.test(s)&&/openai/.test(s)&&/moonshot/.test(s)&&/ollama/.test(s)&&/custom/.test(s)?ok("六提供方（DeepSeek 默认 + Claude/OpenAI/Kimi/Ollama/自定义）"):bad("提供方不全");
  (/saveSettings/.test(s) || /persistSettings/.test(s) || /persistLlmFields/.test(s))?ok("保存 llm 配置（persistSettings / persistLlmFields）"):bad("未保存 llm");
  /baseUrl/.test(s)?ok("自定义/Ollama baseURL"):wn("未见 baseUrl");
}

console.log("\n— 4. 密钥仅入钥匙串（红线3）—");
if(exists("src/ui/modules/Settings.jsx")){ const s=read("src/ui/modules/Settings.jsx");
  /setSecret\(/.test(s)&&/_key/.test(s)?ok("密钥 → bridge.setSecret(`${provider}_key`)"):bad("未经 setSecret 写钥匙串");
  /type="password"/.test(s)?ok("密钥输入 password、不回显"):wn("密钥未用 password");
  // 关键：llm 配置对象不得包含密钥
  const m=s.match(/const llm = \{[^}]*\}/);
  (m && !/key/i.test(m[0]))?ok("llm 配置对象不含密钥（绝不写入 settings/配置）"):bad("llm 配置疑似含密钥");
  !/getSecret|readSecret/.test(s)?ok("不读回密钥"):wn("出现读密钥调用");
}

console.log("\n— 5. 主题切换 + 通用 —");
if(exists("src/ui/modules/Settings.jsx")){ const s=read("src/ui/modules/Settings.jsx");
  /THEMES\.map/.test(s)&&/onTheme/.test(s)?ok("主题选择器（点选即时 + 持久化）"):bad("缺主题选择器");
  /notifications/.test(s)?ok("通知开关"):wn("缺通知开关");
  /contactEmail/.test(s)?ok("联系邮箱"):wn("缺联系邮箱");
  /hasBackend|backend/.test(s)?ok("无后端提示（原型不持久化）"):wn("未提示无后端");
}

console.log("\n— 6. 壳接线（LuminaApp）—");
if(exists("src/ui/LuminaApp.jsx")){ const s=read("src/ui/LuminaApp.jsx");
  /import Settings from/.test(s)?ok("引入 Settings 模块"):bad("未引入 Settings");
  /mode === "settings"/.test(s)?ok("渲染 Settings（settings 视图）"):bad("未渲染 Settings");
  /data-theme=\{theme\}/.test(s)&&/isLight\(theme\)/.test(s)?ok("主题状态驱动 data-theme + 亮/暗基底"):bad("主题未接状态");
  /onTheme/.test(s)&&/saveSettings/.test(s)?ok("onTheme 即时应用 + 持久化"):bad("onTheme 未持久化");
  /SettingsIcon/.test(s)?ok("设置入口（gear）"):wn("未见设置入口");
}

console.log("\n— 7. 范围守护 —");
let leak=false; const s=exists("src/ui/modules/Settings.jsx")?read("src/ui/modules/Settings.jsx"):"";
["跨文档","全库","related-papers","代写","screening","facet"].forEach((b)=>{ if(s.includes(b)){bad(`含越界项 "${b}"`);leak=true;} });
if(!leak) ok("无越界（仅 provider/主题/通用；密钥进钥匙串）");

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：真实设置持久化、密钥写入系统钥匙串、各 provider 连通、主题视觉与亮/暗切换须真机确认。\n`));
process.exit(fail?1:0);
