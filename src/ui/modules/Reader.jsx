// Lumina Feed · 阅读器工作台 (Reader workbench) —— 累积：reader_p1a/b · p2 · p3 · reader_plus · finish
// 渲染内核 + 导航/书签 + 缩放(预设:实际大小/适配宽度/适配整页) + 旋转 + 单页/连续/双页 + 缩略图(IO 懒渲染) + 专注 + 下载。
// 真实文本层(可选择) + 页内查找 + 大纲目录 + 划词解释/翻译/带页码问答/多色批注 + 截取读图 + 证据/推断分析。
// 续读位置(按 docKey) · 键盘快捷键 · 夜读反色 · 抓手平移。真实 PDF 渲染/文本层/选择/查找/各交互仅真机可验。
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ArrowLeft, X, PanelLeft, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Minus, Plus, Maximize, RotateCw, RotateCcw, Expand, Download, Search, Sparkles, Send, Languages, Copy, RefreshCw, List, Images, Highlighter, StickyNote, Crop, Trash2, FileDown, Loader, AlertTriangle, Square, Rows3, Columns2, Shield, Info, Layers, Lightbulb, Eye, Ban, Target, Scale, FlaskConical, ListChecks, Link2, Check, Quote, Bookmark, Workflow, Map, Moon, Hand, ScanLine, Undo2, Redo2 } from "lucide-react";
import { openPdf, getOutline, getPageStrings, renderTextLayer, destToPageNumber, fitWidthScale, getDocPages, splitCites, renderRegion } from "../pdf-engine.js";
import { bridge } from "../lumina-bridge.js";
import { persistSettings } from "../settings-persist.js";
import { exportAnnotatedPdf, exportNotesMarkdown } from "../pdf-export.js";
import { captureTextSelection } from "../reader-selection.js";
import { setReaderContextHost, shouldReaderHandleContextTarget } from "../reader-context-host.js";
import ReaderContextMenu from "../components/ReaderContextMenu.jsx";

const READER_CSS = `
/* ── reader_plus 双车道（证据=gold/已四主题派生；推断=amber 此处派生明/暗） ── */
.rd{--amber:#BE7A18;--amberDim:#9A5F12;--amberTint:rgba(190,122,24,.10);--amberLine:rgba(190,122,24,.34)}
.lf:not(.day) .rd{--amber:#E0A75C;--amberDim:#C98A3C;--amberTint:rgba(224,167,92,.16);--amberLine:rgba(224,167,92,.42)}
.rd-zones{display:flex;gap:4px;position:sticky;top:-14px;background:var(--surf);z-index:2;padding:6px 0;margin:-4px 0 4px;border-bottom:1px solid var(--line)}
.rd-zone{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid transparent;background:transparent;color:var(--ink3);border-radius:8px;padding:6px 4px;font-size:11.5px;cursor:pointer;font-family:inherit}
.rd-zone:hover{background:var(--surf2);color:var(--ink)}
.rd-zone.on{background:var(--gold);color:#fff}
.rd-zone.inf.on{background:var(--amber);color:#fff}
.rd-zonebody{display:flex;flex-direction:column;gap:13px}
.rd-lane{display:flex;align-items:center;gap:7px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink4)}
.rd-lane>svg{color:var(--gold);flex-shrink:0}
.rd-lane.inf>svg{color:var(--amber)}
/* ── 阅读理解可视化（结构图 / 逻辑流程图） ── */
.rd-vtoggle{display:inline-flex;gap:3px;margin:9px 0 8px;background:var(--surf2);border:1px solid var(--line);border-radius:9px;padding:3px}
.rd-vtab{display:inline-flex;align-items:center;gap:5px;border:none;background:transparent;color:var(--ink3);border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.rd-vtab.on{background:var(--gold);color:#fff}
.rd-smap{display:flex;flex-direction:column;align-items:stretch;gap:0}
.rd-snode{display:flex;align-items:baseline;flex-wrap:wrap;gap:7px;border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:11px;background:var(--surf);padding:10px 12px}
.rd-stag{flex-shrink:0;color:#fff;font-size:11px;font-weight:600;border-radius:6px;padding:2px 8px}
.rd-stext{flex:1;min-width:150px;font-size:12.5px;line-height:1.6;color:var(--ink)}
.rd-spages{display:inline-flex;gap:4px;flex-wrap:wrap}
.rd-sarrow{display:flex;justify-content:center;color:var(--ink4);margin:1px 0}
.rd-gcard{border:1px solid var(--line);border-radius:12px;background:var(--surf);padding:11px;overflow:hidden}
.rd-gcard.inf{border-left:4px solid var(--amber)}
.rd-gframing{font-size:11.5px;color:var(--ink3);line-height:1.6;background:var(--amberTint);border-radius:8px;padding:8px 10px;margin:8px 0}
.rd-graph{display:block;max-width:100%;margin:4px auto;overflow:visible}
.rd-graph .rd-gnode rect{stroke-width:1.6;transition:stroke-width .12s}
.rd-graph .rd-gnode:hover rect{stroke-width:2.6}
.rd-gtext{fill:var(--ink);font-size:11px;font-family:inherit}
.rd-graph .rd-gnode.ng .rd-gtext{fill:var(--ink4)}
.rd-gpage{font-size:9px;font-family:'Space Mono',monospace;font-weight:600}
.rd-gedge{fill:none;stroke:var(--ink4);stroke-width:1.5;opacity:.5}
.rd-glabelbg{fill:var(--surf);opacity:.9}
.rd-glabel{fill:var(--ink3);font-size:9.5px;font-family:inherit}
.rd-gexport{display:inline-flex;align-items:center;gap:5px;margin-top:9px;border:1px solid var(--line2);background:var(--surf2);color:var(--ink2);border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.rd-gexport:hover{border-color:var(--gold)}
.rd-flowtool{display:flex;flex-direction:column;gap:9px}
.rd-scaffold{font-size:12px;color:var(--ink3);line-height:1.65;border:1px dashed var(--line2);border-radius:10px;padding:11px;background:var(--surf2)}
.ev-card{border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:11px;background:var(--surf);overflow:hidden}
.ev-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:9px 11px;border-bottom:1px solid var(--line);font-size:12.5px;font-weight:600;color:var(--ink)}
.ev-top>svg{color:var(--gold);flex-shrink:0}
.ev-title{flex:1 1 7em;min-width:6em;line-height:1.4;word-break:break-word}
.ev-empty{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.6;color:var(--ink3);padding:11px}
.ev-empty>svg{color:var(--amber);flex-shrink:0;margin-top:1px}
.ev-note{display:flex;gap:7px;align-items:flex-start;font-size:11px;line-height:1.55;color:var(--ink2);background:rgba(14,124,111,.06);border-top:1px solid var(--line2);padding:8px 11px}
.ev-note>svg{color:var(--gold);flex-shrink:0;margin-top:1px}
.ev-note b{color:var(--goldDim);font-weight:600}
.ev-more{display:flex;align-items:center;justify-content:center;gap:5px;width:100%;border:none;border-top:1px solid var(--line2);background:var(--surf2);color:var(--goldDim);padding:8px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit}
.ev-more:hover{background:rgba(14,124,111,.08)}
.gbadge{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-family:'Space Mono',monospace;font-size:9px;color:var(--goldDim);background:rgba(14,124,111,.10);border:1px solid rgba(14,124,111,.30);border-radius:5px;padding:1px 6px;white-space:nowrap}
.ibadge{display:inline-flex;align-items:center;gap:4px;font-family:'Space Mono',monospace;font-size:9px;color:var(--amberDim);background:var(--amberTint);border:1px solid var(--amberLine);border-radius:5px;padding:1px 6px;white-space:nowrap}
.ev-claim{display:flex;flex-direction:column;gap:5px;padding:9px 11px;border-bottom:1px solid var(--line2);font-size:12.5px;line-height:1.6;color:var(--ink)}
.ev-claim:last-child{border-bottom:none}
.ev-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.evtype{font-family:'Space Mono',monospace;font-size:9px;border-radius:5px;padding:1px 6px;border:1px solid var(--line2);color:var(--ink3)}
.framing{display:flex;gap:7px;align-items:flex-start;font-size:11px;line-height:1.55;color:var(--ink2);background:var(--surf2);border-radius:8px;padding:8px 10px}
.framing>svg{color:var(--gold);flex-shrink:0;margin-top:1px}
.inf-pane{background:linear-gradient(180deg,var(--amberTint),transparent);border-radius:11px;padding:11px;margin:0}
.inf-banner{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--amberLine);background:var(--amberTint);border-radius:10px;padding:10px 11px;font-size:11.5px;line-height:1.55;color:var(--ink)}
.inf-banner>svg{color:var(--amber);flex-shrink:0;margin-top:1px}
.inf-banner b{color:var(--amberDim)}
.inf-card{border:1px dashed var(--amberLine);border-left:4px solid var(--amber);background:var(--amberTint);border-radius:11px;overflow:hidden}
.inf-h{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:10px 11px;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--ink)}
.inf-h>svg.t{color:var(--amberDim);flex-shrink:0}
.inf-title{flex:1 1 7em;min-width:6.5em;line-height:1.4;word-break:break-word}
.inf-h .chev{transition:transform .15s;color:var(--amberDim);flex:0 0 auto}
.inf-card.open .inf-h .chev{transform:rotate(180deg)}
.inf-body{display:none;padding:0 11px 11px;font-size:12.5px;line-height:1.65;color:var(--ink);flex-direction:column;gap:9px}
.inf-card.open .inf-body{display:flex}
.conf{display:inline-flex;align-items:center;gap:4px;font-size:10px;border-radius:6px;padding:1px 7px;white-space:nowrap}
.conf.c1{color:var(--amberDim);background:rgba(190,122,24,.12);border:1px solid var(--amberLine)}
.conf.c2{color:var(--amberDim);background:transparent;border:1px dashed var(--amber)}
.conf.c3{color:var(--ink3);background:var(--surf2);border:1px solid var(--line2)}
.refuse{display:flex;gap:9px;align-items:flex-start;border:1px solid var(--amberLine);background:var(--amberTint);border-radius:10px;padding:11px;font-size:12px;line-height:1.6;color:var(--ink)}
.refuse>svg{color:var(--amber);flex-shrink:0;margin-top:1px}
.rd-pcite{display:inline-flex;align-items:center;gap:2px;font-family:'Space Mono',monospace;font-size:10px;border:1px solid rgba(14,124,111,.30);background:rgba(14,124,111,.08);color:var(--goldDim);border-radius:6px;padding:1px 6px;cursor:pointer}
.rd-pcite:hover{background:rgba(14,124,111,.16)}
.rd-tools{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.rd-tool{position:relative;display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;border:1px solid var(--line2);background:var(--surf);color:var(--ink);border-radius:9px;padding:8px 9px;cursor:pointer;font-family:inherit}
.rd-tool:hover{border-color:var(--gold);background:var(--surf2)}
.rd-tool:disabled{opacity:.55;cursor:default}
.rd-tool.rec{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
.rd-toolname{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600}
.rd-toolname svg{color:var(--gold);flex-shrink:0}
.rd-tooldesc{font-size:10.5px;color:var(--ink3);line-height:1.4}
.rd-toolrec{position:absolute;top:6px;right:6px;font-family:'Space Mono',monospace;font-size:8px;color:#fff;background:var(--gold);border-radius:4px;padding:0 4px}
.rd-purpose{display:flex;flex-wrap:wrap;gap:6px}
.rd-pchip{border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:14px;padding:4px 11px;font-size:11.5px;cursor:pointer;font-family:inherit}
.rd-pchip:hover{border-color:var(--gold);color:var(--gold)}
.rd-pchip.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.rd-phint{font-size:11px;color:var(--goldDim);background:rgba(14,124,111,.07);border:1px solid rgba(14,124,111,.20);border-radius:8px;padding:7px 9px;line-height:1.5}
.rd-swipe-save{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--gold);background:rgba(14,124,111,.08);color:var(--goldDim);border-radius:9px;padding:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;width:100%}
.rd-swipe-save:hover{background:rgba(14,124,111,.14)}
.rd-swipe{border-top:1px solid var(--line);margin-top:4px;padding-top:10px;display:flex;flex-direction:column;gap:7px}
.rd-swipe-h{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink3);font-family:'Space Mono',monospace}
.rd-swipe-item{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;color:var(--ink2);background:var(--surf2);border:1px solid var(--line2);border-radius:8px;padding:7px 9px;line-height:1.5}
.rd-swipe-item .x{margin-left:auto;border:none;background:transparent;color:var(--ink4);cursor:pointer;flex-shrink:0;padding:0;display:grid;place-items:center}
.rd-swipe-item .x:hover{color:var(--danger,#c0584e)}
.inf-pane .inf-card{margin-top:10px}
.inf-h .inf-right{flex:0 0 auto;margin-left:auto;display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px 7px}
.inf-h .inf-right .chev{margin-left:0}
.guess-box{display:flex;flex-direction:column;gap:7px}
.guess-box .gq{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--amberDim)}
.guess-box .gqsub{font-size:11px;color:var(--ink3);line-height:1.5}
.guess-box textarea{border:1px solid var(--line2);border-radius:8px;background:var(--surf);color:var(--ink);font-family:inherit;font-size:12px;padding:7px;min-height:54px;resize:vertical;outline:none}
.guess-box textarea:focus{border-color:var(--amberLine)}
.reveal-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--amberLine);background:var(--amberTint);color:var(--amberDim);border-radius:8px;padding:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.reveal-btn:hover{background:color-mix(in srgb,var(--amber) 16%,transparent)}
.reveal-btn:disabled{opacity:.6;cursor:default}
.rd{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--surf2);z-index:30}
.rd-topbar{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--surf);border-bottom:1px solid var(--line);flex-shrink:0}
.rd-back{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:9px;padding:7px 11px;font-size:12.5px;cursor:pointer;font-family:inherit}
.rd-back:hover{border-color:var(--gold);color:var(--gold)}
.rd-name{flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-x{border:none;background:transparent;color:var(--ink3);cursor:pointer;display:grid;place-items:center;padding:4px;border-radius:7px}
.rd-x:hover{background:var(--surf2);color:var(--ink)}
.rd-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 14px;background:var(--surf);border-bottom:1px solid var(--line);overflow:visible;position:relative;z-index:5;flex-shrink:0}
.rd-grp{display:inline-flex;align-items:center;gap:4px;padding-right:8px;border-right:1px solid var(--line)}
.rd-grp:last-child{border-right:none}
.rd-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid transparent;background:transparent;color:var(--ink2);border-radius:8px;padding:6px 9px;font-size:12px;cursor:pointer;font-family:inherit}
.rd-btn:hover{background:var(--surf2);color:var(--ink)}
.rd-btn.on{background:var(--gold);color:#fff}
.rd-btn:disabled{opacity:.4;cursor:default}
.rd-seg{display:inline-flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden}
.rd-seg button{border:none;background:transparent;color:var(--ink2);padding:6px 9px;font-size:12px;cursor:pointer;font-family:inherit;border-right:1px solid var(--line2);display:inline-flex;align-items:center;gap:5px}
.rd-seg button:last-child{border-right:none}
.rd-seg button.on{background:var(--gold);color:#fff}
.rd-pageind{display:inline-flex;align-items:center;gap:6px;font-family:'Space Mono',monospace;font-size:12px;color:var(--ink2)}
.rd-pageind input{width:42px;text-align:center;border:1px solid var(--line2);border-radius:6px;padding:4px;font-family:inherit;font-size:12px;background:var(--surf);color:var(--ink)}
.rd-hint{display:inline-flex;align-items:center;font-size:11.5px;color:var(--ink3);font-family:inherit;white-space:nowrap;line-height:1}
.rd-find{display:flex;align-items:center;gap:8px;padding:7px 14px;background:var(--surf);border-bottom:1px solid var(--line);flex-shrink:0}
.rd-find svg{color:var(--ink3)}
.rd-find input{flex:1;border:1px solid var(--line2);border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;background:var(--surf);color:var(--ink);outline:none}
.rd-find input:focus{border-color:var(--gold)}
.rd-fcount{font-family:'Space Mono',monospace;font-size:12px;color:var(--ink3);min-width:50px;text-align:center}
.rd-body{flex:1;min-height:0;display:flex;overflow:hidden}
.rd-side{flex-shrink:0;border-right:1px solid var(--line);background:var(--surf);display:flex;flex-direction:row;overflow:hidden}
.rd-rail{width:46px;flex-shrink:0;display:flex;flex-direction:column;gap:6px;padding:9px 6px;border-right:1px solid var(--line2);background:var(--surf2)}
.rd-railbtn{width:34px;height:34px;display:grid;place-items:center;border:1px solid transparent;background:transparent;color:var(--ink3);border-radius:8px;cursor:pointer}
.rd-railbtn:hover{background:var(--surf);color:var(--ink)}
.rd-railbtn.on{background:var(--gold);color:#fff}
.rd-sidepanel{flex:1;min-width:0;display:flex;flex-direction:column;position:relative;overflow:hidden}
.rd-sidehead{display:flex;align-items:center;justify-content:space-between;padding:9px 10px 7px;font-family:'Source Serif 4',Georgia,serif;font-size:13px;font-weight:600;color:var(--ink);border-bottom:1px solid var(--line2)}
.rd-sidehead .rd-x{border:none;background:transparent;color:var(--ink3);cursor:pointer;display:inline-flex;border-radius:6px;padding:2px}
.rd-sidehead .rd-x:hover{background:var(--surf2);color:var(--ink)}
.rd-sidebody{flex:1;min-height:0;overflow-y:auto;padding:10px}
.rd-resize{position:absolute;top:0;right:0;bottom:0;width:6px;cursor:col-resize;background:transparent}
.rd-resize:hover{background:color-mix(in srgb,var(--gold) 32%,transparent)}
.rd-marks{display:flex;flex-direction:column;gap:6px}
.rd-mark{display:flex;align-items:center;gap:7px;border:1px solid var(--line2);background:var(--surf2);border-radius:8px;padding:7px 9px;cursor:pointer;font-size:12.5px;color:var(--ink2)}
.rd-mark:hover{border-color:var(--gold);color:var(--gold)}
.rd-mark.active{border-color:var(--gold);color:var(--gold)}
.rd-mark-rm{margin-left:auto;border:none;background:transparent;color:var(--ink4);cursor:pointer;display:inline-flex;border-radius:5px;padding:2px}
.rd-mark-rm:hover{color:var(--danger,#c0392b)}
.rd-mark-add{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px dashed var(--line2);background:transparent;color:var(--ink2);border-radius:8px;padding:8px;font-size:12px;cursor:pointer;font-family:inherit;margin-top:2px}
.rd-mark-add:not(:disabled):hover{border-color:var(--gold);color:var(--gold)}
.rd-mark-add:disabled{opacity:.55;cursor:default}
.rd-marks-empty{font-size:11.5px;color:var(--ink4);text-align:center;padding:14px 6px;line-height:1.6}
.rd-sidetabs{display:flex;gap:4px;position:sticky;top:-10px;background:var(--surf);padding-top:2px;z-index:1}
.rd-sidetabs button{flex:1;border:1px solid var(--line2);background:var(--surf2);color:var(--ink2);border-radius:8px;padding:5px;font-size:11.5px;cursor:pointer;font-family:inherit}
.rd-sidetabs button.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.rd-thumbs{display:flex;flex-direction:column;gap:12px}
.rd-thumb{cursor:pointer;border:2px solid transparent;border-radius:8px;padding:4px;display:flex;flex-direction:column;align-items:center;gap:4px;background:var(--surf2)}
.rd-thumb:hover{border-color:var(--line2)}
.rd-thumb.active{border-color:var(--gold)}
.rd-thumb canvas{width:100%;height:auto;box-shadow:0 1px 4px rgba(0,0,0,.12);background:#fff}
.rd-thumb-c{width:100%;min-height:150px;display:flex;align-items:center;justify-content:center}
.rd-thumb span{font-family:'Space Mono',monospace;font-size:10px;color:var(--ink3)}
.rd-tree{display:flex;flex-direction:column;gap:1px}
.rd-trow{display:flex;align-items:flex-start;gap:2px}
.rd-ttog{border:none;background:transparent;color:var(--ink3);cursor:pointer;font-size:10px;padding:3px 2px 0;line-height:1.4;flex-shrink:0;width:14px}
.rd-tdot{color:var(--ink4);width:14px;flex-shrink:0;text-align:center;font-size:11px;line-height:1.7}
.rd-tlabel{border:none;background:transparent;color:var(--ink2);cursor:pointer;font-size:12px;text-align:left;line-height:1.45;padding:3px 4px;border-radius:6px;font-family:inherit;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rd-tlabel:hover{background:var(--surf2);color:var(--gold)}
.rd-empty2{font-size:12px;color:var(--ink4);padding:10px 6px;line-height:1.6}
.rd-view{flex:1;min-width:0;overflow:auto;padding:22px;display:flex;flex-direction:column;align-items:center;gap:20px;background:var(--surf2)}
.rd-spread{display:flex;gap:16px;justify-content:center}
.rd-pg{position:relative;box-shadow:0 4px 18px rgba(0,0,0,.14);background:#fff;line-height:0}
.rd-pg canvas{display:block}
.textLayer{position:absolute;inset:0;overflow:clip;opacity:1;line-height:1;text-align:initial;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;z-index:2;caret-color:CanvasText}
.textLayer span,.textLayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0}
.textLayer span.markedContent{top:0;height:0}
.textLayer ::selection{background:rgba(14,124,111,.35)}
.textLayer mark.lf-fh{background:rgba(245,177,66,.42);color:transparent;border-radius:1px}
.textLayer mark.lf-fh-cur{background:rgba(245,158,11,.85)}
.rd-loading,.rd-err{margin:auto;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--ink3);font-size:13.5px}
.rd-loading svg,.rd-err svg{color:var(--gold)}
.rd-spin{animation:rdspin 1s linear infinite}
@keyframes rdspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){
  .rd-spin{animation:none}
  .inf-h .chev,.rd-tool,.rd-pchip,.reveal-btn,.rd-swipe-save,.rd-zone,.rd-btn,.rd-pop button,.rd-cite{transition:none !important}
}
.rd.focus .rd-side{display:none}
.rd.focus .rd-topbar{opacity:.55}
.rd.focus .rd-topbar:hover{opacity:1}
.rd-ai{width:340px;flex-shrink:0;border-left:1px solid var(--line);background:var(--surf);overflow-y:auto;display:flex;flex-direction:column;gap:16px;padding:14px}
.rd-ai-h{display:flex;align-items:center;gap:7px;font-family:'Source Serif 4',Georgia,serif;font-size:15px;font-weight:600;color:var(--ink)}
.rd-ai-h svg{color:var(--gold)}
.rd-ai-sec{display:flex;flex-direction:column;gap:10px}
.rd-ai-act{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--gold);background:rgba(14,124,111,.08);color:var(--goldDim);border-radius:10px;padding:9px 12px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.rd-ai-act:hover{background:rgba(14,124,111,.14)}
.rd-ai-act:disabled{opacity:.6;cursor:default}
.rd-ai-card{border:1px solid var(--line);border-radius:11px;padding:12px;background:var(--surf2)}
.rd-ai-meta{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.rd-basis{font-size:10.5px;font-family:'Space Mono',monospace;color:var(--ink3);background:var(--surf);border:1px solid var(--line);border-radius:6px;padding:2px 7px}
.rd-basis.ft{color:var(--gold);border-color:rgba(14,124,111,.3);background:rgba(14,124,111,.08)}
.rd-gr{font-size:10.5px;font-family:'Space Mono',monospace;color:var(--ink3)}
.rd-ai-banner{font-size:11.5px;color:#9a6b2e;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:7px;padding:6px 9px;margin-bottom:6px;line-height:1.5}
.rd-ai-body{font-size:13px;line-height:1.7;color:var(--ink)}
.rd-md{display:flex;flex-direction:column;gap:1px}
.rd-md-h{font-weight:700;font-size:12.5px;color:var(--gold);margin:9px 0 2px;letter-spacing:.01em;display:flex;align-items:center;gap:6px}
.rd-md-h::before{content:"";width:3px;height:0.95em;background:var(--gold);border-radius:2px;flex:0 0 auto}
.rd-md .rd-md-h:first-child{margin-top:0}
.rd-md-p{margin:0}
.rd-md-p strong{font-weight:700;color:var(--ink)}
.rd-md-gap{height:6px}
.rd-ai-label{font-size:11.5px;color:var(--ink3);line-height:1.5}
.rd-ai-presets{display:flex;flex-wrap:wrap;gap:6px}
.rd-ai-chip{border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:8px;padding:5px 9px;font-size:11.5px;cursor:pointer;font-family:inherit}
.rd-ai-chip:hover{border-color:var(--gold);color:var(--gold)}
.rd-ai-chip:disabled{opacity:.5;cursor:default}
.rd-ai-flow{display:flex;flex-direction:column;gap:12px}
.rd-ai-qa{display:flex;flex-direction:column;gap:5px}
.rd-ai-q{font-size:12.5px;font-weight:600;color:var(--ink);background:var(--surf2);border-radius:8px;padding:7px 10px}
.rd-ai-a{font-size:13px;line-height:1.7;color:var(--ink);padding:2px 2px 0}
.rd-ai-load{display:inline-flex;align-items:center;gap:6px;color:var(--ink3);font-size:12.5px}
.rd-ai-input{display:flex;gap:6px;position:sticky;bottom:0;background:var(--surf);padding-top:6px}
.rd-ai-input input{flex:1;border:1px solid var(--line2);border-radius:9px;padding:8px 10px;font-size:12.5px;font-family:inherit;background:var(--surf);color:var(--ink);outline:none}
.rd-ai-input input:focus{border-color:var(--gold)}
.rd-ai-send{border:none;background:var(--gold);color:#fff;border-radius:9px;padding:0 12px;cursor:pointer;display:grid;place-items:center}
.rd-ai-send:disabled{opacity:.5;cursor:default}
.lf-cite{display:inline;border:none;background:rgba(14,124,111,.12);color:var(--gold);border-radius:5px;padding:0 5px;margin:0 1px;font-family:'Space Mono',monospace;font-size:11px;cursor:pointer}
.lf-cite:hover{background:var(--gold);color:#fff}
.rd.focus .rd-ai{display:none}
.rd-pop{position:absolute;transform:translate(-50%,calc(-100% - 8px));z-index:40;width:max-content;max-width:min(480px,calc(100vw - 24px))}
.rd-pop-bar{display:flex;flex-wrap:nowrap;align-items:center;gap:2px;background:var(--ink);border-radius:9px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.28);overflow-x:auto;scrollbar-width:none}
.rd-pop-bar::-webkit-scrollbar{display:none}
.rd-pop-bar button{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:#fff;border-radius:6px;padding:6px 8px;font-size:11.5px;white-space:nowrap;flex-shrink:0;cursor:pointer;font-family:inherit;line-height:1.2}
.rd-pop-bar button:hover{background:rgba(255,255,255,.16)}
.rd-pop-tr{margin-top:6px;background:var(--surf);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:12.5px;line-height:1.6;color:var(--ink);box-shadow:0 6px 20px rgba(0,0,0,.16);max-height:200px;overflow:auto;white-space:pre-wrap}
.rd-tmenu{position:absolute;top:calc(100% + 4px);left:0;background:var(--surf);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:4px;display:flex;flex-direction:column;gap:2px;z-index:20;min-width:124px}
.rd-tmenu button{border:none;background:transparent;color:var(--ink2);text-align:left;padding:7px 11px;font-size:12.5px;border-radius:7px;cursor:pointer;font-family:inherit}
.rd-tmenu button:hover{background:var(--surf2);color:var(--gold)}
.rd-trwrap{position:relative;display:inline-flex;align-items:center}
.rd-tp-cache{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0 2px}
.rd-tp-cached{font-family:'Space Mono',monospace;font-size:10px;color:var(--ink3)}
.rd-tp-cached.fresh{color:var(--ink4)}
.rd-tp-warn{font-size:12px;color:var(--ink2);background:rgba(14,124,111,.07);border:1px solid rgba(14,124,111,.20);border-radius:8px;padding:8px 10px;line-height:1.55}
.rd-tp-rf{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:7px;padding:4px 9px;font-size:11px;cursor:pointer;font-family:inherit}
.rd-tp-rf:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.rd-tp-rf:disabled{opacity:.5;cursor:default}
.rd-tp{width:380px;flex-shrink:0;border-left:1px solid var(--line);background:var(--surf);overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:14px}
.rd-tp-h{display:flex;align-items:center;justify-content:space-between;font-family:'Source Serif 4',Georgia,serif;font-size:14px;font-weight:600;color:var(--ink)}
.rd-tp-h span{display:inline-flex;align-items:center;gap:6px}
.rd-tp-h svg{color:var(--gold)}
.rd-tp-modes{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}
.rd-tp-modes button{flex:1;border:none;background:transparent;color:var(--ink2);padding:6px 8px;font-size:12px;cursor:pointer;font-family:inherit;border-right:1px solid var(--line2)}
.rd-tp-modes button:last-child{border-right:none}
.rd-tp-modes button.on{background:var(--gold);color:#fff}
.rd-tp-all{align-self:flex-start;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.rd-tp-all:hover{border-color:var(--gold);color:var(--gold)}
.rd-tp-all:disabled{opacity:.6;cursor:default}
.rd-tp-body{font-size:13px;line-height:1.75;color:var(--ink)}
.rd-tp-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.rd-tp-orig{color:var(--ink3);white-space:pre-wrap}
.rd-tp-tr{color:var(--ink);white-space:pre-wrap}
.rd-tp-stack .rd-tp-orig{padding-bottom:8px;margin-bottom:8px;border-bottom:1px dashed var(--line2)}
.rd.focus .rd-tp{display:none}
.rd-hl{position:absolute;z-index:1;border-radius:2px;pointer-events:none;mix-blend-mode:multiply}
.hl-yellow{background:rgba(245,210,70,.5)}
.hl-green{background:rgba(120,220,120,.5)}
.hl-pink{background:rgba(255,150,180,.5)}
.hl-blue{background:rgba(120,170,255,.5)}
.rd-hlbtn{width:18px;height:18px;border:1px solid rgba(255,255,255,.5);border-radius:5px;cursor:pointer;padding:0}
.rd-pop-bar button.rd-hlbtn{padding:0;border:1px solid rgba(255,255,255,.65)}
.rd-pop-bar button.hl-yellow{background:rgba(245,210,70,.95)}
.rd-pop-bar button.hl-green{background:rgba(120,220,120,.95)}
.rd-pop-bar button.hl-pink{background:rgba(255,150,180,.95)}
.rd-pop-bar button.rd-hlbtn:hover{box-shadow:0 0 0 2px rgba(255,255,255,.45)}
.rd-pop-div{width:1px;height:18px;background:rgba(255,255,255,.25);margin:0 2px;align-self:center}
.rd-snip{position:absolute;z-index:45;border:1.5px dashed var(--gold);background:rgba(14,124,111,.12);pointer-events:none}
.rd-view.snip{cursor:crosshair}
.rd-anno{width:340px;flex-shrink:0;border-left:1px solid var(--line);background:var(--surf);overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:14px}
.rd-anno-acts{display:flex;gap:6px;flex-wrap:wrap}
.rd-anno-acts button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.rd-anno-acts button:hover{border-color:var(--gold);color:var(--gold)}
.rd-anno-acts button:disabled{opacity:.5;cursor:default}
.rd-anno-list{display:flex;flex-direction:column;gap:10px}
.rd-anno-item{border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--surf2);display:flex;flex-direction:column;gap:7px}
.rd-anno-top{display:flex;align-items:center;gap:8px}
.rd-sw{width:14px;height:14px;border-radius:4px;flex-shrink:0}
.rd-anno-jump{border:none;background:transparent;color:var(--gold);font-family:'Space Mono',monospace;font-size:11px;cursor:pointer;padding:0}
.rd-anno-type{font-size:11px;color:var(--ink3);flex:1}
.rd-anno-del{border:none;background:transparent;color:var(--ink4);cursor:pointer;padding:2px;border-radius:6px}
.rd-anno-del:hover{color:#b42318;background:rgba(180,35,24,.08)}
.rd-anno-quote{font-size:12px;line-height:1.55;color:var(--ink2);border-left:2px solid var(--line2);padding-left:8px}
.rd-anno-note{width:100%;box-sizing:border-box;border:1px solid var(--line2);border-radius:8px;padding:7px 9px;font-size:12.5px;font-family:inherit;resize:vertical;min-height:38px;background:var(--surf);color:var(--ink);outline:none}
.rd-anno-note:focus{border-color:var(--gold)}
.rd.focus .rd-anno{display:none}
/* 夜读反色：仅反相页面 canvas（文本层透明、不受影响）；hue-rotate 让彩图回到接近原色 */
.rd.night .rd-pg canvas{filter:invert(1) hue-rotate(180deg)}
.rd.night .rd-view{background:#0e0f12}
/* 抓手平移：开启后页面区域为可抓取光标，拖动滚动 */
.rd-view.hand{cursor:grab}
.rd-view.hand.grabbing{cursor:grabbing}
.rd-view.hand .textLayer{pointer-events:none}
/* 缩放预设菜单（复用下拉观感） */
.rd-zoom-wrap{position:relative;display:flex;align-items:center}
.rd-zoom-btn{font-family:'Space Mono',monospace;font-size:12px;color:var(--ink2);min-width:48px;text-align:center;background:transparent;border:1px solid transparent;border-radius:7px;padding:3px 6px;cursor:pointer}
.rd-zoom-btn:hover{border-color:var(--line2);color:var(--gold)}
.rd-zoom-menu{position:absolute;top:calc(100% + 4px);left:50%;transform:translateX(-50%);background:var(--surf);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:4px;display:flex;flex-direction:column;gap:2px;z-index:21;min-width:132px}
.rd-zoom-menu button{display:flex;align-items:center;gap:8px;border:none;background:transparent;color:var(--ink2);text-align:left;padding:7px 10px;border-radius:7px;cursor:pointer;font-size:12.5px;font-family:inherit;white-space:nowrap}
.rd-zoom-menu button:hover{background:var(--surf2);color:var(--gold)}
`;

// 统计 q 在 str 中的出现次数（indexOf，避免正则 /g 状态坑）
function countOcc(str, q) {
  let n = 0, i = 0; const s = (str || "").toLowerCase();
  while ((i = s.indexOf(q, i)) !== -1) { n += 1; i += q.length; }
  return n;
}

// 在已渲染文本层 DOM 内包裹匹配项；curIdx = 当前匹配在本页的序号（标 cur 并滚入视野）
function applyHighlight(container, q, curIdx) {
  if (!container || !q) return;
  const spans = container.querySelectorAll("span");
  let k = 0;
  spans.forEach((span) => {
    const text = span.textContent || "";
    const low = text.toLowerCase();
    if (low.indexOf(q) === -1) return;
    const frag = document.createDocumentFragment();
    let last = 0, idx = low.indexOf(q, 0);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement("mark");
      mark.className = "lf-fh" + (k === curIdx ? " lf-fh-cur" : "");
      mark.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(mark);
      k += 1; last = idx + q.length; idx = low.indexOf(q, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    span.textContent = "";
    span.appendChild(frag);
  });
  if (curIdx != null && curIdx >= 0) {
    const cur = container.querySelector(".lf-fh-cur");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "center", inline: "nearest" });
  }
}

// 缩略图：仅 canvas（无需文本层）
function ThumbCanvas({ doc, pageNum, rotation }) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setShow(true); return; }
    const io = new IntersectionObserver((ents) => { for (const e of ents) { if (e.isIntersecting) { setShow(true); io.disconnect(); break; } } }, { rootMargin: "320px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!show || !doc || !ref.current) return;
    let task = null, cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled || !ref.current) return;
        const viewport = page.getViewport({ scale: 0.2, rotation });
        const canvas = ref.current; const ctx = canvas.getContext("2d");
        canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
        task = page.render({ canvasContext: ctx, viewport });
        await task.promise;
      } catch (e) { /* noop */ }
    })();
    return () => { cancelled = true; try { task && task.cancel && task.cancel(); } catch (e) { /* noop */ } };
  }, [doc, pageNum, rotation, show]);
  return <div ref={wrapRef} className="rd-thumb-c">{show ? <canvas ref={ref} /> : null}</div>;
}

// 单页：canvas + 文本层（可选择）+ 查找高亮
function PageView({ doc, pageNum, scale, rotation, find, curOnThisPage, annos }) {
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let task = null, cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale, rotation });
        const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        const canvas = canvasRef.current; const ctx = canvas.getContext("2d");
        canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = Math.floor(viewport.width) + "px"; canvas.style.height = Math.floor(viewport.height) + "px";
        const rc = { canvasContext: ctx, viewport };
        if (ratio !== 1) rc.transform = [ratio, 0, 0, ratio, 0, 0];
        task = page.render(rc); await task.promise;
      } catch (e) { /* noop */ }
    })();
    return () => { cancelled = true; try { task && task.cancel && task.cancel(); } catch (e) { /* noop */ } };
  }, [doc, pageNum, scale, rotation]);

  useEffect(() => {
    if (!doc || !textRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled || !textRef.current) return;
        const viewport = page.getViewport({ scale, rotation });
        await renderTextLayer(page, textRef.current, viewport);
        if (cancelled || !textRef.current) return;
        if (find && find.q) applyHighlight(textRef.current, find.q, curOnThisPage == null ? -1 : curOnThisPage);
      } catch (e) { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [doc, pageNum, scale, rotation, find, curOnThisPage]);

  return (
    <div className="rd-pg" data-page={pageNum}>
      <canvas ref={canvasRef} />
      <div className="textLayer" ref={textRef} />
      {(annos || []).map((a) => (a.rects || []).map((r, i) => (
        <div key={a.id + "-" + i} className={"rd-hl hl-" + a.color} title={a.note || a.anchoredText || ""}
          style={{ left: r.x * scale + "px", top: r.y * scale + "px", width: r.w * scale + "px", height: r.h * scale + "px" }} />
      )))}
    </div>
  );
}

// 大纲节点（递归）
function OutlineNode({ node, doc, onGoto, depth }) {
  const [open, setOpen] = useState(depth < 1);
  const has = node.items && node.items.length > 0;
  const go = async () => { const p = await destToPageNumber(doc, node.dest); if (p) onGoto(p); };
  return (
    <div>
      <div className="rd-trow" style={{ paddingLeft: depth * 12 + "px" }}>
        {has ? <button className="rd-ttog" onClick={() => setOpen((o) => !o)}>{open ? "▾" : "▸"}</button> : <span className="rd-tdot">·</span>}
        <button className="rd-tlabel" onClick={go} title={node.title}>{node.title || "(无标题)"}</button>
      </div>
      {has && open && node.items.map((c, i) => <OutlineNode key={i} node={c} doc={doc} onGoto={onGoto} depth={depth + 1} />)}
    </div>
  );
}
function OutlineTree({ items, doc, onGoto }) {
  if (!items || items.length === 0) return <div className="rd-empty2">此 PDF 无书签目录。</div>;
  return <div className="rd-tree">{items.map((n, i) => <OutlineNode key={i} node={n} doc={doc} onGoto={onGoto} depth={0} />)}</div>;
}

// 渲染带可点击页码引用 [p.X] 的文本（splitCites 把引用拆为片段；点击跳页）
// 行内渲染（纯函数，无 Hook）：把 **粗体** 与 [p.X] 混排成节点。修复总结里 **研究问题** 直接显示星号、不美观的问题。
function renderInline(text, onGoto, kp) {
  const nodes = [];
  const parts = splitCites(text || "");
  parts.forEach((part, i) => {
    if (part.t === "cite") { nodes.push(<button key={kp + "c" + i} className="lf-cite" onClick={() => onGoto && onGoto(part.v)} title={"跳到第 " + part.v + " 页"}>p.{part.v}↗</button>); return; }
    const seg = String(part.v); const re = /\*\*(.+?)\*\*/g; let last = 0, m, k = 0;
    while ((m = re.exec(seg)) !== null) {
      if (m.index > last) nodes.push(<span key={kp + "t" + i + "_" + k}>{seg.slice(last, m.index)}</span>);
      nodes.push(<strong key={kp + "b" + i + "_" + k}>{m[1]}</strong>);
      last = m.index + m[0].length; k++;
    }
    if (last < seg.length) nodes.push(<span key={kp + "e" + i}>{seg.slice(last)}</span>);
  });
  return nodes;
}
// 轻量 Markdown 渲染：整行 **标题** / ## 标题 → 段落小标题；其余行按行内规则渲染。结构化总结因此有层次、无裸星号。
function CiteText({ text, onGoto }) {
  const lines = String(text || "").split(/\n/);
  return (
    <div className="rd-md">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="rd-md-gap" />;
        const hm = /^\*\*(.+?)\*\*[:：]?$/.exec(t) || /^#{1,4}\s+(.+)$/.exec(t);
        if (hm) return <div key={i} className="rd-md-h">{hm[1].replace(/\*\*/g, "")}</div>;
        return <div key={i} className="rd-md-p">{renderInline(line, onGoto, "l" + i + "_")}</div>;
      })}
    </div>
  );
}

const PRESET_Q = ["这篇的主要发现是什么？", "用了什么研究方法？", "样本量与研究类型？", "结论有哪些局限？"];

// ── reader_plus 渲染原语：信封只按 lane 路由（HC-1），无手选颜色路径 ──
const EVTYPE = { internal_data: "内部数据", cites_others: "引用他人", author_inference: "作者推断" };
const PURPOSE_REC = { replicate: ["recipe", "repro"], cite: ["citerole", "cars"], critique: ["ledger", "falsify"], borrow: ["recipe"] };
const PURPOSE_HINT = { replicate: "已为「复现/设计」推荐：方法配方 + 可复现性清单。", cite: "已为「引为背景」推荐：引文角色 + 论证逻辑。", critique: "已为「批判性评估」推荐：claim 账本 + 可证伪边界；并建议看『推读』的硬核/保护带。", borrow: "已为「借方法/写法」推荐：方法配方；划词可提取写作观察。" };
const DEEP_TOOLS = [["cars", "论证逻辑", "作者如何论证选题（CARS）", Target], ["ledger", "claim 账本", "每条论断给了什么证据", Scale], ["recipe", "方法配方", "可复用的研究设计骨架", FlaskConical], ["repro", "可复现性", "对照 TRIPOD 清单核查", ListChecks], ["falsify", "可证伪边界", "什么观察会推翻它", Target], ["citerole", "引文角色", "每条引用起什么作用", Link2]];
function StatusIcon({ s }) {
  if (s === "ok") return <Check size={13} style={{ color: "var(--ok, #2e9e6b)", flexShrink: 0, marginTop: 2 }} />;
  if (s === "no") return <Ban size={13} style={{ color: "var(--danger, #c0584e)", flexShrink: 0, marginTop: 2 }} />;
  return <AlertTriangle size={13} style={{ color: "var(--amber)", flexShrink: 0, marginTop: 2 }} />;
}
function Cites({ refs, onGoto }) {
  if (!refs || !refs.length) return null;
  return <span className="ev-meta">{refs.map((pg, i) => <button key={i} className="rd-pcite" onClick={() => onGoto(pg)} title={"跳到第 " + pg + " 页"}>p.{pg}↗</button>)}</span>;
}
function ConfChip({ lvl }) {
  if (lvl === "c3") return <span className="conf c3"><Eye size={10} /> 单篇无法确证·仅供联想</span>;
  if (lvl === "c2") return <span className="conf c2"><Lightbulb size={10} /> 需外部佐证的推测</span>;
  return <span className="conf c1"><Lightbulb size={10} /> 文中有据的推断</span>;
}
const EV_PAGE_LEDGER = 12;
const EV_PAGE_CITER = 8;
const CITEROLE_UI_CAP = 20;
function EvidenceCard({ env, onGoto }) {
  const claims = env.claims || [];
  const pageSize = env.kind === "citerole" ? EV_PAGE_CITER : env.kind === "ledger" ? EV_PAGE_LEDGER : EV_PAGE_CITER;
  const [shown, setShown] = useState(pageSize);
  const isCite = env.kind === "citerole";
  const visible = claims.slice(0, shown);
  const remaining = claims.length - visible.length;
  return (
    <div className="ev-card">
      <div className="ev-top"><Layers size={14} /> <span className="ev-title">{env.title}</span><span className="gbadge"><Shield size={9} /> 接地·带页码</span></div>
      {env.framing && <div className="framing" style={{ margin: "9px 11px 0" }}><Info size={13} /><div>{env.framing}</div></div>}
      {isCite && <div className="ev-note"><Link2 size={12} /><div>这里是<b>正文里被讨论到的关键引用</b>各起什么作用（背景 / 方法 / 数据 / 对照…），最多展示 {CITEROLE_UI_CAP} 处，<b>不是完整参考文献表</b>。全部书目 → 在「我的文献」<b>导出到 Zotero</b>。</div></div>}
      {claims.length === 0
        ? <div className="ev-empty"><Info size={13} />未能从本篇正文提取到可标注页码的条目。可点上方按钮重试，或在设置里换更强的模型。</div>
        : <>
            {visible.map((c, i) => (
              <div key={i} className="ev-claim">
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>{c.status && <StatusIcon s={c.status} />}<span>{c.text}{c.flag === "needs_recheck" && <span className="evtype" style={{ marginLeft: 6, color: "var(--amberDim)", borderColor: "var(--amberLine)" }}>需核对</span>}</span></div>
                <div className="ev-meta">{c.evidenceType && <span className="evtype">{EVTYPE[c.evidenceType] || c.evidenceType}</span>}<Cites refs={c.pageRefs} onGoto={onGoto} /></div>
              </div>
            ))}
            {remaining > 0 && <button className="ev-more" onClick={() => setShown(claims.length)}><ChevronDown size={14} /> 显示其余 {remaining} 条（共 {claims.length} 条）</button>}
            {remaining <= 0 && claims.length > pageSize && <button className="ev-more" onClick={() => setShown(pageSize)}><ChevronUp size={14} /> 收起</button>}
          </>}
    </div>
  );
}
// 推断卡正文（车道内容：框定语 + 拒绝块 或 带把握度的 claim）——InfCard 与 InfAnalyzer 共用
function InfBody({ env, onGoto }) {
  if (!env) return null;
  return (
    <>
      {env.framing && <div className="framing"><Info size={13} /><div>{env.framing}</div></div>}
      {env.refused
        ? <div className="refuse"><Ban size={15} /><div>{env.refused.reason}</div></div>
        : env.claims.map((c, i) => (
          <div key={i} className="ev-claim" style={{ borderColor: "var(--amberLine)" }}>
            <div>{c.text}</div>
            <div className="ev-meta">{c.confidence && <ConfChip lvl={c.confidence} />}<Cites refs={c.pageRefs} onGoto={onGoto} /></div>
          </div>
        ))}
    </>
  );
}
function InfCard({ env, onGoto, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={"inf-card" + (open ? " open" : "")}>
      <div className="inf-h" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}><Lightbulb size={14} className="t" /> <span className="inf-title">{env.title}</span><span className="inf-right"><span className="ibadge">推断·非事实</span><span className="chev"><ChevronDown size={15} /></span></span></div>
      <div className="inf-body"><InfBody env={env} onGoto={onGoto} /></div>
    </div>
  );
}
const INF_TITLES = { hardcore: "硬核 / 保护带分解", limitations: "作者未言明的局限", genesis: "作者真实的发现过程", stats: "统计一致性扫描" };
const INF_CONF = { hardcore: "c1", limitations: "c2", genesis: "c3", stats: "c3" };
// 推断分析器卡：展开即运行（hardcore/genesis）；limitations 走练判断 gate——先写判断、揭示前不取/不渲染 AI 内容、揭示留痕（ADR-I4）。
function InfAnalyzer({ kind, ensurePages, source, onGoto, pushToast, practice }) {
  const [env, setEnv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [guess, setGuess] = useState("");
  const [revealed, setRevealed] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      const pages = await ensurePages();
      const e = await bridge.readerAnalyze(kind, pages);
      setEnv(e || null);
      if (!e) pushToast && pushToast("分析失败，请重试");
      if (e && kind !== "genesis" && source && source.paperId) bridge.readerAnalysisSave(source.paperId, e);
    } catch (err) { pushToast && pushToast("分析失败"); }
    finally { setBusy(false); }
  }, [kind, ensurePages, source, pushToast]);
  const onHeader = () => { const nx = !open; setOpen(nx); if (nx && !env && !busy && !practice) run(); };
  const reveal = () => { if (source && source.paperId) bridge.readerPracticeSave(source.paperId, kind, guess); setRevealed(true); run(); };
  return (
    <div className={"inf-card" + (open ? " open" : "")}>
      <div className="inf-h" role="button" tabIndex={0} aria-expanded={open} onClick={onHeader} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onHeader(); } }}><Lightbulb size={14} className="t" /> <span className="inf-title">{INF_TITLES[kind]}</span><span className="inf-right"><span className="ibadge">推断·非事实</span><ConfChip lvl={INF_CONF[kind]} /><span className="chev"><ChevronDown size={15} /></span></span></div>
      <div className="inf-body">
        {practice && !revealed ? (
          <div className="guess-box">
            <div className="gq"><Eye size={13} /> 先想一想</div>
            <div className="gqsub">在看 AI 的补充前，你觉得这篇还有哪些作者没提的局限？（练判断，不是替你想）</div>
            <textarea value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="写下你的判断…" />
            <button className="reveal-btn" onClick={reveal} disabled={busy}>{busy ? "分析中…" : "展开 AI 的补充"} <ChevronDown size={12} /></button>
          </div>
        ) : busy ? <div className="rd-scaffold"><Loader size={13} className="rd-spin" /> 分析中…（推断车道，需回原文核对）</div>
          : <InfBody env={env} onGoto={onGoto} />}
      </div>
    </div>
  );
}
// 信封路由：lane==="inference" 或 refused → 琥珀；否则证据。渲染层不决定车道。
// ── 阅读理解可视化 ──
// 结构图(Layer1)：把已接地的 outline（证据车道）渲染成可点击跳页的纵向流程；纯确定性转换，不调 LLM。
const STAGE_COLORS = { 背景: "#3B82C4", 引言: "#3B82C4", 空白: "#C2410C", 缺口: "#C2410C", 问题: "#7C3AED", 目的: "#7C3AED", 假设: "#7C3AED", 方法: "#0E7C6F", 数据: "#0E7C6F", 材料: "#0E7C6F", 结果: "#B45309", 发现: "#B45309", 讨论: "#475569", 局限: "#9A3412", 结论: "#0E7C6F", 贡献: "#0E7C6F" };
function stageOf(text) { const m = String(text || "").split(/[：:]/)[0].trim(); return m.length > 0 && m.length <= 8 && /[：:]/.test(String(text)) ? m : ""; }
function stageColor(label) { for (const k in STAGE_COLORS) if (label.indexOf(k) >= 0) return STAGE_COLORS[k]; return "var(--gold)"; }
function StructureMap({ env, onGoto }) {
  const items = (env.claims || []).filter((c) => c.text);
  if (!items.length) return <div className="rd-scaffold">（暂无结构条目，请重新生成大纲）</div>;
  return (
    <div className="rd-smap">
      {items.map((c, i) => {
        const label = stageOf(c.text);
        const body = label ? c.text.slice(c.text.indexOf(label) + label.length).replace(/^[：:]\s*/, "") : c.text;
        const color = stageColor(label || c.text);
        return (
          <React.Fragment key={i}>
            <div className="rd-snode" style={{ borderLeftColor: color }}>
              {label && <span className="rd-stag" style={{ background: color }}>{label}</span>}
              <span className="rd-stext">{body}</span>
              {(c.pageRefs || []).length > 0 && <span className="rd-spages">{c.pageRefs.map((p, j) => <button key={j} className="lf-cite" onClick={() => onGoto && onGoto(p)} title={"跳到第 " + p + " 页"}>p.{p}↗</button>)}</span>}
            </div>
            {i < items.length - 1 && <div className="rd-sarrow"><ChevronDown size={15} /></div>}
          </React.Fragment>
        );
      })}
    </div>
  );
}
// 逻辑流程图(Layer2)：确定性分层布局（最长路径排秩，环安全），渲染引擎产出的 nodes+edges。
// 节点点击跳首个页码；无页码节点标灰（虚线+暗）；模型只产 JSON、不画 SVG。
function wrapLabel(s, per, maxLines) {
  s = String(s || ""); const out = [];
  for (let i = 0; i < s.length && out.length < maxLines; i += per) out.push(s.slice(i, i + per));
  if (out.length === maxLines && s.length > maxLines * per) out[maxLines - 1] = out[maxLines - 1].slice(0, per - 1) + "…";
  return out.length ? out : [""];
}
function layoutGraph(nodes, edges) {
  const idx = {}; nodes.forEach((n, i) => (idx[n.id] = i));
  const rank = nodes.map(() => 0);
  for (let it = 0; it <= nodes.length; it++) {
    let changed = false;
    edges.forEach((e) => { const a = idx[e.from], b = idx[e.to]; if (a == null || b == null) return; if (rank[b] < rank[a] + 1) { rank[b] = rank[a] + 1; changed = true; } });
    if (!changed) break;
  }
  const maxRank = nodes.length ? Math.max.apply(null, rank) : 0;
  const rows = []; for (let r = 0; r <= maxRank; r++) rows.push([]);
  nodes.forEach((n, i) => rows[rank[i]].push(i));
  // 轻量重心排序（确定性）：每行按与上一行相连节点的平均列位重排，减少连线交叉，让分支/并行更易读。
  for (let r = 1; r < rows.length; r++) {
    const prevCol = {}; rows[r - 1].forEach((ni, c) => (prevCol[ni] = c));
    const base = {}; rows[r].forEach((ni, c) => (base[ni] = c));
    const score = {};
    rows[r].forEach((ni) => {
      const ins = edges.filter((e) => idx[e.to] === ni && prevCol[idx[e.from]] != null).map((e) => prevCol[idx[e.from]]);
      score[ni] = ins.length ? ins.reduce((a, b) => a + b, 0) / ins.length : base[ni];
    });
    rows[r] = rows[r].slice().sort((a, b) => (score[a] - score[b]) || (base[a] - base[b]));
  }
  return { rank, rows, idx };
}
function nodeColor(label) { return stageColor(stageOf(label) || String(label || "")); }
function FlowGraph({ graph, onGoto, svgRef }) {
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  if (!nodes.length) return <div className="rd-scaffold">（未能从正文重建出流程图，请重试或换更强的模型）</div>;
  const { rows, idx } = layoutGraph(nodes, edges);
  const wrapped = nodes.map((n) => wrapLabel(n.label, 9, 3));
  const maxLines = Math.max(1, Math.max.apply(null, wrapped.map((w) => w.length)));
  const NW = 150, LH = 15, NH = 30 + maxLines * LH, RG = NH + 56, CG = 30, PAD = 16;
  const maxCols = Math.max(1, Math.max.apply(null, rows.map((r) => r.length)));
  const svgW = Math.max(300, maxCols * NW + (maxCols - 1) * CG + PAD * 2);
  const svgH = PAD * 2 + (rows.length - 1) * RG + NH;
  const pos = {};
  rows.forEach((row, r) => {
    const rowW = row.length * NW + (row.length - 1) * CG;
    const startX = (svgW - rowW) / 2;
    row.forEach((ni, c) => { pos[ni] = { x: startX + c * (NW + CG), y: PAD + r * RG }; });
  });
  return (
    <svg ref={svgRef} className="rd-graph" viewBox={"0 0 " + svgW + " " + svgH} width="100%" style={{ height: svgH }} xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="rdarrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--ink4)" /></marker></defs>
      {edges.map((e, i) => {
        const a = idx[e.from], b = idx[e.to]; if (a == null || b == null) return null;
        const pa = pos[a], pb = pos[b];
        const x1 = pa.x + NW / 2, y1 = pa.y + NH, x2 = pb.x + NW / 2, y2 = pb.y;
        const dy = Math.max(18, (y2 - y1) / 2);
        const d = "M" + x1 + "," + y1 + " C" + x1 + "," + (y1 + dy) + " " + x2 + "," + (y2 - dy) + " " + x2 + "," + y2;
        const lw = String(e.label || "").length * 6.4 + 6;
        return (
          <g key={i}>
            <path d={d} className="rd-gedge" markerEnd="url(#rdarrow)" />
            {e.label && <g><rect className="rd-glabelbg" x={(x1 + x2) / 2 - lw / 2} y={(y1 + y2) / 2 - 8} width={lw} height="14" rx="4" /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 2} className="rd-glabel" textAnchor="middle">{e.label}</text></g>}
          </g>
        );
      })}
      {nodes.map((n, i) => {
        const p = pos[i]; const grounded = (n.pageRefs || []).length > 0;
        const lines = wrapped[i]; const col = grounded ? nodeColor(n.label) : "var(--line2)";
        return (
          <g key={i} className={"rd-gnode" + (grounded ? "" : " ng")} onClick={() => grounded && onGoto && onGoto(n.pageRefs[0])} style={{ cursor: grounded ? "pointer" : "default" }}>
            <title>{n.label + (grounded ? "（p." + n.pageRefs.join(",p.") + "）" : "（无页码依据，请谨慎）")}</title>
            <rect x={p.x} y={p.y} width={NW} height={NH} rx="11" fill="var(--surf)" stroke={col} strokeDasharray={grounded ? undefined : "4 3"} />
            {grounded && <rect x={p.x} y={p.y + 9} width="3.5" height={NH - 18} rx="2" fill={col} />}
            {lines.map((ln, k) => <text key={k} x={p.x + NW / 2 + (grounded ? 2 : 0)} y={p.y + NH / 2 - (lines.length - 1) * (LH / 2) + k * LH + 4} textAnchor="middle" className="rd-gtext">{ln}</text>)}
            {grounded && <text x={p.x + NW - 8} y={p.y + 14} textAnchor="end" className="rd-gpage" fill={col}>p.{n.pageRefs[0]}</text>}
          </g>
        );
      })}
    </svg>
  );
}
// 图解卡：lane 仍据 env.lane（HC-1，流程图为推断车道=琥珀）+ 框定语 + banner + 导出 SVG。
function GraphCard({ env, onGoto }) {
  const svgRef = useRef(null);
  const inf = env.lane === "inference";
  const exportSvg = () => {
    try {
      const el = svgRef.current; if (!el) return;
      const s = new XMLSerializer().serializeToString(el);
      const blob = new Blob(["<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + s], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = (env.kind || "diagram") + ".svg"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {}
  };
  return (
    <div className={"rd-gcard" + (inf ? " inf" : "")}>
      <div className={"rd-lane" + (inf ? " inf" : "")}>{inf ? <Lightbulb size={11} /> : <Shield size={11} />} {inf ? "推断车道 · AI 解读，非原文事实" : "证据车道 · 可回原文核对"}</div>
      {env.framing && <div className="rd-gframing">{env.framing}</div>}
      {env.banner && <div className="rd-ai-banner">{env.banner}</div>}
      <FlowGraph graph={env.graph} onGoto={onGoto} svgRef={svgRef} />
      <button className="rd-gexport" onClick={exportSvg}><Download size={13} /> 导出 SVG</button>
    </div>
  );
}
function EnvelopeCard({ env, onGoto, defaultOpen }) {
  if (!env) return null;
  if (env.graph) return <GraphCard env={env} onGoto={onGoto} />;
  if (env.lane === "inference" || env.refused) return <InfCard env={env} onGoto={onGoto} defaultOpen={defaultOpen} />;
  return <EvidenceCard env={env} onGoto={onGoto} />;
}
function EvidencePane({ ensurePages, source, onGoto, pushToast, purpose, moveReq }) {
  const [env, setEnv] = useState(null);
  const [running, setRunning] = useState("");
  const [swipe, setSwipe] = useState([]);
  const rec = (purpose && PURPOSE_REC[purpose]) || [];
  useEffect(() => { bridge.swipeGet().then((l) => setSwipe(l || [])).catch(() => {}); }, []);
  const run = useCallback(async (kind, opts) => {
    setRunning(kind);
    try {
      const pages = await ensurePages();
      const e = await bridge.readerAnalyze(kind, pages, opts);
      setEnv(e || null);
      if (!e) pushToast && pushToast("分析失败，请重试");
      if (e && kind !== "move" && source && source.paperId) bridge.readerAnalysisSave(source.paperId, e);
    } catch (err) { pushToast && pushToast("分析失败"); }
    finally { setRunning(""); }
  }, [ensurePages, source, pushToast]);
  useEffect(() => { if (moveReq && moveReq.text) run("move", { text: moveReq.text, page: moveReq.page }); }, [moveReq && moveReq.id]); // eslint-disable-line
  const saveSwipe = useCallback(async (e) => {
    const orig = (e.claims && e.claims[0] && e.claims[0].text) || "";
    const pg = (e.claims && e.claims[0] && e.claims[0].pageRefs && e.claims[0].pageRefs[0]) || 0;
    await bridge.swipeSave({ paperId: source && source.paperId, page: pg, text: orig, kind: "move", createdAt: Date.now() });
    const l = await bridge.swipeGet(); setSwipe(l || []);
    pushToast && pushToast("已存入写作 swipe file（带出处）");
  }, [source, pushToast]);
  const removeSwipe = useCallback(async (id) => { await bridge.swipeRemove(id); const l = await bridge.swipeGet(); setSwipe(l || []); }, []);
  return (
    <div className="rd-zonebody">
      <div className="rd-lane"><Shield size={11} /> 证据车道 · 每条结论可回原文核对</div>
      <div className="rd-tools">
        {DEEP_TOOLS.map((t) => (
          <button key={t[0]} aria-label={t[1] + "：" + t[2]} className={"rd-tool" + (rec.includes(t[0]) ? " rec" : "")} onClick={() => run(t[0])} disabled={!!running}>
            {rec.includes(t[0]) && <span className="rd-toolrec">推荐</span>}
            <span className="rd-toolname">{React.createElement(t[3], { size: 13 })} {t[1]}</span>
            <span className="rd-tooldesc">{t[2]}</span>
          </button>
        ))}
      </div>
      {running ? <div className="rd-scaffold"><Loader size={13} className="rd-spin" /> 分析中…（结果带页码，可回原文核对）</div>
        : env ? <><EnvelopeCard env={env} onGoto={onGoto} />{env.kind === "move" && <button className="rd-swipe-save" onClick={() => saveSwipe(env)}><Bookmark size={13} /> 存入写作 swipe file（带出处）</button>}</>
        : <div className="rd-scaffold">点上面任一工具运行；或在正文划词选「写作观察」提取某句的修辞功能。结果走证据车道，带页码、可回原文核对。</div>}
      {swipe.length > 0 && (
        <div className="rd-swipe">
          <div className="rd-swipe-h"><Bookmark size={12} /> 写作 swipe file · {swipe.length} 条（带出处）</div>
          {swipe.map((it) => (
            <div key={it.id} className="rd-swipe-item">
              {it.page ? <button className="rd-pcite" onClick={() => onGoto(it.page)} title={"跳到第 " + it.page + " 页"}>p.{it.page}↗</button> : null}
              <span>{String(it.text || "").slice(0, 90)}</span>
              <button className="x" onClick={() => removeSwipe(it.id)} title="移除" aria-label="从写作 swipe file 移除"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// 逻辑流程图工具（推断车道 L2）：按需生成，引擎产 JSON → GraphCard 确定性渲染；无页码节点标灰。
function FlowmapTool({ ensurePages, source, onGoto, pushToast }) {
  const [env, setEnv] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      const pages = await ensurePages();
      const e = await bridge.readerAnalyze("flowmap", pages);
      setEnv(e || null);
      if (!e) pushToast && pushToast("流程图生成失败，请重试");
      if (e && source && source.paperId) bridge.readerAnalysisSave(source.paperId, e);
    } catch (err) { pushToast && pushToast("流程图生成失败"); }
    finally { setBusy(false); }
  }, [ensurePages, source, pushToast]);
  return (
    <div className="rd-flowtool">
      <button className="rd-ai-act" onClick={run} disabled={busy}>
        {busy ? <><Loader size={14} className="rd-spin" /> 生成中…（重建方法 / 逻辑流程）</> : <><Workflow size={14} /> 逻辑流程图（实验）</>}
      </button>
      {env && <EnvelopeCard env={env} onGoto={onGoto} />}
    </div>
  );
}

function InferencePane({ ensurePages, source, onGoto, pushToast, figureEnv, figuring }) {
  return (
    <div className="rd-zonebody">
      <div className="inf-pane">
        <div className="rd-lane inf"><Lightbulb size={11} /> 推断车道 · AI 的解读，非原文事实</div>
        <div className="inf-banner" style={{ marginTop: 10, marginBottom: 2 }}><AlertTriangle size={15} /><div>此区为 AI 的<b>解读与推测</b>，<b>不是论文陈述的事实</b>，各带把握度、默认折叠——请回原文核对后再采信。</div></div>
        {figuring && <div className="inf-card open"><div className="inf-h"><Lightbulb size={14} className="t" /> <span className="inf-title">图表分析</span><span className="inf-right"><Loader size={14} className="rd-spin" /></span></div><div className="inf-body"><div className="rd-scaffold">读图中…（渲染区域 → 视觉模型）</div></div></div>}
        {!figuring && figureEnv && <InfCard env={figureEnv} onGoto={onGoto} defaultOpen />}
        <InfAnalyzer kind="hardcore" ensurePages={ensurePages} source={source} onGoto={onGoto} pushToast={pushToast} />
        <InfAnalyzer kind="limitations" ensurePages={ensurePages} source={source} onGoto={onGoto} pushToast={pushToast} practice />
        <InfAnalyzer kind="genesis" ensurePages={ensurePages} source={source} onGoto={onGoto} pushToast={pushToast} />
        <InfAnalyzer kind="stats" ensurePages={ensurePages} source={source} onGoto={onGoto} pushToast={pushToast} />
        <FlowmapTool ensurePages={ensurePages} source={source} onGoto={onGoto} pushToast={pushToast} />
      </div>
    </div>
  );
}

// 右侧阅读助手：整篇接地总结 + 大纲 + 带页码引用的接地问答（只单篇，必带 sourceBasis；无 key/无后端走 mock）
function AssistantPanel({ ensurePages, source, onGoto, pushToast, explainReq, purpose, setPurpose }) {
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [qa, setQa] = useState([]);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [outlineEnv, setOutlineEnv] = useState(null);
  const [outlining, setOutlining] = useState(false);
  const [outlineView, setOutlineView] = useState("map");

  const doSummary = useCallback(async () => {
    setSummarizing(true);
    try { const pages = await ensurePages(); const r = await bridge.readerSummarize(pages); setSummary(r || null); }
    catch (e) { pushToast && pushToast("总结失败"); }
    finally { setSummarizing(false); }
  }, [ensurePages, pushToast]);

  const doOutline = useCallback(async () => {
    setOutlining(true);
    try {
      const pages = await ensurePages();
      const env = await bridge.readerAnalyze("outline", pages);
      setOutlineEnv(env || null);
      if (!env) pushToast && pushToast("大纲提取失败，请重试");
      if (env && source && source.paperId) bridge.readerAnalysisSave(source.paperId, env);
    } catch (e) { pushToast && pushToast("大纲提取失败"); }
    finally { setOutlining(false); }
  }, [ensurePages, pushToast, source]);

  const doAsk = useCallback(async (question) => {
    const qq = (question || "").trim();
    if (!qq || asking) return;
    setQ(""); setAsking(true);
    setQa((list) => [...list, { q: qq, a: null, loading: true }]);
    try {
      const pages = await ensurePages();
      const r = await bridge.readerAsk(pages, qq);
      setQa((list) => list.map((x, i) => (i === list.length - 1
        ? { q: qq, a: r ? r.text : "（无回答）", sourceBasis: r && r.sourceBasis, groundedRatio: r && r.groundedRatio, banner: r && r.banner, loading: false }
        : x)));
    } catch (e) {
      setQa((list) => list.map((x, i) => (i === list.length - 1 ? { q: qq, a: "（出错，请稍后重试）", loading: false } : x)));
    } finally { setAsking(false); }
  }, [ensurePages, asking]);

  useEffect(() => {
    if (explainReq && explainReq.text) doAsk("请在本文语境中解释这段：" + explainReq.text);
  }, [explainReq && explainReq.id]); // eslint-disable-line

  const Meta = ({ basis, ratio }) => (
    <div className="rd-ai-meta">
      <span className={"rd-basis" + (basis === "fulltext" ? " ft" : "")}>{basis === "fulltext" ? "● 基于全文" : "● 基于摘要"}</span>
      {typeof ratio === "number" && <span className="rd-gr">接地 {Math.round(ratio * 100)}%</span>}
    </div>
  );

  return (
    <div className="rd-zonebody">

      <div className="rd-ai-sec">
        <div className="rd-ai-label">我这次为什么读？（据此推荐深读工具）</div>
        <div className="rd-purpose">
          {[["replicate", "复现/设计"], ["cite", "引为背景"], ["critique", "批判性评估"], ["borrow", "借方法/写法"]].map((pp) => (
            <button key={pp[0]} aria-pressed={purpose === pp[0]} className={"rd-pchip" + (purpose === pp[0] ? " on" : "")} onClick={() => setPurpose(purpose === pp[0] ? null : pp[0])}>{pp[1]}</button>
          ))}
        </div>
        {purpose && <div className="rd-phint">{PURPOSE_HINT[purpose]}</div>}
      </div>

      <div className="rd-ai-sec">
        <button className="rd-ai-act" onClick={doSummary} disabled={summarizing}>
          {summarizing ? <><Loader size={14} className="rd-spin" /> 总结中…</> : <><Sparkles size={14} /> 整篇接地总结</>}
        </button>
        {summary && (
          <div className="rd-ai-card">
            <Meta basis={summary.sourceBasis} ratio={summary.groundedRatio} />
            {summary.banner && <div className="rd-ai-banner">{summary.banner}</div>}
            <div className="rd-ai-body"><CiteText text={summary.text} onGoto={onGoto} /></div>
          </div>
        )}
      </div>

      <div className="rd-ai-sec">
        <button className="rd-ai-act" onClick={doOutline} disabled={outlining}>
          {outlining ? <><Loader size={14} className="rd-spin" /> 提取中…</> : <><Layers size={14} /> 逻辑大纲</>}
        </button>
        {outlineEnv && (outlineEnv.refused
          ? <EnvelopeCard env={outlineEnv} onGoto={onGoto} />
          : <>
              <div className="rd-vtoggle" role="tablist" aria-label="大纲视图">
                <button role="tab" aria-selected={outlineView === "map"} className={"rd-vtab" + (outlineView === "map" ? " on" : "")} onClick={() => setOutlineView("map")}><Map size={13} /> 结构图</button>
                <button role="tab" aria-selected={outlineView === "list"} className={"rd-vtab" + (outlineView === "list" ? " on" : "")} onClick={() => setOutlineView("list")}><List size={13} /> 列表</button>
              </div>
              {outlineView === "map" ? <StructureMap env={outlineEnv} onGoto={onGoto} /> : <EnvelopeCard env={outlineEnv} onGoto={onGoto} />}
            </>)}
      </div>

      <div className="rd-ai-sec">
        <div className="rd-ai-label">问这一篇（回答带页码引用，点击跳页）</div>
        <div className="rd-ai-presets">
          {PRESET_Q.map((pq, i) => <button key={i} className="rd-ai-chip" onClick={() => doAsk(pq)} disabled={asking}>{pq}</button>)}
        </div>
        <div className="rd-ai-flow">
          {qa.map((item, i) => (
            <div key={i} className="rd-ai-qa">
              <div className="rd-ai-q">{item.q}</div>
              <div className="rd-ai-a">
                {item.loading ? <span className="rd-ai-load"><Loader size={13} className="rd-spin" /> 思考中…</span> : (
                  <>
                    <Meta basis={item.sourceBasis} ratio={item.groundedRatio} />
                    {item.banner && <div className="rd-ai-banner">{item.banner}</div>}
                    <CiteText text={item.a} onGoto={onGoto} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="rd-ai-input">
          <input value={q} placeholder="输入问题，回车提问…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doAsk(q); }} />
          <button className="rd-ai-send" onClick={() => doAsk(q)} disabled={asking || !q.trim()} title="提问"><Send size={15} /></button>
        </div>
      </div>
    </div>
  );
}

// 翻译面板：按页懒翻译（同步当前页 + 译全部页），三模式=同一(原文,译文)的三种布局。复用 reader:translate。
function TranslatePanel({ doc, page, numPages, mode, setMode, onClose, pushToast, docKey, model }) {
  const cacheRef = useRef({}); // page -> {orig, trans, loading, cached, model, err}
  const [, setTick] = useState(0);
  const [bulk, setBulk] = useState(null);
  const pmapRef = useRef({});             // 持久翻译缓存 page -> {text, model, at}
  const [pmapReady, setPmapReady] = useState(false);
  const [llmReady, setLlmReady] = useState({ checking: true, ok: false, message: "" });
  useEffect(() => {
    let alive = true; pmapRef.current = {}; cacheRef.current = {}; setPmapReady(false);
    bridge.getTranslations(docKey).then((m) => { if (alive) { pmapRef.current = m || {}; setPmapReady(true); } }).catch(() => { if (alive) setPmapReady(true); });
    return () => { alive = false; };
  }, [docKey]);
  useEffect(() => {
    let alive = true;
    bridge.llmReady().then((s) => { if (alive) setLlmReady({ checking: false, ok: !!(s && s.ok), message: (s && s.message) || "" }); }).catch(() => { if (alive) setLlmReady({ checking: false, ok: false, message: "无法读取大模型配置" }); });
    return () => { alive = false; };
  }, []);

  const translatePage = useCallback(async (pg, force) => {
    const c = cacheRef.current[pg];
    if (!force && c && (c.trans || c.loading || c.err)) return;
    let orig = "";
    try { const items = await getPageStrings(doc, pg); orig = items.join(" ").trim(); } catch (e) { /* noop */ }
    const hit = !force && pmapRef.current[pg];
    if (hit && hit.text) { cacheRef.current[pg] = { orig, trans: hit.text, loading: false, cached: true, model: hit.model || "" }; setTick((t) => t + 1); return; } // 命中持久缓存 → 跳过 LLM
    if (!llmReady.ok) {
      cacheRef.current[pg] = { orig, trans: "", loading: false, cached: false, model, err: llmReady.message || "请先在设置 → 大模型中配置 API Key" };
      setTick((t) => t + 1);
      return;
    }
    cacheRef.current[pg] = { orig, trans: "", loading: true }; setTick((t) => t + 1);
    let trans = "";
    let err = "";
    if (!orig) trans = "（本页无可提取文本）";
    else {
      const res = await bridge.readerTranslate(orig);
      if (res && res.ok) trans = res.text || "（无译文）";
      else err = (res && res.error) || "（翻译失败）";
    }
    cacheRef.current[pg] = { orig, trans, loading: false, cached: false, model, err }; setTick((t) => t + 1);
    if (orig && trans && !err && docKey) { pmapRef.current[pg] = { text: trans, model: model || "", at: Date.now() }; bridge.saveTranslation(docKey, pg, model || "", trans); } // 落库（派生缓存，非权威）
  }, [doc, docKey, model, llmReady]);

  useEffect(() => { if (pmapReady && !llmReady.checking) translatePage(page); }, [page, translatePage, pmapReady, llmReady]);

  const translateAll = useCallback(async () => {
    if (!llmReady.ok) return;
    setBulk({ done: 0, total: numPages });
    for (let pg = 1; pg <= numPages; pg++) { await translatePage(pg); setBulk({ done: pg, total: numPages }); }
    setBulk(null); pushToast && pushToast("全部页翻译完成");
  }, [numPages, translatePage, pushToast, llmReady]);

  const cur = cacheRef.current[page] || { orig: "", trans: "", loading: true };
  const MODES = [["inline", "段内对照"], ["dual", "双栏对照"], ["only", "仅译文"]];
  const llmBlocked = !llmReady.checking && !llmReady.ok;

  return (
    <div className="rd-tp">
      <div className="rd-tp-h">
        <span><Languages size={15} /> 翻译 · 第 {page}/{numPages || "—"} 页</span>
        <button className="rd-x" onClick={onClose} title="关闭翻译"><X size={16} /></button>
      </div>
      {llmBlocked && <div className="rd-tp-warn">{llmReady.message}</div>}
      <div className="rd-tp-cache">
        {cur.cached ? <span className="rd-tp-cached" title={"已缓存译文（由 " + (cur.model || "未知模型") + " 翻译，重开即用）"}>已缓存{cur.model ? " · " + cur.model : ""}</span> : llmReady.ok ? <span className="rd-tp-cached fresh">{model || "大模型"}</span> : null}
        <button className="rd-tp-rf" onClick={() => translatePage(page, true)} disabled={cur.loading || llmBlocked} title="用当前模型重新翻译本页（覆盖缓存）"><RefreshCw size={12} /> 重新翻译</button>
      </div>
      <div className="rd-tp-modes">
        {MODES.map((mm) => <button key={mm[0]} className={mode === mm[0] ? "on" : ""} onClick={() => setMode(mm[0])}>{mm[1]}</button>)}
      </div>
      <button className="rd-tp-all" onClick={translateAll} disabled={!!bulk || llmBlocked}>{bulk ? ("翻译中 " + bulk.done + "/" + bulk.total + "…") : "译全部页"}</button>
      <div className="rd-tp-body">
        {cur.loading ? (
          <div className="rd-ai-load"><Loader size={14} className="rd-spin" /> 翻译中…</div>
        ) : llmBlocked ? (
          mode === "only" ? null : mode === "dual" ? (
            <div className="rd-tp-cols"><div className="rd-tp-orig">{cur.orig}</div></div>
          ) : (
            <div className="rd-tp-orig">{cur.orig}</div>
          )
        ) : cur.err ? (
          <div className="rd-tp-warn">{cur.err}</div>
        ) : mode === "only" ? (
          <div className="rd-tp-tr">{cur.trans}</div>
        ) : mode === "dual" ? (
          <div className="rd-tp-cols"><div className="rd-tp-orig">{cur.orig}</div><div className="rd-tp-tr">{cur.trans}</div></div>
        ) : (
          <div className="rd-tp-stack"><div className="rd-tp-orig">{cur.orig}</div><div className="rd-tp-tr">{cur.trans}</div></div>
        )}
      </div>
    </div>
  );
}

// 批注面板：列表 + 跳页 + 评论 + 删除 + 导出（带注释 PDF / 笔记 Markdown）
function AnnoPanel({ annos, onGoto, onUpdate, onRemove, onExportPdf, onExportMd }) {
  const sorted = annos.slice().sort((a, b) => (a.page - b.page) || (a.createdAt - b.createdAt));
  return (
    <div className="rd-zonebody">
      <div className="rd-ai-h"><Highlighter size={15} /> 批注</div>
      <div className="rd-anno-acts">
        <button onClick={onExportPdf} disabled={!annos.length}><FileDown size={13} /> 带注释 PDF</button>
        <button onClick={onExportMd} disabled={!annos.length}><Download size={13} /> 笔记 Markdown</button>
      </div>
      {sorted.length === 0 ? (
        <div className="rd-empty2">还没有批注。选中文本后用浮条添加高亮或便签；批注随文档自动留存。</div>
      ) : (
        <div className="rd-anno-list">
          {sorted.map((a) => (
            <div key={a.id} className="rd-anno-item">
              <div className="rd-anno-top">
                <span className={"rd-sw hl-" + a.color} />
                <button className="rd-anno-jump" onClick={() => onGoto(a.page)}>p.{a.page}↗</button>
                <span className="rd-anno-type">{a.type === "note" ? "便签" : "高亮"}</span>
                <button className="rd-anno-del" onClick={() => onRemove(a.id)} title="删除"><Trash2 size={13} /></button>
              </div>
              {a.anchoredText ? <div className="rd-anno-quote">{String(a.anchoredText).slice(0, 160)}</div> : null}
              <textarea className="rd-anno-note" placeholder="写批注…" value={a.note || ""} onChange={(e) => onUpdate(a.id, { note: e.target.value })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReaderPanel({ zone, setZone, doc, source, onGoto, pushToast, explainReq, moveReq, figureEnv, figuring, annos, onUpdate, onRemove, onExportPdf, onExportMd }) {
  const TABS = [["assist", "助手", Sparkles, false], ["deep", "深读", Layers, false], ["inf", "推读", Lightbulb, true], ["notes", "批注", Highlighter, false]];
  const pagesRef = useRef(null);
  const ftIndexedRef = useRef("");
  const [purpose, setPurpose] = useState(null);
  const ensurePages = useCallback(async () => {
    if (pagesRef.current) return pagesRef.current;
    const pages = await getDocPages(doc);
    pagesRef.current = pages;
    if (source && source.paperId && ftIndexedRef.current !== source.paperId) {
      ftIndexedRef.current = source.paperId;
      try { bridge.indexFullText(source.paperId, pages.map((pg) => pg.text || "").join("\n")); } catch (e) { /* 索引失败不阻断 */ }
    }
    return pages;
  }, [doc, source]);
  useEffect(() => { if (doc && source && source.paperId) ensurePages().catch(() => {}); }, [doc, source, ensurePages]);
  return (
    <div className="rd-ai">
      <div className="rd-zones" role="tablist" aria-label="阅读 AI 分区">
        {TABS.map((tb) => (
          <button key={tb[0]} role="tab" aria-selected={zone === tb[0]} className={"rd-zone" + (tb[3] ? " inf" : "") + (zone === tb[0] ? " on" : "")} onClick={() => setZone(tb[0])}>{React.createElement(tb[2], { size: 13 })} {tb[1]}</button>
        ))}
      </div>
      <div style={{ display: zone === "assist" ? "block" : "none" }}><AssistantPanel ensurePages={ensurePages} source={source} onGoto={onGoto} pushToast={pushToast} explainReq={explainReq} purpose={purpose} setPurpose={setPurpose} /></div>
      <div style={{ display: zone === "deep" ? "block" : "none" }}><EvidencePane ensurePages={ensurePages} source={source} onGoto={onGoto} pushToast={pushToast} purpose={purpose} moveReq={moveReq} /></div>
      <div style={{ display: zone === "inf" ? "block" : "none" }}><InferencePane ensurePages={ensurePages} source={source} onGoto={onGoto} pushToast={pushToast} figureEnv={figureEnv} figuring={figuring} /></div>
      <div style={{ display: zone === "notes" ? "block" : "none" }}><AnnoPanel annos={annos} onGoto={onGoto} onUpdate={onUpdate} onRemove={onRemove} onExportPdf={onExportPdf} onExportMd={onExportMd} /></div>
    </div>
  );
}

export default function Reader({ source, onClose, pushToast }) {
  const [doc, setDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [rotation, setRotation] = useState(0);
  const [view, setView] = useState("continuous");
  const [sidebar, setSidebar] = useState(true);
  const [sidePanel, setSidePanel] = useState("thumbs"); // 展开面板 thumbs|outline|marks|null(仅图标轨)
  const [sideWidth, setSideWidth] = useState(190);
  const [navmarks, setNavmarks] = useState([]); // 页面书签（持久化导航，按 docKey，页码升序）
  const sideWidthRef = useRef(190);
  const [pageInput, setPageInput] = useState("1");
  const [outline, setOutline] = useState([]);
  const [focus, setFocus] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [findOpen, setFindOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [transMode, setTransMode] = useState(null);     // 段内 inline / 双栏 dual / 仅译文 only
  const [transMenuOpen, setTransMenuOpen] = useState(false);
  const [annos, setAnnos] = useState([]);
  const [zone, setZone] = useState("assist");
  const [moveReq, setMoveReq] = useState(null);
  const [figureEnv, setFigureEnv] = useState(null);
  const [figuring, setFiguring] = useState(false);
  const [snipMode, setSnipMode] = useState(false);
  const [snipRect, setSnipRect] = useState(null);
  const loadedRef = useRef(false);
  const snipStart = useRef(null);
  const docKey = useMemo(() => {
    if (source && source.paperId) return "paper:" + source.paperId;
    if (source && source.localPath) return "local:" + source.localPath;
    return ((source && source.name ? source.name : "doc") + ":" + ((source && source.data && source.data.byteLength) || 0));
  }, [source]);
  const [sel, setSel] = useState(null);          // 划词浮条 {text,x,y}
  const [selTrans, setSelTrans] = useState(null); // 选区译文 {loading,text}（划词译走会话内存，不落库）
  const [ctxMenu, setCtxMenu] = useState(null); // PDF 右键 { x,y, kind, selection? }
  const ctxSelectionRef = useRef(null);
  const [llmModel, setLlmModel] = useState("");
  const [explainReq, setExplainReq] = useState(null);
  const [find, setFind] = useState(null); // { q, matches:[{page,kOnPage}], cur }
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [night, setNight] = useState(false);   // 夜读反色（页面 canvas 反相）
  const [hand, setHand] = useState(false);      // 抓手平移
  const [rememberPos, setRememberPos] = useState(true); // 续读位置（默认开，可在设置·阅读关）
  const panRef = useRef(null);                  // 平移会话 {x,y,sl,st}
  const posLoadedRef = useRef(false);           // 本 doc 是否已尝试恢复位置（避免覆盖用户翻页）
  const viewRef = useRef(null);
  const rootRef = useRef(null);
  const strCache = useRef({});
  const annoUndoRef = useRef([]);
  const annoRedoRef = useRef([]);
  const undoAnnoRef = useRef(() => {});
  const redoAnnoRef = useRef(() => {});
  const [annoHistTick, setAnnoHistTick] = useState(0);
  const canUndoAnno = annoUndoRef.current.length > 0;
  const canRedoAnno = annoRedoRef.current.length > 0;

  useEffect(() => {
    setReaderContextHost(true);
    return () => setReaderContextHost(false);
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => { setCtxMenu(null); ctxSelectionRef.current = null; };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const onDown = (e) => { if (!(e.target && e.target.closest && e.target.closest(".rd-ctx"))) close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [ctxMenu]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null); strCache.current = {}; setFind(null); setFindOpen(false);
    posLoadedRef.current = false;
    openPdf({ data: source.data })
      .then(async (d) => {
        if (cancelled) return;
        setDoc(d); setNumPages(d.numPages || 0); setLoading(false);
        const ol = await getOutline(d); if (!cancelled) setOutline(ol);
      })
      .catch(() => { if (!cancelled) { setErr("无法打开此 PDF（文件可能损坏或非 PDF）。"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [source]);

  // 读取「设置·阅读」偏好（续读位置 / 夜读默认 / 默认缩放）
  useEffect(() => {
    let alive = true;
    bridge.getSettings && bridge.getSettings().then((s) => {
      if (!alive || !s || !s.reader) return;
      const r = s.reader;
      if (typeof r.rememberPos === "boolean") setRememberPos(r.rememberPos);
      if (typeof r.nightInvert === "boolean") setNight(r.nightInvert);
      if (typeof r.defaultZoom === "number" && r.defaultZoom >= 0.3 && r.defaultZoom <= 4) setScale(r.defaultZoom);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // 续读：doc 就绪后恢复页码（继续阅读 startPage 优先，其次设置里按 docKey 记忆）
  useEffect(() => {
    if (!doc || posLoadedRef.current) return;
    posLoadedRef.current = true;
    const fromContinue = source && source.startPage && source.startPage >= 1 ? source.startPage : null;
    if (fromContinue && fromContinue <= (doc.numPages || 1)) {
      setPage(fromContinue);
      return;
    }
    if (!rememberPos) return;
    bridge.getSettings && bridge.getSettings().then((s) => {
      const p = s && s.reader && s.reader.positions && s.reader.positions[docKey];
      if (p && p >= 1 && p <= (doc.numPages || 1)) setPage(p);
    }).catch(() => {});
  }, [doc, docKey, rememberPos, source]);

  // 续读：翻页后防抖写回该 doc 位置（与现有设置合并，last-write-wins；关闭「记住位置」则不写）
  useEffect(() => {
    if (!rememberPos || !doc) return;
    const t = setTimeout(() => {
      persistSettings((cur) => {
        const reader = { ...(cur.reader || {}) };
        reader.positions = { ...(reader.positions || {}), [docKey]: page };
        return { ...cur, reader };
      }).catch(() => {});
      if (source && source.entryKey) {
        bridge.recordReadingPage(source.entryKey, page).catch(() => {});
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [page, docKey, rememberPos, doc, source]);

  const goto = useCallback((n) => setPage((p) => Math.max(1, Math.min(numPages || 1, n || p))), [numPages]);
  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX, startW = sideWidthRef.current;
    const move = (ev) => { const w = Math.max(150, Math.min(420, startW + (ev.clientX - startX))); sideWidthRef.current = w; setSideWidth(w); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }, []);
  const addMark = useCallback(() => setNavmarks((m) => { if (m.includes(page)) return m; const next = [...m, page].sort((a, b) => a - b); bridge.saveNavmarks(docKey, next); return next; }), [page, docKey]);
  const removeMark = useCallback((n) => setNavmarks((m) => { const next = m.filter((x) => x !== n); bridge.saveNavmarks(docKey, next); return next; }), [docKey]);
  useEffect(() => { setPageInput(String(page)); }, [page]);
  const step = view === "two" ? 2 : 1;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { if (snipMode) { setSnipMode(false); setSnipRect(null); } else if (transMenuOpen) { setTransMenuOpen(false); } else if (zoomMenuOpen) { setZoomMenuOpen(false); } else if (sel) { setSel(null); } else if (findOpen) { setFindOpen(false); setFind(null); } else if (aiOpen) { setAiOpen(false); } else if (transMode) { setTransMode(null); } else onClose(); return; }
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // 输入框内不抢快捷键
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "f" || e.key === "F")) { e.preventDefault(); setFindOpen(true); }
      else if (e.key === "Home") { e.preventDefault(); setPage(1); }
      else if (e.key === "End") { e.preventDefault(); setPage(numPages); }
      else if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); setScale((s) => Math.min(4, +(s * 1.1).toFixed(3))); }
      else if (mod && e.key === "-") { e.preventDefault(); setScale((s) => Math.max(0.3, +(s * 0.9).toFixed(3))); }
      else if (mod && e.key === "0") { e.preventDefault(); if (doc && viewRef.current) fitWidthScale(doc, page, viewRef.current.clientWidth, rotation).then(setScale).catch(() => {}); }
      else if (!mod && (e.key === "r" || e.key === "R") && e.shiftKey) { e.preventDefault(); setRotation((r) => (r + 270) % 360); }
      else if (!mod && (e.key === "r" || e.key === "R")) { e.preventDefault(); setRotation((r) => (r + 90) % 360); }
      else if (mod && (e.key === "p" || e.key === "P")) { e.preventDefault(); const api = window.luminaApi; if (api && api.contextAction) api.contextAction("print"); }
      else if (mod && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); undoAnnoRef.current(); }
      else if (mod && ((e.key === "y" || e.key === "Y") || (e.shiftKey && (e.key === "z" || e.key === "Z")))) { e.preventDefault(); redoAnnoRef.current(); }
      else if (e.key === "ArrowRight" || e.key === "PageDown") setPage((p) => Math.min(numPages, p + step));
      else if (e.key === "ArrowLeft" || e.key === "PageUp") setPage((p) => Math.max(1, p - step));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, numPages, step, findOpen, sel, transMenuOpen, transMode, snipMode, aiOpen, zoomMenuOpen, doc, page, rotation]); // undoAnno/redoAnno stable via refs

  useEffect(() => {
    if (view !== "continuous") return;
    const el = document.getElementById("rd-pg-" + page);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [page, view]);

  const zoomOut = () => setScale((s) => Math.max(0.3, +(s * 0.9).toFixed(3)));
  const zoomIn = () => setScale((s) => Math.min(4, +(s * 1.1).toFixed(3)));
  const fit = useCallback(async () => {
    if (!doc || !viewRef.current) return;
    try { setScale(await fitWidthScale(doc, page, viewRef.current.clientWidth, rotation)); } catch (e) { /* noop */ }
  }, [doc, page, rotation]);
  const actualSize = () => { setScale(1); setZoomMenuOpen(false); };
  const fitPage = useCallback(async () => {
    setZoomMenuOpen(false);
    if (!doc || !viewRef.current) return;
    try {
      const pg = await doc.getPage(page);
      const vp = pg.getViewport({ scale: 1, rotation });
      const h = viewRef.current.clientHeight - 32;
      if (vp.height > 0) setScale(Math.max(0.3, Math.min(4, +(h / vp.height).toFixed(3))));
    } catch (e) { /* noop */ }
  }, [doc, page, rotation]);
  const rotateCw = () => setRotation((r) => (r + 90) % 360);
  const rotateCcw = () => setRotation((r) => (r + 270) % 360);
  const download = () => {
    try {
      const blob = new Blob([source.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = source.name || "document.pdf"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      pushToast && pushToast("已开始下载");
    } catch (e) { pushToast && pushToast("下载失败"); }
  };

  const onSelectUp = useCallback(() => {
    if (snipMode) return;
    const captured = captureTextSelection(rootRef.current, page, scale);
    if (!captured) { setSel(null); return; }
    setSel(captured);
    setSelTrans(null);
  }, [snipMode, page, scale]);

  const onReaderContextMenu = useCallback((e) => {
    if (!shouldReaderHandleContextTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const captured = captureTextSelection(rootRef.current, page, scale);
    ctxSelectionRef.current = captured;
    if (captured) setSel(captured);
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      kind: captured ? "selection" : "blank",
      selection: captured,
      page,
      numPages,
      hasBookmark: navmarks.includes(page),
      annoCount: annos.length,
      canUndoAnno,
      night,
      focus,
      hand,
    });
  }, [page, scale, numPages, navmarks, annos.length, canUndoAnno, night, focus, hand, annoHistTick]);

  // 截取（图/公式）：框选区域 → 取区域内文本层文字 → 接地解释
  const onViewMouseDown = (e) => { if (hand && viewRef.current) { panRef.current = { x: e.clientX, y: e.clientY, sl: viewRef.current.scrollLeft, st: viewRef.current.scrollTop }; e.preventDefault(); return; } if (!snipMode || !rootRef.current) return; const host = rootRef.current.getBoundingClientRect(); snipStart.current = { x: e.clientX, y: e.clientY }; setSnipRect({ x: e.clientX - host.left, y: e.clientY - host.top, w: 0, h: 0 }); };
  const onViewMouseMove = (e) => { if (hand) { if (panRef.current && viewRef.current) { viewRef.current.scrollLeft = panRef.current.sl - (e.clientX - panRef.current.x); viewRef.current.scrollTop = panRef.current.st - (e.clientY - panRef.current.y); } return; } if (!snipMode || !snipStart.current || !rootRef.current) return; const host = rootRef.current.getBoundingClientRect(); const sx = snipStart.current.x, sy = snipStart.current.y; setSnipRect({ x: Math.min(sx, e.clientX) - host.left, y: Math.min(sy, e.clientY) - host.top, w: Math.abs(e.clientX - sx), h: Math.abs(e.clientY - sy) }); };
  const onViewMouseUp = (e) => {
    if (hand) { panRef.current = null; return; }
    if (snipMode && snipStart.current) {
      const x1 = Math.min(snipStart.current.x, e.clientX), y1 = Math.min(snipStart.current.y, e.clientY), x2 = Math.max(snipStart.current.x, e.clientX), y2 = Math.max(snipStart.current.y, e.clientY);
      snipStart.current = null; setSnipRect(null); setSnipMode(false);
      if (x2 - x1 < 8 || y2 - y1 < 8) return; // 框太小忽略
      let cap = "";
      try { rootRef.current.querySelectorAll(".textLayer span").forEach((sp) => { const r = sp.getBoundingClientRect(); if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) cap += (sp.textContent || "") + " "; }); } catch (er) { /* noop */ }
      doFigure(x1, y1, x2, y2, cap.trim()); // 框选图表 → 渲染区域 → 视觉读图（进推读车道）
      return;
    }
    onSelectUp();
  };
  const doFigure = useCallback(async (x1, y1, x2, y2, caption) => {
    let canvas = null;
    try {
      const host = viewRef.current || rootRef.current;
      const cs = host ? host.querySelectorAll("canvas") : [];
      cs.forEach((c) => { if (canvas) return; const r = c.getBoundingClientRect(); if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2 && r.width > 40) canvas = c; });
    } catch (er) { /* noop */ }
    if (!canvas) { pushToast && pushToast("未定位到页面画布"); return; }
    const cr = canvas.getBoundingClientRect();
    const bbox = { x: (Math.max(x1, cr.left) - cr.left) / cr.width, y: (Math.max(y1, cr.top) - cr.top) / cr.height, w: (Math.min(x2, cr.right) - Math.max(x1, cr.left)) / cr.width, h: (Math.min(y2, cr.bottom) - Math.max(y1, cr.top)) / cr.height };
    const wrap = canvas.closest && canvas.closest("[id^='rd-pg-']");
    const pno = wrap ? parseInt(wrap.id.slice(6), 10) : page;
    setFiguring(true); setFigureEnv(null); setAiOpen(true); setZone("inf"); setTransMode(null);
    try {
      const dataUrl = await renderRegion(doc, pno, bbox, { scale: 2.5 });
      const env = await bridge.readerFigure(dataUrl, caption || "");
      setFigureEnv(env || null);
      if (!env) pushToast && pushToast("图表分析失败，请重试");
    } catch (er) { pushToast && pushToast("图表分析失败"); }
    finally { setFiguring(false); }
  }, [doc, page, pushToast]);

  useEffect(() => {
    let alive = true; loadedRef.current = false;
    annoUndoRef.current = [];
    annoRedoRef.current = [];
    setAnnoHistTick((t) => t + 1);
    bridge.getAnnotations(docKey).then((list) => {
      if (alive) {
        setAnnos(Array.isArray(list) ? list : []);
        loadedRef.current = true;
      }
    }).catch(() => { loadedRef.current = true; });
    return () => { alive = false; };
  }, [docKey]);
  useEffect(() => {
    let alive = true;
    bridge.getNavmarks(docKey).then((m) => { if (alive) setNavmarks(Array.isArray(m) ? m : []); }).catch(() => {});
    return () => { alive = false; };
  }, [docKey]);
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(() => { bridge.saveAnnotations(docKey, annos); }, 600);
    return () => clearTimeout(t);
  }, [annos, docKey]);
  useEffect(() => { bridge.getSettings().then((s) => setLlmModel((s && s.llm && s.llm.model) || "")).catch(() => {}); }, []);

  const pushAnnoHistory = useCallback((prev) => {
    if (!loadedRef.current) return;
    annoUndoRef.current.push(JSON.parse(JSON.stringify(prev)));
    if (annoUndoRef.current.length > 50) annoUndoRef.current.shift();
    annoRedoRef.current = [];
    setAnnoHistTick((t) => t + 1);
  }, []);

  const addAnno = useCallback((a) => {
    setAnnos((list) => {
      pushAnnoHistory(list);
      return [...list, a];
    });
  }, [pushAnnoHistory]);

  const updateAnno = useCallback((id, patch) => setAnnos((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x))), []);

  const removeAnno = useCallback((id) => {
    setAnnos((list) => {
      pushAnnoHistory(list);
      return list.filter((x) => x.id !== id);
    });
  }, [pushAnnoHistory]);

  const undoAnno = useCallback(() => {
    if (!annoUndoRef.current.length) return;
    setAnnos((prev) => {
      annoRedoRef.current.push(JSON.parse(JSON.stringify(prev)));
      return JSON.parse(JSON.stringify(annoUndoRef.current.pop()));
    });
    setAnnoHistTick((t) => t + 1);
    pushToast && pushToast("已撤销批注");
  }, [pushToast]);

  const redoAnno = useCallback(() => {
    if (!annoRedoRef.current.length) return;
    setAnnos((prev) => {
      annoUndoRef.current.push(JSON.parse(JSON.stringify(prev)));
      return JSON.parse(JSON.stringify(annoRedoRef.current.pop()));
    });
    setAnnoHistTick((t) => t + 1);
    pushToast && pushToast("已重做批注");
  }, [pushToast]);

  useEffect(() => {
    undoAnnoRef.current = undoAnno;
    redoAnnoRef.current = redoAnno;
  }, [undoAnno, redoAnno]);

  const onExportPdf = useCallback(async () => { try { await exportAnnotatedPdf(source.data, annos, source.name); pushToast && pushToast("已导出带注释 PDF"); } catch (e) { pushToast && pushToast("导出失败"); } }, [annos, source, pushToast]);
  const onExportMd = useCallback(() => { try { exportNotesMarkdown(annos, source.name); pushToast && pushToast("已导出笔记 Markdown"); } catch (e) { /* noop */ } }, [annos, source, pushToast]);
  const addHighlight = (color, fromSel) => {
    const s = fromSel || sel;
    if (!s || !s.rects || !s.rects.length) { setSel(null); return; }
    addAnno({ id: "a" + Date.now(), type: "highlight", page: s.page, color, rects: s.rects, anchoredText: s.text, note: "", createdAt: Date.now() });
    setSel(null);
  };
  const onNoteFromSel = (fromSel) => {
    const s = fromSel || sel;
    if (!s) return;
    addAnno({ id: "a" + Date.now(), type: "note", page: s.page, color: "blue", rects: s.rects || [], anchoredText: s.text, note: "", createdAt: Date.now() });
    setAiOpen(true); setZone("notes"); setTransMode(null); setSel(null);
  };
  const onNote = () => onNoteFromSel(sel);
  const onExplainFromSel = (fromSel) => {
    const s = fromSel || sel;
    if (!s) return;
    setExplainReq({ text: s.text, id: Date.now() });
    setAiOpen(true); setZone("assist"); setSel(null);
  };
  const onExplain = () => onExplainFromSel(sel);
  const onWritingObsFromSel = (fromSel) => {
    const s = fromSel || sel;
    if (!s) return;
    setMoveReq({ text: s.text, page: s.page, id: Date.now() });
    setAiOpen(true); setZone("deep"); setSel(null);
  };
  const onWritingObs = () => onWritingObsFromSel(sel);
  const onTranslateFromSel = async (fromSel) => {
    const s = fromSel || sel;
    if (!s) return;
    setSelTrans({ loading: true, text: "" });
    try {
      const res = await bridge.readerTranslate(s.text);
      setSelTrans({ loading: false, text: (res && res.ok) ? (res.text || "（无译文）") : ((res && res.error) || "（翻译失败）") });
    } catch (e) { setSelTrans({ loading: false, text: "（翻译失败）" }); }
  };
  const onCopySelFrom = (fromSel) => {
    const s = fromSel || sel;
    if (!s) return;
    try { navigator.clipboard && navigator.clipboard.writeText(s.text); pushToast && pushToast("已复制"); } catch (e) { /* noop */ }
    setSel(null);
  };
  const onCopySel = () => onCopySelFrom(sel);
  const onTranslate = () => onTranslateFromSel(sel);

  const getStrs = async (p) => {
    if (strCache.current[p]) return strCache.current[p];
    const arr = await getPageStrings(doc, p);
    strCache.current[p] = arr;
    return arr;
  };
  const runFind = async (raw) => {
    const q = (raw || "").trim().toLowerCase();
    if (!q || !doc) { setFind(null); return; }
    const matches = [];
    for (let p = 1; p <= numPages; p++) {
      const items = await getStrs(p);
      let k = 0;
      for (const s of items) { const c = countOcc(s, q); for (let j = 0; j < c; j++) matches.push({ page: p, kOnPage: k + j }); k += c; }
    }
    setFind({ q, matches, cur: matches.length ? 0 : -1 });
    if (matches.length) setPage(Math.max(1, Math.min(numPages, matches[0].page)));
  };

  const runCtxAction = useCallback((actionId) => {
    const captured = ctxSelectionRef.current || sel;
    switch (actionId) {
      case "copy": onCopySelFrom(captured); break;
      case "copyCite":
        if (captured) {
          try {
            navigator.clipboard.writeText(`"${captured.text}" (p.${captured.page})`);
            pushToast && pushToast("已复制带页码引用");
          } catch { /* noop */ }
        }
        setSel(null);
        break;
      case "hl-yellow": addHighlight("yellow", captured); break;
      case "hl-green": addHighlight("green", captured); break;
      case "hl-pink": addHighlight("pink", captured); break;
      case "note": onNoteFromSel(captured); break;
      case "explain": onExplainFromSel(captured); break;
      case "writingObs": onWritingObsFromSel(captured); break;
      case "translate": onTranslateFromSel(captured); break;
      case "findSelection":
        if (captured) { setFindOpen(true); runFind(captured.text); }
        break;
      case "zoomIn": zoomIn(); break;
      case "zoomOut": zoomOut(); break;
      case "fitWidth": fit(); break;
      case "actualSize": actualSize(); break;
      case "fitPage": fitPage(); break;
      case "rotateCw": rotateCw(); break;
      case "rotateCcw": rotateCcw(); break;
      case "prevPage": goto(page - step); break;
      case "nextPage": goto(page + step); break;
      case "addBookmark": addMark(); break;
      case "removeBookmark": removeMark(page); break;
      case "copyPage":
        try { navigator.clipboard.writeText(String(page)); pushToast && pushToast(`已复制页码：第 ${page} 页`); } catch { /* noop */ }
        break;
      case "find": setFindOpen(true); break;
      case "snip": setSnipMode(true); break;
      case "openNotes": setAiOpen(true); setZone("notes"); setTransMode(null); break;
      case "openAssist": setAiOpen(true); setZone("assist"); setTransMode(null); break;
      case "toggleNight": setNight((v) => !v); break;
      case "toggleFocus": setFocus((v) => !v); break;
      case "toggleHand": setHand((v) => !v); break;
      case "download": download(); break;
      case "print": { const api = window.luminaApi; if (api && api.contextAction) api.contextAction("print"); break; }
      case "exportPdf": onExportPdf(); break;
      case "exportMd": onExportMd(); break;
      case "undoAnno": undoAnno(); break;
      default: break;
    }
    ctxSelectionRef.current = null;
  }, [sel, page, step, numPages, pushToast, fit, fitPage, goto, addMark, removeMark, onExportPdf, onExportMd, runFind]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveFind = (delta) => {
    if (!find || !find.matches.length) return;
    const cur = (find.cur + delta + find.matches.length) % find.matches.length;
    setFind({ ...find, cur });
    setPage(Math.max(1, Math.min(numPages, find.matches[cur].page)));
  };
  const closeFind = () => { setFindOpen(false); setFind(null); };

  const curMatch = find && find.cur >= 0 ? find.matches[find.cur] : null;
  const curFor = (n) => (curMatch && curMatch.page === n ? curMatch.kOnPage : -1);

  return (
    <div className={"rd" + (focus ? " focus" : "") + (night ? " night" : "")} ref={rootRef} onContextMenu={onReaderContextMenu}>
      <style>{READER_CSS}</style>

      <div className="rd-topbar">
        <button className="rd-back" onClick={onClose}><ArrowLeft size={15} /> 返回</button>
        <div className="rd-name">{source.name}</div>
        <button className="rd-x" onClick={onClose} title="关闭 (Esc)"><X size={18} /></button>
      </div>

      <div className="rd-toolbar">
        <div className="rd-grp">
          <button className={"rd-btn" + (sidebar ? " on" : "")} onClick={() => setSidebar((v) => !v)} title="侧栏"><PanelLeft size={15} /></button>
        </div>
        <div className="rd-grp">
          <div className="rd-seg">
            <button className={view === "single" ? "on" : ""} onClick={() => setView("single")} title="单页"><Square size={13} /> 单页</button>
            <button className={view === "continuous" ? "on" : ""} onClick={() => setView("continuous")} title="连续"><Rows3 size={13} /> 连续</button>
            <button className={view === "two" ? "on" : ""} onClick={() => setView("two")} title="双页"><Columns2 size={13} /> 双页</button>
          </div>
        </div>
        <div className="rd-grp">
          <button className="rd-btn" onClick={() => goto(page - step)} disabled={page <= 1} title="上一页"><ChevronLeft size={16} /></button>
          <span className="rd-pageind">
            <input value={pageInput} onChange={(e) => setPageInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const n = parseInt(pageInput, 10); if (!Number.isNaN(n)) goto(n); e.currentTarget.blur(); } }} onBlur={() => { const n = parseInt(pageInput, 10); if (!Number.isNaN(n)) goto(n); else setPageInput(String(page)); }} title="输入页码后回车跳转" /> / {numPages || "—"}
          </span>
          <button className="rd-btn" onClick={() => goto(page + step)} disabled={page >= numPages} title="下一页"><ChevronRight size={16} /></button>
        </div>
        <div className="rd-grp">
          <button className="rd-btn" onClick={zoomOut} title="缩小 (Ctrl/⌘ -)"><Minus size={15} /></button>
          <span className="rd-zoom-wrap">
            <button className="rd-zoom-btn" onClick={() => setZoomMenuOpen((v) => !v)} title="缩放预设">{Math.round(scale * 100)}%</button>
            {zoomMenuOpen && (
              <div className="rd-zoom-menu" onMouseLeave={() => setZoomMenuOpen(false)}>
                <button onClick={actualSize}><ScanLine size={13} /> 实际大小 100%</button>
                <button onClick={() => { fit(); setZoomMenuOpen(false); }}><Maximize size={13} /> 适配宽度</button>
                <button onClick={fitPage}><Square size={13} /> 适配整页</button>
              </div>
            )}
          </span>
          <button className="rd-btn" onClick={zoomIn} title="放大 (Ctrl/⌘ +)"><Plus size={15} /></button>
          <button className="rd-btn" onClick={fit} title="适配宽度 (Ctrl/⌘ 0)"><Maximize size={15} /></button>
        </div>
        <div className="rd-grp">
          <button className="rd-btn" onClick={rotateCw} title="顺时针旋转 (R)"><RotateCw size={15} /></button>
          <button className="rd-btn" onClick={rotateCcw} title="逆时针旋转 (Shift+R)"><RotateCcw size={15} /></button>
          <button className={"rd-btn" + (hand ? " on" : "")} onClick={() => setHand((v) => !v)} title="抓手（按住拖动平移）"><Hand size={15} /></button>
          <button className={"rd-btn" + (night ? " on" : "")} onClick={() => setNight((v) => !v)} title="夜读反色"><Moon size={15} /></button>
          <button className={"rd-btn" + (focus ? " on" : "")} onClick={() => setFocus((v) => !v)} title="专注模式"><Expand size={15} /></button>
        </div>
        <div className="rd-grp" style={{ position: "relative" }}>
          <button className={"rd-btn" + (findOpen ? " on" : "")} onClick={() => setFindOpen((v) => !v)} title="页内查找"><Search size={15} /> 查找</button>
          <button className={"rd-btn" + (aiOpen && zone === "assist" ? " on" : "")} onClick={() => { if (aiOpen && zone === "assist") setAiOpen(false); else { setAiOpen(true); setZone("assist"); setTransMode(null); } }} title="阅读助手"><Sparkles size={15} /> 助手</button>
          <button className={"rd-btn" + (aiOpen && zone === "notes" ? " on" : "")} onClick={() => { if (aiOpen && zone === "notes") setAiOpen(false); else { setAiOpen(true); setZone("notes"); setTransMode(null); } }} title="批注"><Highlighter size={15} /> 批注</button>
          <button className="rd-btn" disabled={!canUndoAnno} onClick={undoAnno} title="撤销批注 (Ctrl/⌘ Z)"><Undo2 size={15} /> 撤销</button>
          <button className="rd-btn" disabled={!canRedoAnno} onClick={redoAnno} title="重做批注 (Ctrl/⌘ Y)"><Redo2 size={15} /> 重做</button>
          <button className={"rd-btn" + (snipMode ? " on" : "")} onClick={() => setSnipMode((v) => !v)} title="截图分析（框选图表→视觉分析，进推读车道）"><Crop size={15} /> 截图</button>
          <span className="rd-trwrap">
            <button className={"rd-btn" + (transMode ? " on" : "")} onClick={() => setTransMenuOpen((v) => !v)} title="翻译"><Languages size={15} /> 译 <ChevronDown size={13} /></button>
            {transMenuOpen && (
              <div className="rd-tmenu">
                {[["inline", "段内对照"], ["dual", "双栏对照"], ["only", "仅译文"]].map((mm) => (
                  <button key={mm[0]} onClick={() => { setTransMode(mm[0]); setAiOpen(false); setTransMenuOpen(false); }}>{mm[1]}</button>
                ))}
              </div>
            )}
          </span>
          <button className="rd-btn" onClick={download} title="下载"><Download size={15} /></button>
          <span className="rd-hint" title="选中文本后可高亮、便签；批注随文档自动保存">
            {annos.length > 0 ? `${annos.length} 条批注` : "划词可批注"}
          </span>
        </div>
      </div>

      {findOpen && (
        <div className="rd-find">
          <Search size={15} />
          <input autoFocus placeholder="在文档中查找…（回车搜索）" defaultValue={find ? find.q : ""}
            onKeyDown={(e) => { if (e.key === "Enter") runFind(e.target.value); else if (e.key === "Escape") closeFind(); }} />
          <span className="rd-fcount">{find ? (find.matches.length ? find.cur + 1 + " / " + find.matches.length : "0 / 0") : "—"}</span>
          <button className="rd-btn" onClick={() => moveFind(-1)} disabled={!find || !find.matches.length} title="上一处"><ChevronUp size={15} /></button>
          <button className="rd-btn" onClick={() => moveFind(1)} disabled={!find || !find.matches.length} title="下一处"><ChevronDown size={15} /></button>
          <button className="rd-x" onClick={closeFind} title="关闭查找"><X size={16} /></button>
        </div>
      )}

      <div className="rd-body">
        {sidebar && !loading && !err && doc && (
          <div className="rd-side" style={{ width: sidePanel ? sideWidth + 46 : 46 }}>
            <div className="rd-rail">
              <button className={"rd-railbtn" + (sidePanel === "thumbs" ? " on" : "")} onClick={() => setSidePanel((v) => v === "thumbs" ? null : "thumbs")} title="页面缩略图"><Images size={17} /></button>
              <button className={"rd-railbtn" + (sidePanel === "outline" ? " on" : "")} onClick={() => setSidePanel((v) => v === "outline" ? null : "outline")} title="目录大纲"><List size={17} /></button>
              <button className={"rd-railbtn" + (sidePanel === "marks" ? " on" : "")} onClick={() => setSidePanel((v) => v === "marks" ? null : "marks")} title="页面书签"><Bookmark size={17} /></button>
            </div>
            {sidePanel && (
              <div className="rd-sidepanel" style={{ width: sideWidth }}>
                <div className="rd-sidehead">
                  <span>{sidePanel === "thumbs" ? "页面" : sidePanel === "outline" ? "目录" : "书签"}</span>
                  <button className="rd-x" onClick={() => setSidePanel(null)} title="收起面板（留图标栏）"><X size={14} /></button>
                </div>
                <div className="rd-sidebody">
                  {sidePanel === "thumbs" && (
                    <div className="rd-thumbs">
                      {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                        <div key={n} className={"rd-thumb" + (n === page ? " active" : "")} onClick={() => goto(n)}>
                          <ThumbCanvas doc={doc} pageNum={n} rotation={rotation} />
                          <span>{n}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {sidePanel === "outline" && <OutlineTree items={outline} doc={doc} onGoto={(p) => goto(p)} />}
                  {sidePanel === "marks" && (
                    <div className="rd-marks">
                      {navmarks.length === 0 ? (
                        <div className="rd-marks-empty">还没有书签。<br />读到要紧处，点下方收藏当前页，随时跳回。</div>
                      ) : navmarks.map((n) => (
                        <div key={n} className={"rd-mark" + (n === page ? " active" : "")} onClick={() => goto(n)}>
                          <Bookmark size={13} /> 第 {n} 页
                          <button className="rd-mark-rm" onClick={(e) => { e.stopPropagation(); removeMark(n); }} title="移除书签"><X size={12} /></button>
                        </div>
                      ))}
                      <button className="rd-mark-add" onClick={addMark} disabled={navmarks.includes(page)}>{navmarks.includes(page) ? "本页已收藏" : ("＋ 收藏当前页（第 " + page + " 页）")}</button>
                    </div>
                  )}
                </div>
                <div className="rd-resize" onPointerDown={startResize} title="拖动调整宽度" />
              </div>
            )}
          </div>
        )}

        <div className={"rd-view" + (snipMode ? " snip" : "") + (hand ? " hand" : "")} ref={viewRef} onMouseDown={onViewMouseDown} onMouseMove={onViewMouseMove} onMouseUp={onViewMouseUp} onScroll={() => { if (sel) setSel(null); }}>
          {loading ? (
            <div className="rd-loading"><Loader size={26} className="rd-spin" /><div>正在打开 PDF…</div></div>
          ) : err ? (
            <div className="rd-err"><AlertTriangle size={24} /><div>{err}</div></div>
          ) : !doc ? null : view === "continuous" ? (
            Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <div key={n} id={"rd-pg-" + n}><PageView doc={doc} pageNum={n} scale={scale} rotation={rotation} find={find} curOnThisPage={curFor(n)} annos={annos.filter((a) => a.page === n)} /></div>
            ))
          ) : view === "two" ? (
            <div className="rd-spread">
              <PageView doc={doc} pageNum={page} scale={scale} rotation={rotation} find={find} curOnThisPage={curFor(page)} annos={annos.filter((a) => a.page === page)} />
              {page + 1 <= numPages && <PageView doc={doc} pageNum={page + 1} scale={scale} rotation={rotation} find={find} curOnThisPage={curFor(page + 1)} annos={annos.filter((a) => a.page === page + 1)} />}
            </div>
          ) : (
            <PageView doc={doc} pageNum={page} scale={scale} rotation={rotation} find={find} curOnThisPage={curFor(page)} annos={annos.filter((a) => a.page === page)} />
          )}
        </div>

        {aiOpen && !transMode && !loading && !err && doc && (
          <ReaderPanel zone={zone} setZone={setZone} doc={doc} source={source} onGoto={goto} pushToast={pushToast} explainReq={explainReq} moveReq={moveReq} figureEnv={figureEnv} figuring={figuring} annos={annos} onUpdate={updateAnno} onRemove={removeAnno} onExportPdf={onExportPdf} onExportMd={onExportMd} />
        )}
        {transMode && !loading && !err && doc && (
          <TranslatePanel doc={doc} page={page} numPages={numPages} mode={transMode} setMode={setTransMode} onClose={() => setTransMode(null)} pushToast={pushToast} docKey={docKey} model={llmModel} />
        )}
      </div>

      {sel && (
        <div className="rd-pop" style={{ left: sel.x + "px", top: sel.y + "px" }}>
          <div className="rd-pop-bar">
            <button onClick={() => addHighlight("yellow")} className="rd-hlbtn hl-yellow" title="高亮(黄)" />
            <button onClick={() => addHighlight("green")} className="rd-hlbtn hl-green" title="高亮(绿)" />
            <button onClick={() => addHighlight("pink")} className="rd-hlbtn hl-pink" title="高亮(粉)" />
            <span className="rd-pop-div" />
            <button onClick={onExplain} title="在本文语境中解释（带页码）"><Sparkles size={13} /> 解释</button>
            <button onClick={onWritingObs} title="提取写作观察（修辞功能+情境，带出处）"><Quote size={13} /> 写作观察</button>
            <button onClick={onTranslate} title="翻译所选"><Languages size={13} /> 译</button>
            <button onClick={onNote} title="加便签"><StickyNote size={13} /> 便签</button>
            <button onClick={onCopySel} title="复制"><Copy size={13} /></button>
          </div>
          {selTrans && <div className="rd-pop-tr">{selTrans.loading ? "翻译中…" : selTrans.text}</div>}
        </div>
      )}

      {snipRect && <div className="rd-snip" style={{ left: snipRect.x + "px", top: snipRect.y + "px", width: snipRect.w + "px", height: snipRect.h + "px" }} />}

      {ctxMenu && (
        <ReaderContextMenu
          menu={ctxMenu}
          platform={(typeof window !== "undefined" && window.luminaApi && window.luminaApi.platform) || "win32"}
          onAction={runCtxAction}
          onClose={() => { setCtxMenu(null); ctxSelectionRef.current = null; }}
        />
      )}
    </div>
  );
}
