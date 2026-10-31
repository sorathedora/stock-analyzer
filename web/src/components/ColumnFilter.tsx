import { useEffect, useRef, useState } from "react";
import { BY_KEY, VISUAL } from "../data/columns";
import { format, isNum } from "../data/format";
import type { Company } from "../data/store";

export interface ColFilter { min?: number; max?: number; text?: string }
export type Filters = Record<string, ColFilter>;

/** Visual columns filter on the number they draw. */
export const FILTER_KEY: Record<string, string> = { spark: "ret_1y", range: "pct_from_52w_high" };
const TEXT_KEYS = new Set(["name", "industry"]);

export const filterKey = (k: string) => FILTER_KEY[k] ?? k;
export const isTextFilter = (k: string) => TEXT_KEYS.has(k);

export function filterLabel(k: string) {
  if (k === "name") return "Company";
  if (k === "industry") return "Industry";
  return BY_KEY[k]?.short ?? BY_KEY[k]?.label ?? (VISUAL as Record<string, string>)[k] ?? k;
}

export function passes(c: Company, filters: Filters | undefined) {
  if (!filters) return true;
  for (const [k, f] of Object.entries(filters)) {
    if (isTextFilter(k)) {
      if (!f.text) continue;
      const s = f.text.toLowerCase();
      const hay = k === "name" ? `${c.short} ${c.ticker} ${c.isin}` : String(c.industry ?? "");
      if (!hay.toLowerCase().includes(s)) return false;
      continue;
    }
    if (f.min === undefined && f.max === undefined) continue;
    const v = c[k];
    if (!isNum(v)) return false; // a blank value can't satisfy a range
    if (f.min !== undefined && v < f.min) return false;
    if (f.max !== undefined && v > f.max) return false;
  }
  return true;
}

export function describe(k: string, f: ColFilter) {
  if (isTextFilter(k)) return `${filterLabel(k)} contains “${f.text}”`;
  const fmt = (v: number) => format(v, BY_KEY[k]?.format ?? "ratio").replace("+", "");
  if (f.min !== undefined && f.max !== undefined) return `${filterLabel(k)} ${fmt(f.min)} to ${fmt(f.max)}`;
  if (f.min !== undefined) return `${filterLabel(k)} ≥ ${fmt(f.min)}`;
  return `${filterLabel(k)} ≤ ${fmt(f.max!)}`;
}

export function FilterIcon({ on }: { on: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" style={{ display: "block" }}>
      <path d="M2 3h12l-4.6 5.4V13l-2.8 1V8.4z" fill={on ? "var(--accent)" : "none"} stroke={on ? "var(--accent)" : "currentColor"} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Popover to set one column's filter. */
export function FilterPopover({ k, at, value, values, onApply, onClose }: {
  k: string; at: { x: number; y: number }; value?: ColFilter; values: number[];
  onApply: (f: ColFilter | null) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [min, setMin] = useState(value?.min?.toString() ?? "");
  const [max, setMax] = useState(value?.max?.toString() ?? "");
  const [text, setText] = useState(value?.text ?? "");
  const [err, setErr] = useState("");
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [onClose]);

  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const col = BY_KEY[k];
  const apply = () => {
    if (isTextFilter(k)) { onApply(text.trim() ? { text: text.trim() } : null); return; }
    const a = min.trim() === "" ? undefined : Number(min), b = max.trim() === "" ? undefined : Number(max);
    if ((a !== undefined && !Number.isFinite(a)) || (b !== undefined && !Number.isFinite(b))) { setErr("Enter numbers only"); return; }
    if (a !== undefined && b !== undefined && a > b) { setErr("Minimum is above maximum"); return; }
    onApply(a === undefined && b === undefined ? null : { min: a, max: b });
  };
  const left = Math.min(at.x, window.innerWidth - 290);

  return (
    <div ref={ref} className="menu" role="dialog" aria-label={`Filter ${filterLabel(k)}`} style={{ position: "fixed", left, top: at.y + 6, width: 280, padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{filterLabel(k)}</div>
      {col?.help && <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{col.help}</div>}
      <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
        {isTextFilter(k) ? (
          <input className="input" style={{ width: "100%" }} autoFocus placeholder={k === "name" ? "Name, symbol or ISIN" : "e.g. bank, pharma"} value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ flex: 1 }}><span className="muted" style={{ fontSize: 12 }}>Min</span>
                <input className="input num" style={{ width: "100%" }} autoFocus inputMode="decimal" value={min} onChange={(e) => { setMin(e.target.value); setErr(""); }} placeholder="any" /></label>
              <label style={{ flex: 1 }}><span className="muted" style={{ fontSize: 12 }}>Max</span>
                <input className="input num" style={{ width: "100%" }} inputMode="decimal" value={max} onChange={(e) => { setMax(e.target.value); setErr(""); }} placeholder="any" /></label>
            </div>
            {sorted.length > 4 && (
              <div className="muted num" style={{ fontSize: 12, marginTop: 8 }}>
                In this list: low {format(sorted[0], col?.format ?? "ratio")} · median {format(q(0.5), col?.format ?? "ratio")} · high {format(sorted[sorted.length - 1], col?.format ?? "ratio")}
                {col?.format === "signed" || col?.format === "pct" ? " (enter percentages as plain numbers, e.g. 15)" : ""}
              </div>
            )}
            {err && <div style={{ color: "var(--down)", fontSize: 12, marginTop: 6 }}>{err}</div>}
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          {value && <button type="button" className="btn" onClick={() => onApply(null)}>Clear</button>}
          <button type="submit" className="btn primary">Apply</button>
        </div>
      </form>
    </div>
  );
}
