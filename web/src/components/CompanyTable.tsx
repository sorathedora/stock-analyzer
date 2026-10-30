import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { BY_KEY, VISUAL } from "../data/columns";
import type { Company, Dataset } from "../data/store";
import { Cell, cellAlign } from "./Cell";

export type Sort = { key: string; dir: 1 | -1 };

const ROW = 44;

function sortValue(c: Company, key: string, d: Dataset): number | string | null {
  if (key === "name") return c.short.toLowerCase();
  if (key === "spark") { const s = d.sparks[c.isin]; return s && s.length > 1 ? s[s.length - 1] / s[0] - 1 : null; }
  if (key === "range") return typeof c.pct_from_52w_high === "number" ? c.pct_from_52w_high : null;
  const v = c[key];
  return typeof v === "number" || typeof v === "string" ? v : typeof v === "boolean" ? Number(v) : null;
}

export function sortRows(rows: Company[], sort: Sort, d: Dataset) {
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key, d), y = sortValue(b, sort.key, d);
    if (x === null && y === null) return 0;
    if (x === null) return 1;      // blanks always last
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
}

interface Props {
  d: Dataset;
  rows: Company[];
  columns: string[];
  sort: Sort;
  onSort: (s: Sort) => void;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  cursor: string | null;
  onOpen: (isin: string) => void;
  onRemove?: (isin: string) => void;
  empty?: React.ReactNode;
}

export function CompanyTable({ d, rows, columns, sort, onSort, selected, onSelect, cursor, onOpen, onRemove, empty }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => wrap.current, estimateSize: () => ROW, overscan: 14 });

  // Keep the keyboard cursor in view.
  useEffect(() => {
    const i = rows.findIndex((r) => r.isin === cursor);
    if (i >= 0) v.scrollToIndex(i, { align: "auto" });
  }, [cursor, rows, v]);

  const template = useMemo(() => `minmax(250px, 300px) ${columns.map(() => "auto").join(" ")}`, [columns]);
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.isin));
  const toggle = (isin: string) => {
    const next = new Set(selected);
    if (next.has(isin)) next.delete(isin); else next.add(isin);
    onSelect(next);
  };
  const head = (key: string, label: string, help?: string, cls = "") => (
    <div
      key={key}
      role="columnheader"
      className={`cell head ${cls} ${sort.key === key ? "sorted" : ""}`}
      data-tip={help}
      onClick={() => onSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 })}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {label}
      {sort.key === key && <span aria-hidden="true">{sort.dir === 1 ? "↑" : "↓"}</span>}
    </div>
  );

  const items = v.getVirtualItems();
  const before = items.length ? items[0].start : 0;
  const after = items.length ? v.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div className={`tablewrap ${scrolled ? "scrolled" : ""}`} ref={wrap} onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
      <div className="grid" role="table" aria-rowcount={rows.length} style={{ gridTemplateColumns: template }}>
        <div className="row" role="row">
          <div className="cell head l stick" role="columnheader">
            <span
              className={`cb ${allOn ? "on" : ""}`}
              role="checkbox"
              aria-checked={allOn}
              aria-label="Select all"
              onClick={(e) => { e.stopPropagation(); onSelect(allOn ? new Set() : new Set(rows.map((r) => r.isin))); }}
            />
            <span style={{ marginLeft: 10 }} onClick={() => onSort({ key: "name", dir: sort.key === "name" && sort.dir === 1 ? -1 : 1 })}>
              Company {sort.key === "name" && (sort.dir === 1 ? "↑" : "↓")}
            </span>
          </div>
          {columns.map((k) => {
            const col = BY_KEY[k];
            const label = k in VISUAL ? VISUAL[k as keyof typeof VISUAL] : col?.short ?? col?.label ?? k;
            return head(k, label, col?.help, cellAlign(k));
          })}
        </div>
        {before > 0 && <div style={{ gridColumn: "1 / -1", height: before }} />}
        {items.map((it) => {
          const c = rows[it.index];
          return (
            <div
              key={c.isin}
              role="row"
              className={`row ${selected.has(c.isin) ? "sel" : ""} ${cursor === c.isin ? "cursor" : ""}`}
              onClick={() => onOpen(c.isin)}
              style={{ cursor: "pointer" }}
            >
              <div className="cell l stick" role="cell">
                <div className="co" style={{ width: "100%" }}>
                  <span
                    className={`cb ${selected.has(c.isin) ? "on" : ""}`}
                    role="checkbox"
                    aria-checked={selected.has(c.isin)}
                    aria-label={`Select ${c.short}`}
                    onClick={(e) => { e.stopPropagation(); toggle(c.isin); }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="n">{c.short}{!c.active && <span className="muted" style={{ fontWeight: 400 }}> · inactive</span>}</div>
                    <div className="s"><span className="mono">{c.ticker}</span>{c.industry ? ` · ${c.industry}` : ""}</div>
                  </div>
                  {onRemove && (
                    <span className="rowact">
                      <button className="btn ghost sm" data-tip="Remove from this watchlist" aria-label={`Remove ${c.short}`}
                        onClick={(e) => { e.stopPropagation(); onRemove(c.isin); }}>✕</button>
                    </span>
                  )}
                </div>
              </div>
              {columns.map((k) => (
                <div key={k} role="cell" className={`cell ${cellAlign(k)}`}><Cell k={k} c={c} d={d} /></div>
              ))}
            </div>
          );
        })}
        {after > 0 && <div style={{ gridColumn: "1 / -1", height: after }} />}
      </div>
      {rows.length === 0 && empty}
    </div>
  );
}
