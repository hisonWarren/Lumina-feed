import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Aperture, Sunrise, Search, Sparkles, Star, Bookmark, Inbox, X,
  ChevronRight, ChevronDown, SlidersHorizontal, List, Rows3, Quote,
  ShieldCheck, AlertTriangle, Check, ArrowUpRight, FileDown, Layers, Circle, Moon, Sun, Command, ArrowUpDown, Settings
} from "lucide-react";
import { THEMES, THEME_CSS, DEFAULT_THEME, isLight } from "./themes.js";
import { TitleBar, ThemePicker, SubscriptionManager, SubscribeEntry, SettingsPanel, UX_STYLE, emptySub } from "./lumina-ux.jsx";
import { bridge, hasBackend, digestItemToCard } from "./lumina-bridge.js";

/* ════════════════════════════════════════════════════════════════════
   LUMINA FEED · "THE OBSERVATORY"
   A precision instrument for watching the frontier of science.
   Evidence × recency is encoded as light. The day's papers are stars.
   ════════════════════════════════════════════════════════════════════ */

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.lf{
  --bg:#0A0D14; --bg2:#0E121C; --surf:#141925; --surf2:#19202E;
  --line:#222A3A; --line2:#2C354A;
  --ink:#ECE7DD; --ink2:#A7AEBD; --ink3:#6B7384; --ink4:#4A5160;
  --gold:#F2C879; --goldDim:#C9A463; --peri:#8AA9E0;
  --t-meta:#F4D9A0; --t-rct:#76D6AE; --t-cohort:#86A9E6; --t-review:#C2A6EC; --t-basic:#9BD0D8; --t-case:#9AA0AC;
  --pre:#E6A862; --ret:#E58686;
  --serif:'Source Serif 4','Noto Serif',Georgia,'Times New Roman',serif;
  --sans:'Inter',system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  --mono:'Space Mono','SFMono-Regular',ui-monospace,monospace;
  position:relative; width:100%; height:100vh; overflow:hidden;
  display:flex; flex-direction:column;
  background:var(--bg); color:var(--ink); font-family:var(--sans);
  -webkit-font-smoothing:antialiased; isolation:isolate;
  font-feature-settings:"ss01","cv01";
}
html,body,#root{height:100%; margin:0; padding:0}
body{background:#F4F4F1}
.lf *{box-sizing:border-box}
.lf ::selection{background:rgba(242,200,121,.22); color:#fff}
.lf-scroll{overflow-y:auto; scrollbar-width:thin; scrollbar-color:var(--line2) transparent}
.lf-scroll::-webkit-scrollbar{width:8px}
.lf-scroll::-webkit-scrollbar-thumb{background:var(--line2); border-radius:8px}
.lf-scroll::-webkit-scrollbar-track{background:transparent}

/* ── ambient background ── */
.lf-aurora{position:absolute; inset:-30%; z-index:0; pointer-events:none; filter:blur(70px); opacity:.55}
.lf-aurora i{position:absolute; border-radius:50%; mix-blend-mode:screen; display:block}
.lf-aurora i:nth-child(1){width:46%;height:46%; left:-6%; top:-10%; background:radial-gradient(circle,rgba(242,200,121,.30),transparent 70%); animation:drift1 26s ease-in-out infinite}
.lf-aurora i:nth-child(2){width:52%;height:52%; right:-10%; top:8%; background:radial-gradient(circle,rgba(98,128,210,.26),transparent 70%); animation:drift2 32s ease-in-out infinite}
.lf-aurora i:nth-child(3){width:40%;height:40%; left:28%; bottom:-16%; background:radial-gradient(circle,rgba(118,214,174,.14),transparent 70%); animation:drift1 38s ease-in-out infinite reverse}
@keyframes drift1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(6%,4%) scale(1.12)}}
@keyframes drift2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-5%,6%) scale(1.08)}}
.lf-grain{position:absolute; inset:0; z-index:1; pointer-events:none; opacity:.04; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.lf-vignette{position:absolute; inset:0; z-index:1; pointer-events:none;
  background:radial-gradient(120% 90% at 50% 0%,transparent 55%,rgba(0,0,0,.45) 100%)}
.lf-stage{position:relative; z-index:2; display:flex; flex-direction:column; flex:1; min-height:0}

/* ── top bar ── */
.lf-top{display:flex; align-items:center; justify-content:space-between; padding:14px 20px;
  border-bottom:1px solid var(--line); background:linear-gradient(180deg,rgba(20,25,37,.72),rgba(20,25,37,.30)); backdrop-filter:blur(10px)}
.lf-brand{display:flex; align-items:center; gap:11px}
.lf-mark{width:32px;height:32px; border-radius:9px; display:grid; place-items:center; position:relative;
  background:radial-gradient(circle at 35% 30%,#1d2230,#0c0f17); border:1px solid var(--line2);
  box-shadow:0 0 0 1px rgba(242,200,121,.10), 0 0 18px rgba(242,200,121,.14)}
.lf-mark svg{color:var(--gold)}
.lf-name{font-family:var(--serif); font-weight:600; font-size:18px; letter-spacing:-.01em; line-height:1}
.lf-tag{font-family:var(--mono); font-size:9.5px; letter-spacing:.22em; text-transform:uppercase; color:var(--ink3); margin-top:3px}
.lf-switch{display:flex; gap:3px; padding:3px; border:1px solid var(--line); border-radius:11px; background:rgba(10,13,20,.5)}
.lf-segbtn{display:flex; align-items:center; gap:7px; padding:7px 15px; border-radius:8px; cursor:pointer; border:none; background:transparent;
  font-family:var(--sans); font-size:13px; font-weight:500; color:var(--ink2); transition:all .22s cubic-bezier(.4,0,.2,1)}
.lf-segbtn:hover{color:var(--ink)}
.lf-segbtn.on{color:#0A0D14; background:linear-gradient(180deg,var(--gold),var(--goldDim));
  box-shadow:0 2px 10px rgba(242,200,121,.30), inset 0 1px 0 rgba(255,255,255,.4)}
.lf-status{font-family:var(--mono); font-size:10.5px; color:var(--ink3); display:flex; align-items:center; gap:7px}
.lf-live{width:6px;height:6px;border-radius:50%; background:var(--t-rct); box-shadow:0 0 8px var(--t-rct); animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* ── view fade ── */
.lf-view{flex:1; min-height:0; animation:viewIn .5s ease both}
@keyframes viewIn{from{opacity:0}to{opacity:1}}

/* ── reveal ── */
@keyframes riseIn{from{opacity:0; transform:translateY(14px)}to{opacity:1; transform:none}}
.rise{animation:riseIn .6s cubic-bezier(.2,.7,.2,1) both}

/* ════ TODAY / DAWN ════ */
.lf-dawn{max-width:920px; margin:0 auto; padding:34px 28px 60px}
.lf-eyebrow{font-family:var(--mono); font-size:11px; letter-spacing:.28em; text-transform:uppercase; color:var(--goldDim); display:flex; align-items:center; gap:10px}
.lf-eyebrow .ln{height:1px; flex:1; background:linear-gradient(90deg,var(--line2),transparent)}
.lf-date{font-family:var(--serif); font-weight:600; font-size:60px; line-height:1.0; letter-spacing:-.025em; margin:14px 0 2px; color:var(--ink)}
.lf-date .dow{display:block; font-size:18px; font-weight:400; letter-spacing:.02em; color:var(--ink3); font-family:var(--mono); text-transform:uppercase; margin-top:10px}
.lf-lead{font-size:16.5px; line-height:1.6; color:var(--ink2); max-width:560px; margin-top:16px}
.lf-lead b{color:var(--gold); font-weight:600}

/* spectrum */
.lf-spec{margin:30px 0 8px; padding:20px 18px 12px; border:1px solid var(--line); border-radius:16px;
  background:linear-gradient(180deg,rgba(25,32,46,.5),rgba(14,18,28,.3))}
.lf-spec-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:6px}
.lf-spec-title{font-family:var(--mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--ink2)}
.lf-spec-legend{font-family:var(--mono); font-size:10px; color:var(--ink3)}
.lf-star{cursor:pointer; transition:transform .2s}
.lf-star:hover{transform:scale(1.25)}
.lf-spec-tip{position:absolute; pointer-events:none; padding:8px 11px; border-radius:9px; max-width:240px;
  background:rgba(8,11,18,.96); border:1px solid var(--line2); box-shadow:0 12px 30px rgba(0,0,0,.55);
  font-size:12px; line-height:1.35; color:var(--ink); z-index:40; transition:opacity .15s}
.lf-spec-tip .m{font-family:var(--mono); font-size:9.5px; color:var(--ink3); text-transform:uppercase; letter-spacing:.12em; display:block; margin-top:4px}

.lf-subhead{display:flex; align-items:baseline; gap:12px; margin:30px 0 14px}
.lf-subhead h3{font-family:var(--serif); font-weight:600; font-size:21px; letter-spacing:-.01em; color:var(--ink)}
.lf-subhead .ct{font-family:var(--mono); font-size:11px; color:var(--ink3); letter-spacing:.05em}
.lf-subhead .ln{flex:1; height:1px; background:linear-gradient(90deg,var(--line),transparent)}
.lf-empty{border:1px dashed var(--line2); border-radius:13px; padding:22px; text-align:center; color:var(--ink3); font-size:13px; background:rgba(20,25,37,.25)}
.lf-dawn-foot{margin-top:40px; text-align:center; font-size:11.5px; color:var(--ink4); font-family:var(--mono); letter-spacing:.03em}

/* ════ RECORD CARD ════ */
.lf-card{display:flex; gap:15px; padding:17px 19px; border:1px solid var(--line); border-radius:14px;
  background:linear-gradient(180deg,var(--surf),var(--bg2)); position:relative; overflow:hidden;
  transition:transform .28s cubic-bezier(.2,.7,.2,1), border-color .28s, box-shadow .28s}
.lf-card::before{content:''; position:absolute; left:0; top:0; bottom:0; width:2px; background:var(--accent,transparent); opacity:.0; transition:opacity .28s}
.lf-card:hover{transform:translateY(-2px); border-color:var(--line2); box-shadow:0 14px 36px rgba(0,0,0,.4), 0 0 0 1px rgba(242,200,121,.06)}
.lf-card:hover::before{opacity:.85}
.lf-card.lit{border-color:color-mix(in srgb,var(--gold) 50%,transparent); box-shadow:0 0 0 1px color-mix(in srgb,var(--gold) 30%,transparent), 0 14px 40px color-mix(in srgb,var(--gold) 10%,transparent)}
.lf-card.dense{padding:13px 17px; gap:13px}

.lf-lum{position:relative; flex-shrink:0; width:14px; display:flex; flex-direction:column; align-items:center; padding-top:4px}
.lf-orb{width:11px;height:11px;border-radius:50%; background:var(--accent); position:relative}
.lf-orb::after{content:''; position:absolute; inset:-3px; border-radius:50%; background:var(--accent); opacity:.0; filter:blur(5px)}
.lf-newdot{margin-top:8px; font-family:var(--mono); font-size:8px; letter-spacing:.1em; color:var(--gold); writing-mode:vertical-rl; text-transform:uppercase; opacity:.85}

.lf-body{min-width:0; flex:1}
.lf-rowtop{display:flex; align-items:flex-start; justify-content:space-between; gap:10px}
.lf-title{font-family:var(--sans); font-weight:600; font-size:15px; line-height:1.45; letter-spacing:-.006em; color:var(--ink); cursor:pointer; text-align:left; background:none; border:none; padding:0; transition:color .2s}
.lf-title:hover{color:var(--gold)}
.lf-card.dense .lf-title{font-size:13.5px; line-height:1.4}
.lf-meta{font-family:var(--mono); font-size:11.5px; color:var(--ink3); margin-top:7px; line-height:1.5}
.lf-meta .j{color:var(--ink2)}
.lf-tldr{display:flex; gap:8px; margin-top:10px; font-size:13px; line-height:1.55; color:var(--ink2)}
.lf-tldr svg{flex-shrink:0; margin-top:3px; color:var(--gold)}
.lf-tags{display:flex; flex-wrap:wrap; gap:7px; margin-top:13px; align-items:center}
.lf-tag{display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:7px; font-size:11px; font-weight:500;
  border:1px solid var(--tb,var(--line)); color:var(--tc,var(--ink2)); background:var(--tbg,transparent); letter-spacing:.01em}
.lf-src{margin-left:auto; font-family:var(--mono); font-size:10px; color:var(--ink4); letter-spacing:.05em}
.lf-acts{display:flex; align-items:center; gap:7px; margin-top:14px}
.lf-act{display:inline-flex; align-items:center; gap:6px; padding:6px 11px; border-radius:8px; cursor:pointer;
  border:1px solid var(--line); background:rgba(10,13,20,.4); color:var(--ink2); font-family:var(--sans); font-size:11.5px; font-weight:500;
  transition:all .2s}
.lf-act:hover:not(:disabled){border-color:var(--line2); color:var(--ink); background:var(--surf2)}
.lf-act:disabled{opacity:.35; cursor:not-allowed}
.lf-act.on{border-color:rgba(242,200,121,.5); color:var(--gold); background:rgba(242,200,121,.08)}
.lf-act.go{margin-left:auto; border:none; background:none; color:var(--peri); padding-right:0}
.lf-act.go:hover{color:#fff; background:none}

/* ════ EXPLORE ════ */
.lf-exp{display:flex; height:100%; min-height:0}
.lf-rail{width:272px; flex-shrink:0; border-right:1px solid var(--line); background:rgba(14,18,28,.5); padding:8px 6px 20px}
.lf-rail-h{display:flex; align-items:center; gap:8px; padding:10px 12px 6px; font-family:var(--mono); font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink2)}
.lf-facet{border-bottom:1px solid var(--line); margin:0 8px}
.lf-facet:last-child{border-bottom:none}
.lf-facet-h{display:flex; align-items:center; justify-content:space-between; width:100%; padding:11px 4px; cursor:pointer; border:none; background:none;
  font-family:var(--mono); font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink3); transition:color .2s}
.lf-facet-h:hover{color:var(--ink2)}
.lf-facet-h svg{transition:transform .2s}
.lf-opt-row{display:flex; align-items:center; justify-content:space-between; padding:6px 6px; border-radius:8px; cursor:pointer; font-size:13px; color:var(--ink); transition:background .15s}
.lf-opt-row:hover{background:rgba(255,255,255,.03)}
.lf-cb{display:flex; align-items:center; gap:9px}
.lf-box{width:15px;height:15px; border-radius:5px; border:1px solid var(--ink4); display:grid; place-items:center; transition:all .18s}
.lf-box.ck{background:linear-gradient(180deg,var(--gold),var(--goldDim)); border-color:transparent; box-shadow:0 0 10px rgba(242,200,121,.3)}
.lf-dot{width:8px;height:8px;border-radius:50%}
.lf-cnt{font-family:var(--mono); font-size:11px; color:var(--ink4)}
.lf-range{padding:10px 6px 4px}
.lf-range-v{display:flex; justify-content:space-between; font-family:var(--mono); font-size:11px; color:var(--ink2); margin-bottom:9px}
.lf-rng{-webkit-appearance:none; appearance:none; width:100%; height:3px; border-radius:3px; background:var(--line2); outline:none; margin:7px 0}
.lf-rng::-webkit-slider-thumb{-webkit-appearance:none; width:15px;height:15px;border-radius:50%; cursor:pointer;
  background:radial-gradient(circle at 35% 30%,var(--gold),var(--goldDim)); box-shadow:0 0 0 1px rgba(0,0,0,.3),0 0 10px rgba(242,200,121,.4)}
.lf-rng::-moz-range-thumb{width:15px;height:15px;border:none;border-radius:50%; cursor:pointer; background:var(--gold); box-shadow:0 0 8px color-mix(in srgb,var(--gold) 45%,transparent)}

.lf-main{flex:1; display:flex; flex-direction:column; min-width:0}
.lf-cmd{display:flex; align-items:center; gap:11px; padding:14px 20px; border-bottom:1px solid var(--line); background:rgba(14,18,28,.4)}
.lf-search{position:relative; flex:1}
.lf-search svg{position:absolute; left:13px; top:50%; transform:translateY(-50%); color:var(--ink3)}
.lf-search input{width:100%; padding:11px 14px 11px 38px; border-radius:11px; border:1px solid var(--line2); background:rgba(10,13,20,.6);
  color:var(--ink); font-family:var(--sans); font-size:13.5px; outline:none; transition:all .22s}
.lf-search input::placeholder{color:var(--ink4)}
.lf-search input:focus{border-color:var(--goldDim); box-shadow:0 0 0 3px rgba(242,200,121,.12)}
.lf-sel{padding:10px 12px; border-radius:10px; border:1px solid var(--line2); background:rgba(10,13,20,.6); color:var(--ink2);
  font-family:var(--sans); font-size:12.5px; outline:none; cursor:pointer}
.lf-dense{display:flex; padding:3px; border:1px solid var(--line2); border-radius:10px; background:rgba(10,13,20,.6)}
.lf-dense button{padding:7px; border:none; background:none; border-radius:7px; cursor:pointer; display:grid; place-items:center; color:var(--ink3); transition:all .2s}
.lf-dense button.on{background:rgba(242,200,121,.12); color:var(--gold)}
.lf-count{display:flex; align-items:center; justify-content:space-between; padding:11px 20px; font-size:12.5px; color:var(--ink3)}
.lf-count b{font-family:var(--mono); color:var(--ink); font-weight:700}
.lf-stream{flex:1; padding:4px 20px 22px; display:flex; flex-direction:column; gap:11px}
.lf-noresult{margin-top:60px; text-align:center; color:var(--ink3); font-size:14px}
.lf-prompt{margin:auto; max-width:440px; text-align:center; padding:48px 24px; display:flex; flex-direction:column; align-items:center; gap:14px}
.lf-prompt-ic{width:64px; height:64px; display:grid; place-items:center; border-radius:18px; color:var(--gold); background:color-mix(in srgb,var(--gold) 9%,transparent); border:1px solid color-mix(in srgb,var(--gold) 22%,transparent)}
.lf-prompt-t{font-family:var(--serif); font-size:21px; font-weight:600; color:var(--ink); letter-spacing:-.01em}
.lf-prompt-s{font-size:13px; line-height:1.7; color:var(--ink3); max-width:400px}
.lf-prompt-btn{margin-top:6px; display:inline-flex; align-items:center; gap:7px; padding:10px 18px; border-radius:11px; border:none; cursor:pointer; font-family:var(--sans); font-size:13px; font-weight:600; color:#fff; background:var(--gold); transition:filter .2s, transform .15s}
.lf-prompt-btn:hover{filter:brightness(1.08); transform:translateY(-1px)}

/* ════ DETAIL DRAWER ════ */
.lf-scrim{position:fixed; inset:0; top:34px; z-index:30; background:rgba(5,7,12,.55); backdrop-filter:blur(3px); animation:fadeIn .25s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.lf-drawer{position:fixed; top:34px; right:0; bottom:0; z-index:31; width:438px; max-width:92%;
  background:linear-gradient(180deg,#11151F,#0B0E15); border-left:1px solid var(--line2);
  box-shadow:-24px 0 60px rgba(0,0,0,.5); display:flex; flex-direction:column; animation:slideIn .34s cubic-bezier(.2,.7,.2,1)}
@keyframes slideIn{from{transform:translateX(40px); opacity:.4}to{transform:none; opacity:1}}
.lf-dh{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:20px; border-bottom:1px solid var(--line)}
.lf-dh h2{font-family:var(--serif); font-weight:600; font-size:20px; line-height:1.25; letter-spacing:-.01em}
.lf-x{border:none; background:rgba(255,255,255,.04); border-radius:8px; padding:6px; cursor:pointer; color:var(--ink2); flex-shrink:0; transition:all .2s}
.lf-x:hover{background:rgba(255,255,255,.09); color:var(--ink)}
.lf-dbody{flex:1; padding:20px}
.lf-dmeta{font-family:var(--mono); font-size:12px; color:var(--ink2); line-height:1.7}
.lf-dmeta a{color:var(--peri); text-decoration:none; display:inline-flex; align-items:center; gap:4px}
.lf-dmeta a:hover{text-decoration:underline}
.lf-lbl{font-family:var(--mono); font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink3); margin:18px 0 7px}
.lf-abs{font-size:13px; line-height:1.65; color:var(--ink2)}
.lf-panel{margin-top:20px; border:1px solid var(--line2); border-radius:14px; padding:16px; background:linear-gradient(180deg,rgba(25,32,46,.4),rgba(14,18,28,.2))}
.lf-panel-h{display:flex; align-items:center; gap:8px; font-size:13.5px; font-weight:600; color:var(--ink); margin-bottom:14px}
.lf-panel-h svg{color:var(--gold)}
.lf-orow{margin-bottom:13px}
.lf-orow .ol{font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink3); margin-bottom:7px}
.lf-segs{display:flex; flex-wrap:wrap; gap:6px}
.lf-seg{padding:6px 12px; border-radius:8px; cursor:pointer; border:1px solid var(--line2); background:rgba(10,13,20,.5);
  color:var(--ink2); font-family:var(--sans); font-size:12px; transition:all .18s}
.lf-seg:hover{border-color:var(--ink4); color:var(--ink)}
.lf-seg.on{border-color:transparent; color:#0A0D14; background:linear-gradient(180deg,var(--gold),var(--goldDim)); font-weight:600}
.lf-gen{width:100%; margin-top:4px; padding:11px; border-radius:10px; border:none; cursor:pointer;
  background:linear-gradient(180deg,var(--gold),var(--goldDim)); color:#0A0D14; font-family:var(--sans); font-weight:600; font-size:13px;
  box-shadow:0 4px 16px rgba(242,200,121,.25); transition:transform .15s}
.lf-gen:hover{transform:translateY(-1px)}
.lf-gen:active{transform:none}
.lf-out{margin-top:14px; border:1px solid var(--line2); border-radius:11px; padding:13px; background:rgba(10,13,20,.5); animation:riseIn .4s ease both}
.lf-out pre{white-space:pre-wrap; font-family:var(--sans); font-size:12.5px; line-height:1.6; color:var(--ink); margin:0}
.lf-basis{display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:7px; font-size:11px; font-weight:600}
.lf-decide{margin-top:16px; border:1px solid var(--line2); border-radius:13px; padding:14px}
.lf-decide-h{font-size:12px; font-weight:600; color:var(--ink); margin-bottom:10px}
.lf-decide-row{display:flex; gap:7px}
.lf-dbtn{flex:1; padding:9px; border-radius:9px; cursor:pointer; border:1px solid var(--line2); background:rgba(10,13,20,.5);
  color:var(--ink2); font-size:12px; font-family:var(--sans); transition:all .18s}
.lf-dbtn:hover{border-color:var(--ink4); color:var(--ink)}
.lf-dbtn.on{border-color:transparent; background:linear-gradient(180deg,var(--gold),var(--goldDim)); color:#0A0D14; font-weight:600}

mark{background:rgba(242,200,121,.18); color:var(--gold); border-radius:3px; padding:0 1px}

/* ── theme morph (circular view-transition reveal) ── */
@keyframes vtReveal{from{clip-path:circle(0% at var(--cx,50%) var(--cy,0%))}to{clip-path:circle(162% at var(--cx,50%) var(--cy,0%))}}
::view-transition-old(root){animation:none}
::view-transition-new(root){animation:vtReveal .55s cubic-bezier(.4,0,.2,1) both}
::view-transition-old(root),::view-transition-new(root){mix-blend-mode:normal}

/* ── theme toggle + kbd hint ── */
.lf-theme{display:grid; place-items:center; width:34px; height:34px; border-radius:9px; cursor:pointer; position:relative; overflow:hidden;
  border:1px solid var(--line); background:rgba(10,13,20,.4); color:var(--gold); transition:all .22s}
.lf-theme:hover{border-color:var(--line2); box-shadow:0 0 14px rgba(242,200,121,.20)}
.lf-theme svg{transition:transform .45s cubic-bezier(.34,1.4,.5,1)}
.lf-theme:hover svg{transform:rotate(28deg)}
.lf-kbd{font-family:var(--mono); font-size:10px; padding:2px 6px; border:1px solid var(--line2); border-radius:5px; color:var(--ink3); background:rgba(10,13,20,.3); white-space:nowrap}

/* ── star ignition · twinkle · today ring ── */
.lf-star{transform-box:fill-box; transform-origin:center; animation:ignite .7s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes ignite{0%{opacity:0; transform:scale(.3)}60%{opacity:1}100%{opacity:1; transform:scale(1)}}
.lf-tw{animation:twinkle 3.4s ease-in-out infinite}
@keyframes twinkle{0%,100%{opacity:var(--tw,.7)}50%{opacity:1}}
.lf-todayring{animation:todayRing 2.6s ease-out infinite}
@keyframes todayRing{0%{r:7; opacity:.55}70%{r:18; opacity:0}100%{r:18; opacity:0}}

/* ── keyboard focus ── */
.lf-card.kbd{border-color:var(--peri); box-shadow:0 0 0 1px var(--peri), 0 0 0 4px rgba(138,169,224,.16)}

/* ── streaming summary · fetch shimmer ── */
.lf-caret{display:inline-block; width:7px; height:1.02em; background:var(--gold); margin-left:1px; border-radius:1px; vertical-align:-2px; animation:blink 1.05s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.lf-prep{display:flex; align-items:center; gap:10px; font-size:12px; color:var(--ink3); font-family:var(--mono); padding:2px 0}
.lf-prep .sweep{flex:1; height:3px; border-radius:3px; background:linear-gradient(90deg,var(--line2) 0 30%,var(--gold) 50%,var(--line2) 70% 100%); background-size:220% 100%; animation:sweep 1.1s linear infinite}
@keyframes sweep{from{background-position:220% 0}to{background-position:-220% 0}}
.lf-act.loading{color:var(--gold); border-color:rgba(242,200,121,.4); background:linear-gradient(90deg,rgba(242,200,121,.04),rgba(242,200,121,.22),rgba(242,200,121,.04)); background-size:220% 100%; animation:sweep 1s linear infinite}

/* ════ DAYLIGHT THEME ════ */
.lf.day{
  --bg:#F4F4F1; --bg2:#ECECE7; --surf:#FBFBF9; --surf2:#F3F3EF;
  --line:#E2E1DA; --line2:#D2D1C8;
  --ink:#1C1E24; --ink2:#52555E; --ink3:#86887F; --ink4:#AEB0A6;
  --gold:#0E7C6F; --goldDim:#0B5F55; --peri:#3E5C92;
  --t-meta:#A9792A; --t-rct:#2C8A60; --t-cohort:#3B66B0; --t-review:#7A57B4; --t-basic:#2C8690; --t-case:#7A7E87;
  --pre:#B06F26; --ret:#BE3A2C;
}
.lf.day .lf-top{background:linear-gradient(180deg,rgba(252,251,247,.86),rgba(252,251,247,.42))}
.lf.day .lf-mark{background:radial-gradient(circle at 35% 30%,#fff,#E7E4DB); box-shadow:0 0 0 1px rgba(168,110,34,.12),0 1px 8px rgba(168,110,34,.10)}
.lf.day .lf-rail{background:rgba(233,231,222,.55)}
.lf.day .lf-cmd{background:rgba(233,231,222,.5)}
.lf.day .lf-switch{background:rgba(255,255,255,.55)}
.lf.day .lf-theme{background:rgba(255,255,255,.55)}
.lf.day .lf-theme:hover{box-shadow:0 0 14px rgba(168,110,34,.16)}
.lf.day .lf-kbd{background:rgba(255,255,255,.5)}
.lf.day .lf-segbtn.on, .lf.day .lf-seg.on, .lf.day .lf-gen, .lf.day .lf-dbtn.on, .lf.day .lf-box.ck{color:#fff}
.lf.day .lf-search input,.lf.day .lf-sel,.lf.day .lf-dense{background:rgba(255,255,255,.72)}
.lf.day .lf-search input:focus{box-shadow:0 0 0 3px rgba(168,110,34,.14)}
.lf.day .lf-seg,.lf.day .lf-act,.lf.day .lf-dbtn{background:rgba(255,255,255,.6)}
.lf.day .lf-out{background:rgba(255,255,255,.66)}
.lf.day .lf-spec{background:linear-gradient(180deg,rgba(255,255,255,.6),rgba(244,241,233,.34))}
.lf.day .lf-panel{background:linear-gradient(180deg,rgba(255,255,255,.62),rgba(244,241,233,.3))}
.lf.day .lf-empty{background:rgba(255,255,255,.45)}
.lf.day .lf-drawer{background:linear-gradient(180deg,var(--surf),var(--surf2))}
.lf.day .lf-scrim{background:rgba(58,52,40,.28)}
.lf.day .lf-x{background:rgba(0,0,0,.05)} .lf.day .lf-x:hover{background:rgba(0,0,0,.09)}
.lf.day .lf-opt-row:hover{background:rgba(0,0,0,.04)}
.lf.day .lf-card:hover{box-shadow:0 14px 34px rgba(40,44,52,.10),0 0 0 1px color-mix(in srgb,var(--gold) 14%,transparent)}
.lf.day .lf-card.lit{border-color:color-mix(in srgb,var(--gold) 45%,transparent); box-shadow:0 0 0 1px color-mix(in srgb,var(--gold) 30%,transparent),0 14px 36px color-mix(in srgb,var(--gold) 12%,transparent)}
.lf.day mark{background:rgba(168,110,34,.16); color:var(--goldDim)}
.lf.day .lf-rng{background:#CDC7B6}
.lf.day .lf-aurora{opacity:.42}
.lf.day .lf-aurora i{mix-blend-mode:multiply}
.lf.day .lf-grain{mix-blend-mode:multiply; opacity:.02}
.lf.day .lf-vignette{background:radial-gradient(120% 90% at 50% 0%,transparent 60%,rgba(120,108,84,.10))}
.lf.day ::selection{background:rgba(168,110,34,.18); color:#000}

/* ════ COMMAND PALETTE (⌘K) ════ */
.lf-cmdk-scrim{position:absolute; inset:0; z-index:50; background:rgba(5,7,12,.5); backdrop-filter:blur(4px); animation:fadeIn .18s ease; display:flex; justify-content:center; align-items:flex-start; padding-top:11vh}
.lf.day .lf-cmdk-scrim{background:rgba(58,52,40,.32)}
.lf-cmdk{width:580px; max-width:92%; max-height:62vh; display:flex; flex-direction:column; border-radius:16px; overflow:hidden;
  background:linear-gradient(180deg,#141925,#0C1018); border:1px solid var(--line2); box-shadow:0 32px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(242,200,121,.06);
  animation:cmdkIn .26s cubic-bezier(.2,.8,.2,1)}
.lf.day .lf-cmdk{background:linear-gradient(180deg,var(--surf),var(--surf2))}
@keyframes cmdkIn{from{opacity:0; transform:translateY(-12px) scale(.98)}to{opacity:1; transform:none}}
.lf-cmdk-in{display:flex; align-items:center; gap:11px; padding:15px 18px; border-bottom:1px solid var(--line)}
.lf-cmdk-in svg{color:var(--gold); flex-shrink:0}
.lf-cmdk-in input{flex:1; border:none; background:none; outline:none; color:var(--ink); font-family:var(--sans); font-size:15.5px}
.lf-cmdk-in input::placeholder{color:var(--ink4)}
.lf-cmdk-in .esc{font-family:var(--mono); font-size:10px; padding:3px 7px; border:1px solid var(--line2); border-radius:5px; color:var(--ink3)}
.lf-cmdk-list{overflow-y:auto; padding:8px}
.lf-cmdk-sec{font-family:var(--mono); font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink4); padding:10px 12px 5px}
.lf-cmdk-it{display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px; cursor:pointer; transition:background .12s}
.lf-cmdk-it .ic{width:30px; height:30px; border-radius:8px; display:grid; place-items:center; flex-shrink:0; background:rgba(255,255,255,.05); color:var(--peri); border:1px solid var(--line)}
.lf.day .lf-cmdk-it .ic{background:rgba(0,0,0,.03)}
.lf-cmdk-it.on{background:rgba(242,200,121,.10)}
.lf-cmdk-it.on .ic{color:var(--gold); border-color:rgba(242,200,121,.35)}
.lf-cmdk-it .tt{min-width:0; flex:1}
.lf-cmdk-it .t1{font-size:13.5px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.lf-cmdk-it .t2{font-family:var(--mono); font-size:10.5px; color:var(--ink3); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.lf-cmdk-it .kbd{font-family:var(--mono); font-size:10px; padding:2px 6px; border:1px solid var(--line2); border-radius:5px; color:var(--ink3)}
.lf-cmdk-it .spine{width:3px; height:26px; border-radius:3px; flex-shrink:0}
.lf-cmdk-empty{padding:30px; text-align:center; color:var(--ink3); font-size:13px}

/* ════ SKELETON (boot) ════ */
@keyframes shimmerSk{0%{background-position:-200% 0}100%{background-position:200% 0}}
.lf-sk{border-radius:8px; background:linear-gradient(90deg,var(--surf) 25%,var(--surf2) 37%,var(--surf) 63%); background-size:200% 100%; animation:shimmerSk 1.5s ease-in-out infinite}
.lf-sk-card{border:1px solid var(--line); border-radius:14px; padding:17px 19px; display:flex; gap:15px; background:linear-gradient(180deg,var(--surf),var(--bg2))}
.lf-boot-tag{display:flex; align-items:center; gap:10px; font-family:var(--mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--gold)}
.lf-boot-tag .orb{width:8px; height:8px; border-radius:50%; background:var(--gold); box-shadow:0 0 12px var(--gold); animation:pulse 1.3s ease-in-out infinite}

/* ════ TOASTS ════ */
.lf-toasts{position:absolute; left:50%; bottom:26px; z-index:60; transform:translateX(-50%); display:flex; flex-direction:column; gap:8px; align-items:center; pointer-events:none}
.lf-toast{display:flex; align-items:center; gap:9px; padding:9px 15px; border-radius:11px; font-size:12.5px; color:var(--ink);
  background:linear-gradient(180deg,#19202E,#10141D); border:1px solid var(--line2); box-shadow:0 12px 32px rgba(0,0,0,.5); animation:toastIn .3s cubic-bezier(.2,.8,.2,1)}
.lf.day .lf-toast{background:linear-gradient(180deg,var(--surf),var(--surf2)); box-shadow:0 12px 30px rgba(40,44,52,.14)}
.lf-toast svg{flex-shrink:0}
@keyframes toastIn{from{opacity:0; transform:translateY(14px) scale(.96)}to{opacity:1; transform:none}}

/* ════ CLEAR FILTERS ════ */
.lf-clear{display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:8px; cursor:pointer; border:1px solid var(--line2); background:rgba(242,200,121,.06); color:var(--gold); font-family:var(--sans); font-size:11.5px; transition:all .18s}
.lf-clear:hover{background:rgba(242,200,121,.12)}

@media (prefers-reduced-motion: reduce){
  .lf *{animation-duration:.001s !important; transition-duration:.001s !important}
  .lf-aurora{animation:none}
  .lf-aurora i{animation:none !important}
}
`;

/* ── evidence tiers → luminance color + rank ── */
const TYPE = {
  meta:   { c: "var(--t-meta)",   raw: "#F4D9A0", label: "Meta 分析", rank: 6 },
  rct:    { c: "var(--t-rct)",    raw: "#76D6AE", label: "RCT",       rank: 5 },
  cohort: { c: "var(--t-cohort)", raw: "#86A9E6", label: "队列",      rank: 4 },
  review: { c: "var(--t-review)", raw: "#C2A6EC", label: "综述",      rank: 3 },
  basic:  { c: "var(--t-basic)",  raw: "#9BD0D8", label: "基础",      rank: 2 },
  case:   { c: "var(--t-case)",   raw: "#9AA0AC", label: "病例",      rank: 1 },
};
const FIELDS = ["心血管", "肿瘤", "神经", "代谢", "基因", "AI/影像", "公卫", "方法学"];
const SOURCES = ["PubMed", "Europe PMC", "OpenAlex", "Crossref", "bioRxiv", "arXiv"];
const LANGS = ["英文", "中文"];
const OA_LABEL = { gold: "OA 金色", green: "OA 绿色", closed: "需订阅" };
const TODAY = "2026-06-26";
const days = (d) => (new Date(TODAY) - new Date(d)) / 86400000;

const PAPERS = [
  { id: "p1", field: "心血管", title: "Empagliflozin in Acute Myocardial Infarction with Preserved Ejection Fraction: A Multicenter Randomized Trial", authors: ["Hoffmann R", "Sato K", "Mensah A", "Liu Y"], journal: "New England Journal of Medicine", abbr: "N Engl J Med", year: 2026, pubDate: "2026-06-26", type: "rct", preprint: false, peer: true, retracted: false, oa: "green", cites: 0, doi: "10.1056/NEJMoa2601234", lang: "英文", source: "PubMed", n: 4120, matched: ["myocardial infarction", "randomized"], tldr: "4120 例 AMI:SGLT2i 较安慰剂降低 12 月心衰再住院,全因死亡无差异。", clinical: "可能改变实践", abstract: "Background: The role of SGLT2 inhibitors initiated during acute myocardial infarction remains uncertain. Methods: We randomly assigned 4120 patients... Results: The primary composite occurred in 9.1% vs 11.6% (HR 0.78, 95% CI 0.66-0.92). Conclusions: Early empagliflozin reduced heart-failure events without a significant effect on all-cause mortality." },
  { id: "p2", field: "神经", title: "Microglial TREM2 signaling gates synaptic pruning in a model of neuroinflammation", authors: ["Alvarez M", "Chen W", "Okafor T"], journal: "bioRxiv", abbr: "bioRxiv", year: 2026, pubDate: "2026-06-26", type: "basic", preprint: true, peer: false, retracted: false, oa: "gold", cites: 0, doi: "10.1101/2026.06.20.598123", lang: "英文", source: "bioRxiv", n: null, matched: ["microglia", "neuroinflammation"], tldr: "TREM2 缺失小鼠突触修剪受抑,提示神经免疫的突触门控作用(预印本)。", clinical: null, abstract: "Synaptic pruning by microglia shapes neural circuits. Here we show that TREM2 signaling is required for activity-dependent pruning in a murine model. These findings have not yet been peer reviewed." },
  { id: "p3", field: "代谢", title: "Efficacy and safety of GLP-1 receptor agonists for weight management: an updated systematic review and meta-analysis", authors: ["Petrova S", "Kim D", "Rossi L", "Adeyemi B", "Wang H"], journal: "The Lancet", abbr: "Lancet", year: 2026, pubDate: "2026-06-24", type: "meta", preprint: false, peer: true, retracted: false, oa: "green", cites: 3, doi: "10.1016/S0140-6736(26)01023-7", lang: "英文", source: "Europe PMC", n: null, matched: ["GLP-1", "meta-analysis"], tldr: "38 项 RCT(n=29k):GLP-1 RA 平均减重 11.2%,胃肠道不良事件多为轻中度。", clinical: "可能改变实践", abstract: "We searched MEDLINE, Embase, and CENTRAL through May 2026. Thirty-eight randomized trials (29,114 participants) were included. Pooled mean weight reduction was 11.2% (95% CI 9.8-12.6)." },
  { id: "p4", field: "AI/影像", title: "Attention-Guided Diffusion Models for Low-Dose CT Reconstruction", authors: ["Nakamura H", "Singh P", "Dubois E"], journal: "arXiv", abbr: "arXiv", year: 2026, pubDate: "2026-06-25", type: "basic", preprint: true, peer: false, retracted: false, oa: "gold", cites: 1, doi: "10.48550/arXiv.2606.14872", lang: "英文", source: "arXiv", n: null, matched: ["diffusion", "reconstruction"], tldr: "注意力引导扩散模型,低剂量 CT 重建 PSNR 较基线 +1.8dB(预印本)。", clinical: null, abstract: "We present an attention-guided diffusion framework for low-dose CT reconstruction. Code will be released. This is a preprint submitted to arXiv." },
  { id: "p5", field: "心血管", title: "Long-term outcomes after transcatheter versus surgical aortic valve replacement: a 10-year cohort", authors: ["Becker T", "Yamamoto S", "Cohen R"], journal: "JAMA Cardiology", abbr: "JAMA Cardiol", year: 2025, pubDate: "2025-11-12", type: "cohort", preprint: false, peer: true, retracted: false, oa: "closed", cites: 47, doi: "10.1001/jamacardio.2025.4471", lang: "英文", source: "PubMed", n: 6230, matched: ["aortic valve"], tldr: "10 年随访:TAVR 与 SAVR 远期死亡相当,TAVR 起搏器植入率更高。", clinical: "仅供参考", abstract: "In this observational cohort of 6230 patients followed for a median of 10 years..." },
  { id: "p6", field: "肿瘤", title: "Gut microbiome composition predicts response to anti-PD-1 therapy in melanoma", authors: ["Ferreira J", "Tan L", "Müller K", "Osei P"], journal: "Nature Medicine", abbr: "Nat Med", year: 2026, pubDate: "2026-06-23", type: "cohort", preprint: false, peer: true, retracted: false, oa: "green", cites: 5, doi: "10.1038/s41591-026-03012-4", lang: "英文", source: "OpenAlex", n: 312, matched: ["microbiome", "anti-PD-1"], tldr: "312 例黑色素瘤:特定菌群丰度与免疫治疗应答相关,或可作生物标志物。", clinical: "仅供参考", abstract: "We profiled the gut microbiome of 312 patients with advanced melanoma..." },
  { id: "p7", field: "心血管", title: "退行性二尖瓣反流经导管缘对缘修复的中国多中心注册研究", authors: ["张伟", "李静", "王磊"], journal: "中华心血管病杂志", abbr: "中华心血管病杂志", year: 2026, pubDate: "2026-06-22", type: "cohort", preprint: false, peer: true, retracted: false, oa: "closed", cites: 2, doi: "10.3760/cma.j.cn112148-20260301-00123", lang: "中文", source: "PubMed", n: 890, matched: ["二尖瓣"], tldr: "890 例注册:TEER 术后 1 年反流改善率 86%,围术期安全性良好。", clinical: "仅供参考", abstract: "本研究纳入 890 例退行性二尖瓣反流患者,经导管缘对缘修复术后随访..." },
  { id: "p8", field: "基因", title: "CRISPR base-editing corrects a pathogenic variant in patient-derived cardiomyocytes", authors: ["Ibrahim N", "Sørensen M", "Park J"], journal: "Cell", abbr: "Cell", year: 2026, pubDate: "2026-06-20", type: "basic", preprint: false, peer: true, retracted: false, oa: "green", cites: 8, doi: "10.1016/j.cell.2026.05.030", lang: "英文", source: "Europe PMC", n: null, matched: ["CRISPR", "cardiomyocytes"], tldr: "碱基编辑在患者来源心肌细胞纠正致病变异,效率 >70%,脱靶率低。", clinical: null, abstract: "Base editing offers precise correction of point mutations..." },
  { id: "p9", field: "公卫", title: "Hydroxychloroquine for prevention of COVID-19 (RETRACTED)", authors: ["Doe A", "Smith B"], journal: "Journal of Clinical Trials", abbr: "J Clin Trials", year: 2024, pubDate: "2024-03-15", type: "rct", preprint: false, peer: true, retracted: true, oa: "gold", cites: 19, doi: "10.1000/jct.2024.0099", lang: "英文", source: "PubMed", n: 540, matched: ["prevention"], tldr: "⚠ 该研究已被撤稿;结论不可引用。", clinical: null, abstract: "This article has been retracted due to concerns about data integrity." },
  { id: "p10", field: "AI/影像", title: "Machine learning for early sepsis prediction in the ICU: external validation across three health systems", authors: ["Garcia M", "Lee S", "Novak P", "Bauer F"], journal: "The Lancet Digital Health", abbr: "Lancet Digit Health", year: 2026, pubDate: "2026-06-19", type: "cohort", preprint: false, peer: true, retracted: false, oa: "gold", cites: 4, doi: "10.1016/S2589-7500(26)00088-1", lang: "英文", source: "OpenAlex", n: 18400, matched: ["machine learning", "prediction"], tldr: "跨三家系统外部验证:脓毒症预警 AUROC 0.84,但跨站点表现波动。", clinical: "仅供参考", abstract: "We externally validated a sepsis early-warning model in 18,400 ICU admissions..." },
  { id: "p11", field: "心血管", title: "Narrative review: the evolving role of SGLT2 inhibitors beyond glycemic control", authors: ["Romano A", "Hassan Y"], journal: "European Heart Journal", abbr: "Eur Heart J", year: 2025, pubDate: "2025-09-01", type: "review", preprint: false, peer: true, retracted: false, oa: "green", cites: 33, doi: "10.1093/eurheartj/ehab512", lang: "英文", source: "Crossref", n: null, matched: ["SGLT2"], tldr: "综述梳理 SGLT2i 在心衰、肾病中的机制与证据,快速建立全景。", clinical: null, abstract: "SGLT2 inhibitors have expanded well beyond glucose lowering..." },
  { id: "p12", field: "基因", title: "Single-cell atlas of the human failing heart reveals fibroblast heterogeneity", authors: ["Vogel S", "Aoki T", "Mbeki S", "Larsson E"], journal: "Nature", abbr: "Nature", year: 2026, pubDate: "2026-06-18", type: "basic", preprint: false, peer: true, retracted: false, oa: "green", cites: 11, doi: "10.1038/s41586-026-07788-2", lang: "英文", source: "OpenAlex", n: null, matched: ["single-cell", "heart"], tldr: "构建人衰竭心脏单细胞图谱,揭示成纤维细胞亚群异质性及潜在靶点。", clinical: null, abstract: "We generated a single-cell transcriptomic atlas of the human failing heart..." },
  { id: "p13", field: "心血管", title: "Telehealth-delivered cardiac rehabilitation versus center-based: a pragmatic randomized trial", authors: ["O'Brien C", "Nguyen T", "Kowalski J"], journal: "Circulation", abbr: "Circulation", year: 2026, pubDate: "2026-06-17", type: "rct", preprint: false, peer: true, retracted: false, oa: "closed", cites: 6, doi: "10.1161/CIRCULATIONAHA.126.067890", lang: "英文", source: "PubMed", n: 1240, matched: ["randomized", "rehabilitation"], tldr: "1240 例 RCT:远程心脏康复 6 分钟步行不劣于中心康复,依从性更高。", clinical: "可能改变实践", abstract: "In this pragmatic trial, 1240 patients were randomized to telehealth or center-based cardiac rehabilitation..." },
  { id: "p14", field: "公卫", title: "Association between air pollution exposure and incident atrial fibrillation: a population study", authors: ["Schmidt L", "Park H", "Diallo A"], journal: "Environmental Health Perspectives", abbr: "Environ Health Perspect", year: 2026, pubDate: "2026-06-16", type: "cohort", preprint: false, peer: true, retracted: false, oa: "gold", cites: 2, doi: "10.1289/EHP13344", lang: "英文", source: "Europe PMC", n: 410000, matched: ["air pollution"], tldr: "41 万人群:PM2.5 长期暴露与房颤发病风险升高相关(剂量-反应)。", clinical: "仅供参考", abstract: "In a cohort of 410,000 adults, long-term PM2.5 exposure was associated with incident AF..." },
  { id: "p15", field: "方法学", title: "Public understanding of preprints during health emergencies: a scoping review", authors: ["Khan R", "Olsen M"], journal: "PLOS ONE", abbr: "PLoS One", year: 2025, pubDate: "2025-08-20", type: "review", preprint: false, peer: true, retracted: false, oa: "gold", cites: 14, doi: "10.1371/journal.pone.0298765", lang: "英文", source: "Crossref", n: null, matched: ["preprint"], tldr: "分析公众对预印本的误读风险,建议科普明确标注'未经同行评议'。", clinical: null, abstract: "Preprints accelerate dissemination but pose risks of misinterpretation by lay audiences..." },
  { id: "p16", field: "心血管", title: "Colchicine for secondary prevention after myocardial infarction: an individual patient data meta-analysis", authors: ["Marchetti P", "Yoon S", "Abadi R", "Green T"], journal: "JAMA", abbr: "JAMA", year: 2026, pubDate: "2026-06-15", type: "meta", preprint: false, peer: true, retracted: false, oa: "green", cites: 7, doi: "10.1001/jama.2026.8123", lang: "英文", source: "PubMed", n: 12041, matched: ["myocardial infarction", "meta-analysis"], tldr: "IPD Meta(n=12k):低剂量秋水仙碱降低 MI 后主要心血管事件,腹泻略升。", clinical: "可能改变实践", abstract: "This individual patient data meta-analysis pooled five trials (12,041 patients)..." },
];

const SUBS = [
  { id: "s1", name: "急性心梗 · 介入与药物", hits: ["p1", "p16"], n: 2, spark: [1, 0, 2, 1, 3, 1, 2] },
  { id: "s2", name: "神经免疫 · 小胶质细胞", hits: ["p2"], n: 1, spark: [0, 1, 0, 0, 1, 0, 1] },
  { id: "s3", name: "代谢 · GLP-1 / 减重", hits: [], n: 0, spark: [2, 1, 1, 0, 1, 1, 0] },
];

const intensity = (p) => {
  const ev = TYPE[p.type].rank / 6;
  const rec = Math.max(0, 1 - days(p.pubDate) / 14);
  return Math.min(1, 0.35 + 0.4 * ev + 0.35 * rec);
};

/* ── small bits ── */
function Highlight({ text, terms }) {
  if (!terms?.length) return <>{text}</>;
  const low = terms.map((t) => t.toLowerCase());
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((p, i) => (low.includes(p.toLowerCase()) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}
const Tag = ({ children, c, bg, b, icon: Ic }) => (
  <span className="lf-tag" style={{ "--tc": c, "--tbg": bg, "--tb": b }}>{Ic && <Ic size={11} />}{children}</span>
);

/* ════ SPECTRUM (signature hero) ════ */
function Spectrum({ onHover, onOpen, litId }) {
  const W = 864, H = 178, padX = 56, padB = 34, padT = 18;
  const recent = PAPERS.filter((p) => days(p.pubDate) <= 14 && !p.retracted).sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate));
  const lanes = FIELDS;
  const laneX = (f) => padX + (lanes.indexOf(f) + 0.5) * ((W - padX - 24) / lanes.length);
  const tierY = (r) => padT + (1 - (r - 1) / 5) * (H - padT - padB);
  const [tip, setTip] = useState(null);

  return (
    <div className="lf-spec rise" style={{ position: "relative", animationDelay: "120ms" }}>
      <div className="lf-spec-head">
        <span className="lf-spec-title">★ 前沿星图 · 近 14 天</span>
        <span className="lf-spec-legend">亮度 = 证据 × 新近 · 纵轴 = 证据等级</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* tier gridlines */}
        {[6, 5, 4, 3, 2, 1].map((r) => (
          <line key={r} x1={padX - 14} x2={W - 14} y1={tierY(r)} y2={tierY(r)} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 6" />
        ))}
        {/* field labels */}
        {lanes.map((f) => (
          <text key={f} x={laneX(f)} y={H - 8} textAnchor="middle" fontFamily="'Space Mono',monospace" fontSize="9.5" fill="var(--ink3)">{f}</text>
        ))}
        {/* stars */}
        {recent.map((p, si) => {
          const x = laneX(p.field), y = tierY(TYPE[p.type].rank);
          const it = intensity(p), r = 3.4 + it * 5.2, lit = litId === p.id, coreOp = lit ? 0.95 : 0.55 + it * 0.35;
          const isToday = days(p.pubDate) <= 1;
          return (
            <g key={p.id} className="lf-star" transform={`translate(${x},${y})`} style={{ animationDelay: `${320 + si * 70}ms` }}
              onMouseEnter={() => { onHover(p.id); setTip({ p, x, y }); }}
              onMouseLeave={() => { onHover(null); setTip(null); }}
              onClick={() => onOpen(p.id)}>
              {isToday && <circle className="lf-todayring" r={7} fill="none" stroke={TYPE[p.type].raw} strokeWidth="1.2" />}
              <circle r={r + 6} fill={TYPE[p.type].raw} opacity={lit ? 0.30 : 0.13} filter="url(#glow)" />
              <circle r={r} fill={TYPE[p.type].raw} opacity={0.55 + it * 0.45} filter="url(#glow)" />
              <circle className="lf-tw" r={Math.max(1.4, r * 0.42)} fill="#fff" opacity={coreOp} style={{ "--tw": coreOp, animationDelay: `${si * 240}ms` }} />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="lf-spec-tip" style={{ left: `${(tip.x / W) * 100}%`, top: tip.y + 24, transform: "translateX(-50%)" }}>
          {tip.p.title}
          <span className="m">{TYPE[tip.p.type].label} · {tip.p.abbr} · {tip.p.pubDate}</span>
        </div>
      )}
    </div>
  );
}

/* ════ RECORD CARD ════ */
function Card({ p, dense, lit, kbd, onOpen, starred, onStar, screening, onScreen, fetched, fetching, onFetch, onHover, idx }) {
  const t = TYPE[p.type], it = intensity(p), isNew = days(p.pubDate) <= 7;
  return (
    <div data-rid={p.id} className={`lf-card rise${dense ? " dense" : ""}${lit ? " lit" : ""}${kbd ? " kbd" : ""}`} style={{ "--accent": t.c, animationDelay: `${Math.min(idx * 45, 650)}ms` }}
      onMouseEnter={() => onHover?.(p.id)} onMouseLeave={() => onHover?.(null)}>
      <div className="lf-lum">
        <span className="lf-orb" style={{ boxShadow: `0 0 ${4 + it * 12}px ${t.raw}`, opacity: 0.5 + it * 0.5 }} />
        {isNew && <span className="lf-newdot">NEW</span>}
      </div>
      <div className="lf-body">
        <div className="lf-rowtop">
          <button className="lf-title" onClick={() => onOpen(p.id)}><Highlight text={p.title} terms={p.matched} /></button>
          {p.retracted && <Tag c="var(--ret)" bg="rgba(229,134,134,.1)" b="rgba(229,134,134,.4)" icon={AlertTriangle}>撤稿</Tag>}
        </div>
        <div className="lf-meta">
          {p.authors.slice(0, 3).join(", ")}{p.authors.length > 3 ? " et al." : ""} · <span className="j">{p.abbr}</span> · {p.year}{p.n ? ` · n=${p.n.toLocaleString()}` : ""}
        </div>
        {!dense && <div className="lf-tldr"><Sparkles size={13} /><span>{p.tldr}</span></div>}
        <div className="lf-tags">
          <Tag c={t.c} b="var(--line2)">{t.label}</Tag>
          {p.preprint
            ? <Tag c="var(--pre)" bg="rgba(230,168,98,.1)" b="rgba(230,168,98,.35)" icon={AlertTriangle}>预印本 · 未评议</Tag>
            : <Tag c="var(--t-rct)" b="var(--line2)" icon={ShieldCheck}>同行评议</Tag>}
          <Tag c={p.oa === "closed" ? "var(--ink3)" : "var(--t-rct)"} b="var(--line2)">{OA_LABEL[p.oa]}</Tag>
          <Tag b="var(--line2)" icon={Quote}>{p.cites}</Tag>
          {p.clinical && <Tag c={p.clinical === "可能改变实践" ? "var(--gold)" : "var(--ink2)"} bg={p.clinical === "可能改变实践" ? "rgba(242,200,121,.08)" : "transparent"} b="var(--line2)">{p.clinical}</Tag>}
          <span className="lf-src">{p.source}</span>
        </div>
        <div className="lf-acts">
          <button className={`lf-act lf-act-ft${fetched ? " on" : ""}${fetching ? " loading" : ""}`} disabled={p.oa === "closed" || fetching} onClick={() => onFetch(p.id)}
            title={p.oa === "closed" ? "无合法 OA — 可经机构访问" : "获取合法 OA 全文 PDF"}>
            <FileDown size={13} />{fetching ? "获取中…" : fetched ? "已取全文" : p.oa === "closed" ? "经机构访问" : "获取全文"}
          </button>
          <button className={`lf-act${starred ? " on" : ""}`} onClick={() => onStar(p.id)}>
            <Star size={13} fill={starred ? "currentColor" : "none"} />收藏
          </button>
          <button className={`lf-act${screening === "pending" ? " on" : ""}`} onClick={() => onScreen(p.id, "pending")} title="加入待筛(纳入/排除始终由你决定)">
            <Inbox size={13} />{screening === "pending" ? "待筛中" : "待筛"}
          </button>
          <button className="lf-act go" onClick={() => onOpen(p.id)}>详情 <ChevronRight size={13} /></button>
        </div>
      </div>
    </div>
  );
}

/* ════ DETAIL DRAWER ════ */
const OptRow = ({ label, children }) => (<div className="lf-orow"><div className="ol">{label}</div><div className="lf-segs">{children}</div></div>);
const Seg = ({ on, onClick, children }) => <button className={`lf-seg${on ? " on" : ""}`} onClick={onClick}>{children}</button>;

function Drawer({ p, onClose, screening, onScreen }) {
  const [o, setO] = useState({ source: "prefer_fulltext", pdf: "if_oa", depth: "structured", lang: "zh" });
  const [g, setG] = useState(null);
  const [shown, setShown] = useState(0);
  const [prep, setPrep] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const t = TYPE[p.type], oaOk = p.oa !== "closed";
  const useFt = o.source === "prefer_fulltext" && oaOk && o.pdf !== "no";
  const gen = async () => {
    if (o.source === "none") return setG({ skip: true });
    if (hasBackend()) {
      setG(null); setAwaiting(true);
      try {
        const r = await bridge.summarize(p.id, o);
        setAwaiting(false);
        if (!r) return setG({ error: "生成失败：请在「设置」里配置 LLM（Claude/OpenAI/本地 Ollama）后重试。" });
        setG({ basis: r.sourceBasis, full: r.text || "(空)", banner: r.banner, groundedRatio: r.groundedRatio, model: r.model, real: true });
      } catch (e) { setAwaiting(false); setG({ error: "生成失败：" + String((e && e.message) || e) }); }
      return;
    }
    // —— 无 Electron：mock 演示 ——
    const basis = useFt ? "fulltext" : "abstract";
    const body = {
      tldr: p.tldr,
      structured: `目的:评估${p.matched[0] || "该干预"}的疗效与安全性。\n方法:${t.label}${p.n ? `,样本量 ${p.n.toLocaleString()}` : ""}。\n结果:见摘要核心数据(${basis === "fulltext" ? "已据全文提取" : "据摘要"})。\n结论:${p.tldr}\n局限:${p.preprint ? "预印本,未经同行评议;" : ""}${basis === "abstract" ? "未获全文,细节有限。" : "随访/样本详见原文。"}`,
      clinical: `临床要点:${p.clinical || "(非临床干预类)"}\n证据等级:${t.label}${p.preprint ? "(预印本,降级看待)" : ""}\n是否改变实践:${p.clinical === "可能改变实践" ? "提示可能——请结合指南与个体情况自行判断。" : "暂不足以改变实践,供参考。"}`,
      public: `通俗版:${p.tldr}\n注意:这是${p.preprint ? "一篇尚未经过同行评议的预印本" : "已发表的同行评议研究"},总结${basis === "abstract" ? "基于摘要" : "基于全文"}。`,
    }[o.depth];
    setG({ basis, full: body, bi: o.lang === "bilingual" });
  };
  useEffect(() => {
    if (!g || g.skip || g.error) return;
    setShown(0); setPrep(true);
    let iv;
    const to = setTimeout(() => {
      setPrep(false);
      iv = setInterval(() => setShown((s) => { if (s >= g.full.length) { clearInterval(iv); return s; } return Math.min(g.full.length, s + 2); }), 16);
    }, 520);
    return () => { clearTimeout(to); clearInterval(iv); };
  }, [g]);
  const streaming = g && !g.skip && shown < g.full.length;
  return (
    <>
      <div className="lf-scrim" onClick={onClose} />
      <aside className="lf-drawer">
        <div className="lf-dh">
          <h2><Highlight text={p.title} terms={[]} /></h2>
          <button className="lf-x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lf-dbody lf-scroll">
          <div className="lf-dmeta">
            {p.authors.join(", ")}<br />
            <span style={{ color: "var(--ink)" }}>{p.journal}</span> · {p.year}{p.n ? ` · n=${p.n.toLocaleString()}` : ""}<br />
            <a href={`https://doi.org/${p.doi}`} onClick={(e) => { e.preventDefault(); const u = `https://doi.org/${p.doi}`; if (window.luminaWin && window.luminaWin.openExternal) window.luminaWin.openExternal(u); else window.open(u, "_blank", "noopener"); }} style={{ cursor: "pointer" }}>doi:{p.doi} <ArrowUpRight size={12} /></a>
          </div>
          <div className="lf-tags" style={{ marginTop: 14 }}>
            <Tag c={t.c} b="var(--line2)">{t.label}</Tag>
            {p.preprint ? <Tag c="var(--pre)" bg="rgba(230,168,98,.1)" b="rgba(230,168,98,.35)" icon={AlertTriangle}>预印本 · 未评议</Tag>
              : <Tag c="var(--t-rct)" b="var(--line2)" icon={ShieldCheck}>同行评议</Tag>}
            <Tag c={p.oa === "closed" ? "var(--ink3)" : "var(--t-rct)"} b="var(--line2)">{OA_LABEL[p.oa]}</Tag>
            <Tag b="var(--line2)" icon={Quote}>{p.cites} 次被引</Tag>
            {p.retracted && <Tag c="var(--ret)" bg="rgba(229,134,134,.1)" b="rgba(229,134,134,.4)" icon={AlertTriangle}>已撤稿</Tag>}
          </div>

          <div className="lf-lbl">摘要</div>
          <p className="lf-abs">{p.abstract}</p>

          <div className="lf-panel">
            <div className="lf-panel-h"><Sparkles size={15} /> AI 总结 · 选项</div>
            <OptRow label="总结来源">
              <Seg on={o.source === "abstract_only"} onClick={() => setO({ ...o, source: "abstract_only" })}>仅标题摘要</Seg>
              <Seg on={o.source === "prefer_fulltext"} onClick={() => setO({ ...o, source: "prefer_fulltext" })}>优先全文(OA)</Seg>
              <Seg on={o.source === "none"} onClick={() => setO({ ...o, source: "none" })}>不总结</Seg>
            </OptRow>
            <OptRow label="是否获取 PDF">
              <Seg on={o.pdf === "yes"} onClick={() => setO({ ...o, pdf: "yes" })}>获取</Seg>
              <Seg on={o.pdf === "no"} onClick={() => setO({ ...o, pdf: "no" })}>不获取</Seg>
              <Seg on={o.pdf === "if_oa"} onClick={() => setO({ ...o, pdf: "if_oa" })}>仅 OA 可得时</Seg>
            </OptRow>
            <OptRow label="深度 / 风格">
              <Seg on={o.depth === "tldr"} onClick={() => setO({ ...o, depth: "tldr" })}>一句话</Seg>
              <Seg on={o.depth === "structured"} onClick={() => setO({ ...o, depth: "structured" })}>结构化</Seg>
              <Seg on={o.depth === "clinical"} onClick={() => setO({ ...o, depth: "clinical" })}>临床要点</Seg>
              <Seg on={o.depth === "public"} onClick={() => setO({ ...o, depth: "public" })}>通俗科普</Seg>
            </OptRow>
            <OptRow label="语言">
              <Seg on={o.lang === "zh"} onClick={() => setO({ ...o, lang: "zh" })}>中文</Seg>
              <Seg on={o.lang === "en"} onClick={() => setO({ ...o, lang: "en" })}>英文</Seg>
              <Seg on={o.lang === "bilingual"} onClick={() => setO({ ...o, lang: "bilingual" })}>双语</Seg>
            </OptRow>
            {o.source === "prefer_fulltext" && !oaOk && (
              <p style={{ fontSize: 11.5, color: "var(--pre)", margin: "0 0 10px" }}>该文无合法 OA → 将回退为基于摘要总结(可经机构访问获取全文)。</p>
            )}
            <button className="lf-gen" onClick={gen} disabled={streaming || prep || awaiting}>{o.source === "none" ? "(已选不总结)" : (streaming || prep || awaiting) ? "生成中…" : "生成总结"}</button>
            {awaiting && <div className="lf-prep" style={{ marginTop: 12 }}>正在调用 LLM{useFt ? " · 读取合法 OA 全文" : " · 依据摘要"}…<span className="sweep" /></div>}
            {g?.error && <p style={{ marginTop: 12, fontSize: 12, color: "var(--pre)", lineHeight: 1.5 }}>{g.error}</p>}
            {g && !g.skip && !g.error && (
              <div className="lf-out">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, flexWrap: "wrap" }}>
                  <span className="lf-basis" style={{ color: g.basis === "fulltext" ? "var(--t-rct)" : "var(--pre)", background: g.basis === "fulltext" ? "rgba(118,214,174,.12)" : "rgba(230,168,98,.12)" }}>
                    {g.basis === "fulltext" ? <ShieldCheck size={12} /> : <Layers size={12} />}{g.basis === "fulltext" ? "基于全文" : "基于摘要"}
                  </span>
                  {typeof g.groundedRatio === "number" && <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: g.groundedRatio >= 0.6 ? "var(--t-rct)" : "var(--pre)" }}>grounding {Math.round(g.groundedRatio * 100)}%</span>}
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink4)" }}>model: {g.model || "your-llm"} · 附原文,反幻觉</span>
                </div>
                {g.banner && <p style={{ fontSize: 11.5, color: "var(--pre)", margin: "0 0 8px", lineHeight: 1.5 }}>{g.banner}</p>}
                {prep ? (
                  <div className="lf-prep">{g.basis === "fulltext" ? "正在读取全文 PDF 并提炼…" : "正在依据摘要生成…"}<span className="sweep" /></div>
                ) : (
                  <pre>{g.full.slice(0, shown)}{streaming && <span className="lf-caret" />}</pre>
                )}
                {!prep && !streaming && g.bi && <p style={{ marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--line)", fontSize: 11.5, fontStyle: "italic", color: "var(--ink3)" }}>(双语模式:英文版同步生成)</p>}
              </div>
            )}
            {g?.skip && <p style={{ marginTop: 12, fontSize: 12, color: "var(--ink2)" }}>已按"不总结"——仅在列表保留该文献。</p>}
          </div>

          <div className="lf-decide">
            <div className="lf-decide-h">筛选决策 · 仅你可定，AI 不代决</div>
            <div className="lf-decide-row">
              {[["pending", "待筛"], ["kept", "纳入"], ["excluded", "排除"]].map(([s, l]) => (
                <button key={s} className={`lf-dbtn${screening === s ? " on" : ""}`} onClick={() => onScreen(p.id, s)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ════ TODAY VIEW ════ */
function Today({ subs, onOpen, onNewSub, fetched, fetching, onFetch, screening, onScreen, star, onStar, hov, setHov }) {
  const byId = (id) => PAPERS.find((p) => p.id === id);
  const list = hasBackend() ? subs : (subs && subs.length ? subs : SUBS);
  const live = hasBackend();
  const [digest, setDigest] = useState({});       // subId -> { items, loading, ran, skipped }
  const [refreshing, setRefreshing] = useState(false);
  const runOne = async (sub) => {
    setDigest((d) => ({ ...d, [sub.id]: { ...(d[sub.id] || {}), loading: true } }));
    try {
      const r = await bridge.subsRunNow(sub.id);
      const items = (r && r.digest && r.digest.items) || [];
      setDigest((d) => ({ ...d, [sub.id]: { items, loading: false, ran: true, skipped: r && r.skipped } }));
    } catch { setDigest((d) => ({ ...d, [sub.id]: { items: [], loading: false, ran: true, error: true } })); }
  };
  const runAll = async () => { setRefreshing(true); for (const s of list) { if (s.enabled !== false) await runOne(s); } setRefreshing(false); };
  useEffect(() => { if (live && list.length) runAll(); /* eslint-disable-next-line */ }, [live]);
  const liveCount = (s) => (digest[s.id]?.items?.length ?? 0);
  const totalToday = live ? list.reduce((n, s) => n + liveCount(s), 0) : list.reduce((s, x) => s + (x.n || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="lf-dawn">
      <div className="lf-eyebrow rise"><Sunrise size={13} /> 每日证据简报 · 本机生成<span className="ln" />
        {live && <button className="lf-clear" style={{ marginLeft: "auto" }} onClick={runAll} disabled={refreshing}>{refreshing ? "刷新中…" : "刷新今日"}</button>}
      </div>
      <h1 className="lf-date rise" style={{ animationDelay: "40ms" }}>6月26日<span className="dow">Friday · 2026</span></h1>
      {live && list.length === 0 ? (
        <div className="lf-emptysub rise" style={{ animationDelay: "80ms" }}>
          <p className="lf-lead" style={{ margin: "0 0 18px" }}>你还没有订阅。订阅 = 一条检索式 + 调度，每天自动把"当天新发表"的命中整理成简报推给你。</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="lf-prompt-btn" onClick={() => onNewSub && onNewSub()}><Aperture size={14} /> 新建订阅</button>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 18, lineHeight: 1.6 }}>只想检索和下载全文？这不需要订阅——切到「探索」直接搜，命中后一键取 OA 全文。</p>
        </div>
      ) : (
      <>
      <p className="lf-lead rise" style={{ animationDelay: "80ms" }}>
        {live
          ? <>截至今日，你订阅的主题共亮起 <b>{totalToday} 篇</b>新研究。下面按订阅整理——每条都标了证据来源，纳入/排除始终由你决定。</>
          : <>昨夜至今，你关注的领域亮起 <b>{totalToday} 篇</b>新研究。最亮的是一项来自 NEJM 的多中心 RCT。下面是按订阅整理的简报——每条都标了证据来源，决策权始终在你手里。</>}
      </p>

      {!live && <Spectrum onHover={setHov} onOpen={onOpen} litId={hov} />}

      {list.map((s, si) => {
        const d = live ? digest[s.id] : null;
        const cards = live ? (d?.items || []).map(digestItemToCard) : (s.hits || []).map(byId).filter(Boolean);
        const isLoading = live && d?.loading;
        return (
        <div key={s.id}>
          <div className="lf-subhead rise" style={{ animationDelay: `${180 + si * 60}ms` }}>
            <Aperture size={16} style={{ color: "var(--peri)" }} />
            <h3>{s.name}</h3><span className="ct">今日 {live ? cards.length : (s.n || 0)}</span>
            {!live && <span style={{ marginLeft: 4, opacity: 0.85 }}><Sparkline data={s.spark || [0, 0, 0, 0, 0, 0, 0]} color="var(--peri)" /></span>}
            <span className="ln" />
          </div>
          {isLoading ? (
            <div className="lf-empty rise">正在检索该订阅的当日新发表…</div>
          ) : cards.length === 0 ? (
            <div className="lf-empty rise">今日无新命中。已检索至 {live ? today : TODAY}，有新文献会自动出现在这里。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {cards.map((c, i) => (
                <Card key={c.id} p={c} idx={i} dense={false} lit={hov === c.id}
                  onOpen={onOpen} starred={star.has(c.id)} onStar={onStar}
                  screening={screening[c.id]} onScreen={onScreen} fetched={!!fetched[c.id]} fetching={!!fetching[c.id]} onFetch={onFetch}
                  onHover={setHov} />
              ))}
            </div>
          )}
        </div>
      ); })}
      <p className="lf-dawn-foot">本机休眠时，你会在下次唤醒收到补发简报 · 要真正 24/7 推到手机，需常开机器或自建小服务</p>
      </>
      )}
    </div>
  );
}

/* ════ FACET BITS ════ */
function Facet({ title, children, open: dft = true }) {
  const [open, setOpen] = useState(dft);
  return (
    <div className="lf-facet">
      <button className="lf-facet-h" onClick={() => setOpen(!open)}>{title}
        <ChevronDown size={14} style={{ transform: open ? "none" : "rotate(-90deg)" }} />
      </button>
      {open && <div style={{ paddingBottom: 10 }}>{children}</div>}
    </div>
  );
}
const Check_ = ({ label, count, ck, on, dot }) => (
  <div className="lf-opt-row" onClick={on}>
    <span className="lf-cb"><span className={`lf-box${ck ? " ck" : ""}`}>{ck && <Check size={11} color="#0A0D14" strokeWidth={3.4} />}</span>
      {dot && <span className="lf-dot" style={{ background: dot }} />}{label}</span>
    {count != null && <span className="lf-cnt">{count}</span>}
  </div>
);

/* ════ SPARKLINE (digest 7-day) ════ */
function Sparkline({ data, color }) {
  const w = 64, h = 18, max = Math.max(...data, 1);
  const bw = w / data.length;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {data.map((v, i) => {
        const bh = Math.max(1.5, (v / max) * (h - 2));
        return <rect key={i} x={i * bw + 0.5} y={h - bh} width={bw - 1.5} height={bh} rx={1}
          fill={color} opacity={i === data.length - 1 ? 0.95 : 0.32} />;
      })}
    </svg>
  );
}

/* ════ SKELETON (boot) ════ */
function Boot({ mode }) {
  if (mode === "today") return (
    <div className="lf-dawn">
      <div className="lf-boot-tag"><span className="orb" /> 正在校准观测 · 抓取今日前沿…</div>
      <div className="lf-sk" style={{ height: 58, width: 280, marginTop: 16 }} />
      <div className="lf-sk" style={{ height: 16, width: 460, marginTop: 18 }} />
      <div className="lf-sk" style={{ height: 16, width: 380, marginTop: 9 }} />
      <div className="lf-sk" style={{ height: 150, width: "100%", marginTop: 28, borderRadius: 16 }} />
      <div className="lf-sk" style={{ height: 18, width: 220, marginTop: 30 }} />
      {[0, 1].map((i) => (
        <div className="lf-sk-card" key={i} style={{ marginTop: 12 }}>
          <div className="lf-sk" style={{ width: 11, height: 40, borderRadius: 6 }} />
          <div style={{ flex: 1 }}>
            <div className="lf-sk" style={{ height: 17, width: "85%" }} />
            <div className="lf-sk" style={{ height: 12, width: "45%", marginTop: 10 }} />
            <div className="lf-sk" style={{ height: 13, width: "70%", marginTop: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="lf-exp">
      <aside className="lf-rail">
        <div className="lf-boot-tag" style={{ padding: "14px 12px" }}><span className="orb" /> 校准…</div>
        {[0, 1, 2, 3, 4, 5].map((i) => <div className="lf-sk" key={i} style={{ height: 13, width: `${70 - i * 4}%`, margin: "16px 12px" }} />)}
      </aside>
      <main className="lf-main">
        <div className="lf-cmd"><div className="lf-sk" style={{ height: 40, width: "100%", borderRadius: 11 }} /></div>
        <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 11 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="lf-sk-card" key={i}>
              <div className="lf-sk" style={{ width: 11, height: 40, borderRadius: 6 }} />
              <div style={{ flex: 1 }}>
                <div className="lf-sk" style={{ height: 17, width: `${88 - i * 5}%` }} />
                <div className="lf-sk" style={{ height: 12, width: "45%", marginTop: 10 }} />
                <div className="lf-sk" style={{ height: 13, width: "68%", marginTop: 12 }} />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

/* ════ COMMAND PALETTE ════ */
function Palette({ commands, onClose, onOpenPaper }) {
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(0);
  const inRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { inRef.current && inRef.current.focus(); }, []);
  const ql = q.trim().toLowerCase();
  const cmds = commands.filter((c) => !ql || c.label.toLowerCase().includes(ql) || (c.keywords || "").includes(ql));
  const papers = (ql ? PAPERS.filter((p) => `${p.title} ${p.authors.join(" ")} ${p.journal}`.toLowerCase().includes(ql)) : PAPERS.slice(0, 5));
  const items = [...cmds.map((c) => ({ kind: "cmd", c })), ...papers.map((p) => ({ kind: "paper", p }))];
  useEffect(() => { setCur(0); }, [q]);
  const run = (it) => { if (it.kind === "cmd") { it.c.run(); onClose(); } else { onOpenPaper(it.p.id); onClose(); } };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCur((c) => Math.min(items.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[cur] && run(items[cur]); }
  };
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector(`[data-ci="${cur}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [cur]);
  return (
    <div className="lf-cmdk-scrim" onClick={onClose}>
      <div className="lf-cmdk" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="lf-cmdk-in">
          <Command size={17} />
          <input ref={inRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="检索文献，或输入命令…" />
          <span className="esc">ESC</span>
        </div>
        <div className="lf-cmdk-list" ref={listRef}>
          {items.length === 0 && <div className="lf-cmdk-empty">无匹配。试试别的关键词。</div>}
          {cmds.length > 0 && <div className="lf-cmdk-sec">命令</div>}
          {items.map((it, i) => it.kind === "cmd" ? (
            <div key={`c${it.c.id}`} data-ci={i} className={`lf-cmdk-it${i === cur ? " on" : ""}`} onMouseEnter={() => setCur(i)} onClick={() => run(it)}>
              <span className="ic">{it.c.icon}</span>
              <div className="tt"><div className="t1">{it.c.label}</div>{it.c.sub && <div className="t2">{it.c.sub}</div>}</div>
              {it.c.kbd && <span className="kbd">{it.c.kbd}</span>}
            </div>
          ) : (
            <React.Fragment key={`p${it.p.id}`}>
              {i === cmds.length && <div className="lf-cmdk-sec">文献 · {papers.length}</div>}
              <div data-ci={i} className={`lf-cmdk-it${i === cur ? " on" : ""}`} onMouseEnter={() => setCur(i)} onClick={() => run(it)}>
                <span className="spine" style={{ background: TYPE[it.p.type].raw }} />
                <div className="tt">
                  <div className="t1" style={{ fontFamily: "var(--serif)", fontSize: 14 }}>{it.p.title}</div>
                  <div className="t2">{TYPE[it.p.type].label} · {it.p.abbr} · {it.p.year}{it.p.preprint ? " · 预印本" : ""}</div>
                </div>
                <ArrowUpRight size={14} style={{ color: "var(--ink4)" }} />
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════ TOASTS ════ */
function Toasts({ items }) {
  return (
    <div className="lf-toasts">
      {items.map((t) => (
        <div className="lf-toast" key={t.id}>
          {t.icon}<span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ════ ROOT ════ */
export default function LuminaFeedObservatory() {
  const [mode, setMode] = useState("explore");
  const [q, setQ] = useState("");
  const [sources, setSources] = useState(new Set());
  const [types, setTypes] = useState(new Set());
  const [oa, setOa] = useState(new Set());
  const [langs, setLangs] = useState(new Set());
  const [peer, setPeer] = useState(false);
  const [hideRet, setHideRet] = useState(true);
  const [yf, setYf] = useState(2020);
  const [yt, setYt] = useState(2026);
  const [sort, setSort] = useState("relevance");
  const [dense, setDense] = useState(false);
  const [sel, setSel] = useState(null);
  const [star, setStar] = useState(new Set());
  const [screen, setScreen] = useState({});
  const [fetched, setFetched] = useState({});
  const [fetching, setFetching] = useState({});
  const [hov, setHov] = useState(null);
  const [themeId, setThemeId] = useState(DEFAULT_THEME);
  const day = isLight(themeId);
  const [subs, setSubs] = useState(SUBS);
  const [subMgr, setSubMgr] = useState(false);
  const live = hasBackend();
  const [papers, setPapers] = useState(PAPERS);
  const [loading, setLoading] = useState(false);
  const [searchErr, setSearchErr] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [booting, setBooting] = useState(true);
  const [palette, setPalette] = useState(false);
  const [toasts, setToasts] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => { const t = setTimeout(() => setBooting(false), 950); return () => clearTimeout(t); }, []);

  // ── 接真实引擎：启动载入订阅 + 监听后台每日推送结果 ──
  useEffect(() => {
    if (!live) return;
    let alive = true;
    bridge.subsList().then((list) => { if (alive && list) setSubs(list); }).catch(() => {});
    const off = bridge.onDigest((res) => {
      const n = (res && (res.newCount ?? (res.digest && res.digest.items ? res.digest.items.length : 0))) || 0;
      if (n > 0) pushToast(`今日推送：${n} 篇新命中`, <Sunrise size={14} color="var(--gold)" />);
      bridge.subsList().then((l) => l && setSubs(l)).catch(() => {});
    });
    return () => { alive = false; off && off(); };
  }, [live]);

  // ── 在线检索（防抖 350ms）：仅在有检索式时才查；空查询不盲搜（否则返回无关记录）──
  useEffect(() => {
    if (!live || mode !== "explore") return;
    let alive = true;
    if (!q.trim()) { setPapers([]); setLoading(false); setSearchErr(null); return; }
    const filters = {
      sources: [...sources], types: [...types], oa: [...oa], langs: [...langs],
      peer, hideRet, yearFrom: yf, yearTo: yt,
    };
    setLoading(true); setSearchErr(null);
    const t = setTimeout(() => {
      bridge.searchOnline(q, filters)
        .then((r) => { if (!alive) return; if (r) setPapers(r.papers); })
        .catch((e) => { if (alive) setSearchErr(String((e && e.message) || e)); })
        .finally(() => { if (alive) setLoading(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [live, mode, q, yf, yt, sources, types, oa, langs, peer, hideRet]);
  const pushToast = (msg, icon) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, msg, icon }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 2200);
  };

  const tog = (set, v, setter) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); setter(n); };
  const onStar = (id) => { const has = star.has(id); tog(star, id, setStar); if (live) bridge.setState(id, { starred: !has }).catch(() => {}); pushToast(has ? "已取消收藏" : "已加入收藏", <Star size={14} fill={has ? "none" : "var(--gold)"} color="var(--gold)" />); };
  const onScreen = (id, s) => {
    const cur = screen[id]; const next = cur === s ? undefined : s;
    setScreen((m) => ({ ...m, [id]: next }));
    if (live) bridge.setState(id, { screening: next ?? "none" }).catch(() => {});   // AI 不裁判：纳入/排除永远人工落库
    if (cur !== s) pushToast(s === "pending" ? "已加入待筛" : s === "kept" ? "已标记纳入" : "已标记排除", <Inbox size={14} color="var(--peri)" />);
  };
  const onFetch = (id) => {
    const p = papers.find((x) => x.id === id);
    if (!p || p.oa === "closed" || fetching[id] || fetched[id]) return;
    setFetching((m) => ({ ...m, [id]: true }));
    if (live) {
      bridge.fetchFullText(p).then((r) => {
        setFetching((m) => ({ ...m, [id]: false }));
        if (r && r.ok) { setFetched((m) => ({ ...m, [id]: true })); pushToast("已获取合法 OA 全文", <FileDown size={14} color="var(--t-rct)" />); }
        else pushToast(r && r.reason === "no_oa" ? "无合法 OA 全文，可经机构访问" : "获取失败，请重试", <AlertTriangle size={14} color="var(--pre)" />);
      }).catch(() => { setFetching((m) => ({ ...m, [id]: false })); pushToast("获取失败，请重试", <AlertTriangle size={14} color="var(--pre)" />); });
    } else {
      setTimeout(() => { setFetching((m) => ({ ...m, [id]: false })); setFetched((m) => ({ ...m, [id]: true })); pushToast("已获取合法 OA 全文（演示）", <FileDown size={14} color="var(--t-rct)" />); }, 950);
    }
  };
  const clearFilters = () => { setSources(new Set()); setTypes(new Set()); setOa(new Set()); setLangs(new Set()); setPeer(false); setQ(""); setYf(2020); setYt(2026); };
  const activeFilters = sources.size + types.size + oa.size + langs.size + (peer ? 1 : 0) + (q ? 1 : 0) + (yf !== 2020 || yt !== 2026 ? 1 : 0);
  const doExport = async (list, format = "bibtex") => {
    if (!live) return;
    try {
      const text = await bridge.exportPapers(list.map((x) => x.id), format);
      if (!text) return pushToast("导出为空");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `lumina-export.${format === "ris" ? "ris" : format === "csv" ? "csv" : "bib"}`;
      a.click(); URL.revokeObjectURL(a.href);
      pushToast(`已导出 ${list.length} 篇 · ${format.toUpperCase()}`, <FileDown size={14} color="var(--t-rct)" />);
    } catch { pushToast("导出失败"); }
  };
  const toggleTheme = (e) => {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (e) { const x = e.clientX, y = e.clientY; document.documentElement.style.setProperty("--cx", x + "px"); document.documentElement.style.setProperty("--cy", y + "px"); }
    // 在当前亮/暗各自的默认主题间切换；细粒度选择交给 ThemePicker
    const next = isLight(themeId) ? "observatory" : "daylight";
    if (document.startViewTransition && !reduce) document.startViewTransition(() => setThemeId(next));
    else setThemeId(next);
  };

  const base = useMemo(() => papers.filter((p) => {
    if (q && !`${p.title} ${p.abstract} ${p.authors.join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (hideRet && p.retracted) return false;
    if (p.year < yf || p.year > yt) return false;
    if (sources.size && !sources.has(p.source)) return false;
    if (types.size && !types.has(p.type)) return false;
    if (oa.size && !oa.has(p.oa === "closed" ? "closed" : "oa")) return false;
    if (langs.size && !langs.has(p.lang)) return false;
    if (peer && !p.peer) return false;
    return true;
  }), [papers, q, sources, types, oa, langs, peer, hideRet, yf, yt]);

  const results = useMemo(() => {
    const r = [...base];
    if (sort === "date") r.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    else if (sort === "cites") r.sort((a, b) => b.cites - a.cites);
    else if (sort === "evidence") r.sort((a, b) => TYPE[b.type].rank - TYPE[a.type].rank);
    else r.sort((a, b) => (b.matched.length - a.matched.length) || (new Date(b.pubDate) - new Date(a.pubDate)));
    return r;
  }, [base, sort]);

  useEffect(() => { setCursor(-1); }, [q, sort, mode, sources, types, oa, langs, peer, hideRet, yf, yt]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      const tag = (e.target.tagName || "").toLowerCase(), typing = tag === "input" || tag === "select" || tag === "textarea";
      if (e.key === "Escape") { if (palette) setPalette(false); else if (sel) setSel(null); else if (typing) e.target.blur(); return; }
      if (palette || typing) return;
      if (e.key === "/") { e.preventDefault(); if (mode !== "explore") setMode("explore"); requestAnimationFrame(() => searchRef.current && searchRef.current.focus()); return; }
      if (mode !== "explore" || sel) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c < 0 ? 0 : c - 1)); }
      else if (e.key === "Enter" && cursor >= 0 && results[cursor]) { setSel(results[cursor].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, sel, results, cursor, palette]);

  useEffect(() => {
    if (cursor < 0 || !results[cursor]) return;
    const el = document.querySelector(`[data-rid="${results[cursor].id}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cursor, results]);

  const cnt = (fn) => base.reduce((m, p) => { const k = fn(p); m[k] = (m[k] || 0) + 1; return m; }, {});
  const cS = cnt((p) => p.source), cT = cnt((p) => p.type), cL = cnt((p) => p.lang);
  const cO = base.reduce((m, p) => { const k = p.oa === "closed" ? "closed" : "oa"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const selP = papers.find((p) => p.id === sel);
  const pend = Object.values(screen).filter((v) => v === "pending").length;
  const kbdId = cursor >= 0 && results[cursor] ? results[cursor].id : null;

  const commands = [
    { id: "mode-today", label: "前往 · 今日推送", sub: "每日证据简报", keywords: "today digest 今日 简报", icon: <Sunrise size={15} />, run: () => setMode("today") },
    { id: "mode-explore", label: "前往 · 探索", sub: "文献数据库", keywords: "explore search 探索 检索", icon: <Search size={15} />, run: () => setMode("explore") },
    { id: "theme", label: day ? "切换 · 夜间观测" : "切换 · 白昼阅读", sub: "明暗主题", keywords: "theme dark light 主题 明暗", icon: day ? <Moon size={15} /> : <Sun size={15} />, run: () => toggleTheme() },
    { id: "sort-date", label: "排序 · 最新发表", keywords: "sort date 排序 最新", icon: <ArrowUpDown size={15} />, run: () => { setMode("explore"); setSort("date"); } },
    { id: "sort-cites", label: "排序 · 被引最多", keywords: "sort cite 排序 被引", icon: <ArrowUpDown size={15} />, run: () => { setMode("explore"); setSort("cites"); } },
    { id: "sort-ev", label: "排序 · 证据等级", keywords: "sort evidence 排序 证据", icon: <ArrowUpDown size={15} />, run: () => { setMode("explore"); setSort("evidence"); } },
    { id: "clear", label: "清除全部筛选", keywords: "clear reset 清除 重置", icon: <X size={15} />, run: () => { setMode("explore"); clearFilters(); } },
    { id: "subs-manage", label: "管理 · 订阅与推送", sub: "新建/编辑你的文献雷达", keywords: "subscription push 订阅 推送 新建 自定义", icon: <Aperture size={15} />, run: () => setSubMgr(true) },
    { id: "settings", label: "设置 · LLM 与邮箱", sub: "配置大模型 / OA 邮箱", keywords: "settings llm 设置 模型 密钥", icon: <Settings size={15} />, run: () => setSettingsOpen(true) },
    ...(live ? [{ id: "export", label: "导出 · 当前结果 (BibTeX)", sub: "导出检索结果", keywords: "export bibtex 导出", icon: <FileDown size={15} />, run: () => doExport(results) }] : []),
    ...subs.map((s) => ({ id: "sub-" + s.id, label: "订阅 · " + s.name, sub: `今日 ${s.n || 0} 篇`, keywords: s.name, icon: <Aperture size={15} />, run: () => setMode("today") })),
  ];

  return (
    <div className={day ? "lf day" : "lf"} data-theme={themeId}>
      <style>{STYLE}</style>
      <style>{THEME_CSS}</style>
      <style>{UX_STYLE}</style>
      <TitleBar />
      <div className="lf-aurora"><i /><i /><i /></div>
      <div className="lf-grain" /><div className="lf-vignette" />

      <div className="lf-stage">
        <header className="lf-top">
          <div className="lf-brand">
            <div className="lf-mark"><Aperture size={17} /></div>
            <div><div className="lf-name">Lumina Feed</div><div className="lf-tag">The Observatory</div></div>
          </div>
          <div className="lf-switch">
            {[["today", "今日推送", Sunrise], ["explore", "探索", Search]].map(([k, l, Ic]) => (
              <button key={k} className={`lf-segbtn${mode === k ? " on" : ""}`} onClick={() => setMode(k)}><Ic size={14} />{l}</button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <SubscribeEntry count={subs.length} onClick={() => setSubMgr(true)} />
            <button className="lf-kbd" onClick={() => setPalette(true)} title="命令面板 · 检索文献与一切操作" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Command size={11} /> K
            </button>
            <div className="lf-status"><span className="lf-live" /> {live ? "已连接引擎" : "6 源 · 已同步"}</div>
            <button className="lf-theme" onClick={() => setSettingsOpen(true)} title="设置（LLM / 邮箱）" aria-label="设置"><Settings size={16} /></button>
            <ThemePicker themes={THEMES} current={themeId} onPick={setThemeId} />
          </div>
        </header>

        {booting ? (
          <div className="lf-view" key="boot"><Boot mode={mode} /></div>
        ) : mode === "today" ? (
          <div className="lf-view lf-scroll" key="today">
            <Today subs={subs} onOpen={setSel} onNewSub={() => setSubMgr(true)} fetched={fetched} fetching={fetching} onFetch={onFetch} screening={screen} onScreen={onScreen} star={star} onStar={onStar} hov={hov} setHov={setHov} />
          </div>
        ) : (
          <div className="lf-view lf-exp" key="explore">
            <aside className="lf-rail lf-scroll">
              <div className="lf-rail-h"><SlidersHorizontal size={13} /> 筛选</div>
              <Facet title="来源">{SOURCES.map((s) => <Check_ key={s} label={s} count={cS[s] || 0} ck={sources.has(s)} on={() => tog(sources, s, setSources)} />)}</Facet>
              <Facet title="年份">
                <div className="lf-range">
                  <div className="lf-range-v"><span>{yf}</span><span>{yt}</span></div>
                  <input className="lf-rng" type="range" min={2020} max={2026} value={yf} onChange={(e) => setYf(Math.min(+e.target.value, yt))} />
                  <input className="lf-rng" type="range" min={2020} max={2026} value={yt} onChange={(e) => setYt(Math.max(+e.target.value, yf))} />
                </div>
              </Facet>
              <Facet title="证据类型">
                {Object.entries(TYPE).sort((a, b) => b[1].rank - a[1].rank).map(([k, t]) =>
                  <Check_ key={k} label={t.label} dot={t.raw} count={cT[k] || 0} ck={types.has(k)} on={() => tog(types, k, setTypes)} />)}
              </Facet>
              <Facet title="获取">
                <Check_ label="开放获取(OA)" count={cO.oa || 0} ck={oa.has("oa")} on={() => tog(oa, "oa", setOa)} />
                <Check_ label="需订阅" count={cO.closed || 0} ck={oa.has("closed")} on={() => tog(oa, "closed", setOa)} />
              </Facet>
              <Facet title="语言" open={false}>{LANGS.map((l) => <Check_ key={l} label={l} count={cL[l] || 0} ck={langs.has(l)} on={() => tog(langs, l, setLangs)} />)}</Facet>
              <Facet title="质量" open={false}>
                <Check_ label="仅同行评议" ck={peer} on={() => setPeer(!peer)} />
                <Check_ label="隐藏已撤稿" ck={hideRet} on={() => setHideRet(!hideRet)} />
              </Facet>
            </aside>

            <main className="lf-main">
              <div className="lf-cmd">
                <div className="lf-search"><Search size={15} />
                  <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="检索标题 / 摘要 / 作者…   高级:布尔 + 字段 + MeSH" />
                </div>
                <select className="lf-sel" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="relevance">相关度</option><option value="date">最新</option><option value="cites">被引</option><option value="evidence">证据等级</option>
                </select>
                <div className="lf-dense">
                  <button className={!dense ? "on" : ""} onClick={() => setDense(false)} title="舒适"><Rows3 size={15} /></button>
                  <button className={dense ? "on" : ""} onClick={() => setDense(true)} title="紧凑"><List size={15} /></button>
                </div>
              </div>
              <div className="lf-count">
                <span>{loading ? <span style={{ color: "var(--gold)" }}>检索中…</span> : (live && !q.trim()) ? <span style={{ color: "var(--ink3)" }}>输入检索式开始</span> : <><b>{results.length}</b> 篇结果{q && ` · "${q}"`}</>}</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {live && results.length > 0 && <button className="lf-clear" onClick={() => doExport(results)} title="导出当前结果"><FileDown size={12} />导出</button>}
                  {activeFilters > 0 && <button className="lf-clear" onClick={clearFilters}><X size={12} />清除筛选 {activeFilters}</button>}
                  {pend > 0 && <Tag c="var(--gold)" bg="rgba(242,200,121,.08)" b="var(--line2)" icon={Inbox}>待筛 {pend}</Tag>}
                  {star.size > 0 && <Tag c="var(--gold)" bg="rgba(242,200,121,.08)" b="var(--line2)" icon={Star}>收藏 {star.size}</Tag>}
                </span>
              </div>
              <div className="lf-stream lf-scroll">
                {searchErr
                  ? <div className="lf-noresult">检索出错：{searchErr}<br /><span style={{ fontSize: 12 }}>请检查网络或稍后重试。</span></div>
                  : live && !q.trim()
                  ? <div className="lf-prompt">
                      <div className="lf-prompt-ic"><Search size={26} /></div>
                      <div className="lf-prompt-t">检索文献，获取合法全文</div>
                      <div className="lf-prompt-s">输入标题 / 关键词 / 作者，跨 PubMed · Europe PMC · OpenAlex · Crossref · arXiv · bioRxiv 聚合检索。<br />命中后可一键获取开放获取(OA)全文 PDF，或生成带依据的 AI 总结。</div>
                      <button className="lf-prompt-btn" onClick={() => searchRef.current && searchRef.current.focus()}><Search size={14} /> 开始检索</button>
                    </div>
                  : loading && results.length === 0
                  ? <div className="lf-noresult">正在向 PubMed / Europe PMC / OpenAlex 等检索…</div>
                  : results.length === 0
                  ? <div className="lf-noresult">{live ? "未检索到文献。换个检索式，或放宽筛选。" : "没有匹配的文献。"}<br /><button className="lf-clear" style={{ marginTop: 12 }} onClick={clearFilters}><X size={12} />清除全部筛选</button></div>
                  : results.map((p, i) => (
                    <Card key={p.id} p={p} idx={i} dense={dense} lit={hov === p.id} kbd={kbdId === p.id} onOpen={setSel}
                      starred={star.has(p.id)} onStar={onStar} screening={screen[p.id]} onScreen={onScreen}
                      fetched={!!fetched[p.id]} fetching={!!fetching[p.id]} onFetch={onFetch} onHover={setHov} />
                  ))}
              </div>
            </main>
          </div>
        )}
      </div>

      {selP && <Drawer key={selP.id} p={selP} onClose={() => setSel(null)} screening={screen[selP.id]} onScreen={onScreen} />}
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} onOpenPaper={(id) => { setSel(id); }} />}
      <SubscriptionManager
        open={subMgr}
        subs={subs}
        onClose={() => setSubMgr(false)}
        onSave={(s) => {
          setSubs((list) => list.some((x) => x.id === s.id) ? list.map((x) => x.id === s.id ? s : x) : [...list, s]);
          if (live) bridge.subsSave(s).then(() => bridge.subsRunNow(s.id)).catch(() => {});
          pushToast("订阅已保存", <Check size={14} color="var(--t-rct)" />);
        }}
        onDelete={(id) => { setSubs((list) => list.filter((x) => x.id !== id)); if (live) bridge.subsRemove(id).catch(() => {}); pushToast("订阅已删除"); }}
      />
      <SettingsPanel open={settingsOpen} api={live ? bridge : null} onClose={() => setSettingsOpen(false)} onSaved={() => pushToast("设置已保存", <Check size={14} color="var(--t-rct)" />)} />
      <Toasts items={toasts} />
    </div>
  );
}
