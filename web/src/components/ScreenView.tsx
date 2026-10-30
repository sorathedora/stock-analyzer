import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BY_KEY, PRESETS, VISUAL } from "../data/columns";
import { format } from "../data/format";
import type { Company, Dataset } from "../data/store";
import { CompanyTable, sortRows, type Sort } from "./CompanyTable";
import { ColumnPicker } from "./Dialogs";
import { QueryBar, useQuery } from "./QueryBar";
import { QuickView } from "./QuickView";
import { AddToWatchlist } from "./AddToWatchlist";

const FROM_FILINGS = new Set([
  "pb", "ev_cr", "eps_ttm", "roe_pct", "ebitda_margin_q_pct", "net_margin_q_pct", "debt_to_equity", "current_ratio",
  "free_cash_flow_ytd_cr", "revenue_q_cr", "net_profit_q_cr", "book_value_cr", "debt_cr", "cash_cr", "latest_quarter",
  "promoter_pct", "promoter_pct_change", "fii_pct", "fii_pct_change", "dii_pct", "public_pct", "promoter_pledged_pct",
]);

export interface ViewState { preset: string; columns: string[]; query: string; sort: Sort }

export const defaultView = (): ViewState => ({ preset: "Overview", columns: PRESETS.Overview, query: "", sort: { key: "market_cap_cr", dir: -1 } });

function toCsv(rows: Company[], columns: string[]) {
  const cols = ["name", "nse_symbol", "bse_code", "isin", "industry", ...columns.filter((k) => !(k in VISUAL))];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((k) => esc(BY_KEY[k]?.label ?? k)).join(",");
  return [head, ...rows.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ScreenView({ d, title, meta, rows, view, onView, onRemove, actions, empty, exportName }: {
  d: Dataset;
  title: React.ReactNode;
  meta?: React.ReactNode;
  rows: Company[];
  view: ViewState;
  onView: (v: ViewState) => void;
  onRemove?: (isins: string[]) => void;
  actions?: React.ReactNode;
  empty?: React.ReactNode;
  exportName: string;
}) {
  const nav = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const { compiled, error } = useQuery(view.query);

  const shown = useMemo(() => sortRows(rows.filter((r) => compiled.test(r)), view.sort, d), [rows, compiled, view.sort, d]);

  // Drop selections that are no longer visible.
  useEffect(() => {
    setSelected((s) => { const keep = new Set([...s].filter((i) => shown.some((r) => r.isin === i))); return keep.size === s.size ? s : keep; });
  }, [shown]);

  const openRow = (isin: string) => { setCursor(isin); setOpen(isin); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = shown.findIndex((r) => r.isin === cursor);
      const moveTo = (i: number) => {
        const r = shown[Math.max(0, Math.min(shown.length - 1, i))];
        if (!r) return;
        setCursor(r.isin);
        if (open) setOpen(r.isin);
      };
      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); moveTo(idx + 1); break;
        case "k": case "ArrowUp": e.preventDefault(); moveTo(idx - 1); break;
        case "Enter": if (cursor) { e.preventDefault(); if (open) nav(`/c/${encodeURIComponent(d.byIsin.get(cursor)!.ticker)}`); else setOpen(cursor); } break;
        case "Escape": if (open) setOpen(null); else if (selected.size) setSelected(new Set()); break;
        case "x": case " ":
          if (cursor) { e.preventDefault(); const n = new Set(selected); if (n.has(cursor)) n.delete(cursor); else n.add(cursor); setSelected(n); }
          break;
        case "/": e.preventDefault(); document.querySelector<HTMLInputElement>(".query input")?.focus(); break;
        case "w": document.querySelector<HTMLButtonElement>(".drawer.open [data-add-watchlist]")?.click(); break;
        case "c": if (selected.size >= 2) nav(`/compare?i=${[...selected].join(",")}`); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, cursor, open, selected, nav, d]);

  const setPreset = (p: string) => onView({ ...view, preset: p, columns: p === "Custom" ? view.columns : PRESETS[p] });
  // Ratios that need the company's results are empty until it files them.
  const fromFilings = view.columns.filter((k) => FROM_FILINGS.has(k));
  const filed = rows.filter((r) => r.latest_quarter || r.balance_sheet_date || r.shareholding_as_of).length;
  const sel = [...selected];
  const medianOf = (k: string) => {
    const v = shown.map((r) => r[k]).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : null;
  };

  return (
    <div className="main" style={{ height: "100%" }}>
      <div className="top">
        <h1>{title}</h1>
        {meta && <span className="meta">{meta}</span>}
        <div className="right">{actions}</div>
      </div>
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Column presets">
          {[...Object.keys(PRESETS), "Custom"].map((p) => (
            <button key={p} role="tab" aria-selected={view.preset === p} className={view.preset === p ? "on" : ""}
              onClick={() => (p === "Custom" ? setPicker(true) : setPreset(p))}>{p}</button>
          ))}
        </div>
        <button className="btn" onClick={() => setPicker(true)} data-tip="Choose and order columns">Columns</button>
        <QueryBar value={view.query} onChange={(q) => onView({ ...view, query: q })} count={shown.length} total={rows.length} error={error} />
        <button className="btn" onClick={() => download(`${exportName}.csv`, toCsv(shown, view.columns))} data-tip="Download what you see as CSV (opens in Excel)">Export</button>
      </div>
      {fromFilings.length > 0 && filed < rows.length * 0.8 && (
        <div className="banner" style={{ margin: "0 20px 10px" }}>
          {fromFilings.map((k) => BY_KEY[k]?.short ?? BY_KEY[k]?.label).join(", ")} come from each company's own filings with NSE (results and shareholding).
          They're on file for <b>{filed.toLocaleString("en-IN")} of {rows.length.toLocaleString("en-IN")}</b> companies here so far.
          New filings are collected every 10 minutes; most companies file their September-quarter results by 14 November.
        </div>
      )}
      <CompanyTable
        d={d} rows={shown} columns={view.columns} sort={view.sort} onSort={(s) => onView({ ...view, sort: s })}
        selected={selected} onSelect={setSelected} cursor={cursor} onOpen={openRow}
        onRemove={onRemove ? (i) => onRemove([i]) : undefined}
        empty={rows.length === 0 ? empty : (
          <div className="empty"><h3>No companies match</h3>Try loosening the filter <code className="mono">{view.query}</code>.</div>
        )}
      />
      {shown.length > 0 && (
        <div className="muted num" style={{ padding: "0 20px 10px", fontSize: 12, marginTop: -12 }}>
          Median of {shown.length.toLocaleString("en-IN")} shown · PE {format(medianOf("pe"), "ratio")} · 1Y {format(medianOf("ret_1y"), "signed")} · Div yield {format(medianOf("dividend_yield_pct"), "pct")}
          <span style={{ float: "right" }}><kbd>J</kbd> <kbd>K</kbd> move · <kbd>Enter</kbd> open · <kbd>X</kbd> select · <kbd>/</kbd> filter · <kbd>⌘K</kbd> search</span>
        </div>
      )}
      <div className={`tray ${sel.length >= 1 ? "show" : ""}`}>
        <span>{sel.length} selected</span>
        {sel.length >= 2 && <button className="btn" onClick={() => nav(`/compare?i=${sel.join(",")}`)}>Compare <kbd>C</kbd></button>}
        <AddToWatchlist isins={sel} />
        {onRemove && <button className="btn" onClick={() => { onRemove(sel); setSelected(new Set()); }}>Remove</button>}
        <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
      </div>
      <QuickView d={d} isin={open} onClose={() => setOpen(null)} onPick={openRow} />
      {picker && <ColumnPicker columns={view.columns} onChange={(c) => onView({ ...view, preset: "Custom", columns: c })} onClose={() => setPicker(false)} />}
    </div>
  );
}
