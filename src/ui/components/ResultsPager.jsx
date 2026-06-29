// src/ui/components/ResultsPager.jsx
// 结果分页（客户端，作用于本次检索已取的合并去重结果）。范围护栏：
//   · 计数为「本次检索 N 篇」——已取的合并去重数，**不是数据库命中总数**（lookup，非 corpus search）。
//   · 无深分页/跳第 500 页：集合有界，没有"更多页可翻"的语料库。结果偏深→提示缩小检索，而非翻更深。
//   · 选中页 = 实心 petrol + 白字（doc 03 §2）。
import React from "react";
import { pageCount, rangeLabel, pageWindow } from "../lib/paginate.js";
import PopoverSelect from "./PopoverSelect.jsx";

const SIZES = [10, 20, 50];
const SIZE_OPTS = SIZES.map((s) => ({ id: s, label: String(s) }));

export default function ResultsPager({ total, page, pageSize = 20, onPage, onPageSize, onRefine }) {
  const count = pageCount(total, pageSize);
  if (!total) return null;
  const { from, to } = rangeLabel(page, pageSize, total);
  const win = pageWindow(page, count, 1);
  const go = (p) => { if (p >= 1 && p <= count && p !== page) onPage && onPage(p); };
  const deep = page >= 4 || count >= 6;   // lookup 提示：翻到后面通常该缩小检索

  return (
    <nav className="lf-pager" role="navigation" aria-label="检索结果分页">
      <div className="lf-pager-row">
        <button className="lf-pg first" onClick={() => go(1)} disabled={page <= 1} aria-label="第一页">«</button>
        <button className="lf-pg prev" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="上一页">‹ 上一页</button>
        <div className="lf-pg-nums">
          {win.map((n, i) => n === "…"
            ? <span key={"e" + i} className="lf-pg-gap" aria-hidden="true">…</span>
            : <button key={n} className={"lf-pg num" + (n === page ? " on" : "")}
                      aria-current={n === page ? "page" : undefined}
                      aria-label={`第 ${n} 页`} onClick={() => go(n)}>{n}</button>)}
        </div>
        <button className="lf-pg next" onClick={() => go(page + 1)} disabled={page >= count} aria-label="下一页">下一页 ›</button>
        <button className="lf-pg last" onClick={() => go(count)} disabled={page >= count} aria-label="最后一页">»</button>
      </div>

      <div className="lf-pager-meta">
        <span className="lf-pg-range">
          第 <b>{from}–{to}</b> 项 · 共 {total} 篇
          <span className="lf-pg-q" title="本次检索已取的合并去重结果数，不是数据库命中总数。开放学术源按相关性返回有界结果（lookup）。">本次检索</span>
        </span>
        <PopoverSelect
          className="lf-pg-size"
          label="每页"
          value={pageSize}
          options={SIZE_OPTS}
          onChange={(v) => onPageSize && onPageSize(Number(v))}
          ariaLabel="每页结果数"
          align="right"
          menuMinWidth={96}
        />
      </div>

      {deep && (
        <p className="lf-pager-refine">
          翻到后面没找到？这是「定位一篇」而非全库浏览——
          <button type="button" className="lf-refine-link" onClick={() => onRefine && onRefine()}>缩小关键词或换检索字段</button>
          ，通常比翻更多页更快。
        </p>
      )}
    </nav>
  );
}
