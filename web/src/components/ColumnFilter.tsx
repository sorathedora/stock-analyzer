import { useEffect, useMemo, useRef, useState } from "react";
import { BY_KEY, COLUMNS, VISUAL } from "../data/columns";
import { crore, format, isNum } from "../data/format";
import type { Company } from "../data/store";

/** One filter: a numeric range, a text match, a set of allowed values, or a quick toggle. */
export interface ColFilter { min?: number; max?: number; text?: string; any?: string[]; on?: boolean }
export type Filters = Record<string, ColFilter>;

/** Visual columns filter on the number they draw. */
export const FILTER_KEY: Record<string, string> = { spark: "ret_1y", range: "pct_from_52w_high" };
export const filterKey = (k: string) => FILTER_KEY[k] ?? k;
const TEXT_KEYS = new Set(["name"]);
const SET_KEYS = new Set(["industry", "sector"]);
export const isTextFilter = (k: string) => TEXT_KEYS.has(k);
export const isSetFilter = (k: string) => SET_KEYS.has(k);

/** One-click filters. Each is a plain rule anyone can read in its tooltip. */
export const QUICK: Record<string, { label: string; help: string; test: (c: Company) => boolean }> = {
  "q:profitable": { label: "Profitable", help: "Positive earnings per share", test: (c) => isNum(c.eps) && c.eps > 0 },
  "q:debtfree": { label: "Debt-free", help: "Debt to equity below 0.1", test: (c) => isNum(c.debt_to_equity) && c.debt_to_equity < 0.1 },
  "q:cheap": { label: "PE below industry", help: "PE lower than its industry's median PE", test: (c) => isNum(c.pe) && isNum(c.industry_pe) && c.pe < c.industry_pe },
  "q:quality": { label: "ROE above 15%", help: "Return on equity of 15% or more", test: (c) => isNum(c.roe_pct) && c.roe_pct >= 15 },
  "q:dividend": { label: "Pays dividend", help: "Paid a dividend in the last year", test: (c) => isNum(c.dividend_yield_pct) && c.dividend_yield_pct > 0 },
  "q:nearhigh": { label: "Near 52-week high", help: "Within 5% of its 52-week high", test: (c) => isNum(c.pct_from_52w_high) && c.pct_from_52w_high >= -5 },
};

/** Ready-made ranges per metric. */
const PRESETS: Record<string, [string, ColFilter][]> = {
  market_cap_cr: [["Large cap", { min: 20000 }], ["Mid cap", { min: 5000, max: 20000 }], ["Small cap", { min: 500, max: 5000 }], ["Micro cap", { max: 500 }]],
  pe: [["Under 15", { max: 15 }], ["15 to 25", { min: 15, max: 25 }], ["25 to 50", { min: 25, max: 50 }], ["Over 50", { min: 50 }]],
  pb: [["Under 1", { max: 1 }], ["1 to 3", { min: 1, max: 3 }], ["Over 3", { min: 3 }]],
  peg: [["Under 1", { max: 1 }], ["1 to 2", { min: 1, max: 2 }]],
  roe_pct: [["Over 15%", { min: 15 }], ["Over 20%", { min: 20 }], ["Over 25%", { min: 25 }]],
  roce_pct: [["Over 15%", { min: 15 }], ["Over 20%", { min: 20 }], ["Over 25%", { min: 25 }]],
  debt_to_equity: [["Debt-free (under 0.1)", { max: 0.1 }], ["Under 0.5", { max: 0.5 }], ["Under 1", { max: 1 }]],
  dividend_yield_pct: [["Over 1%", { min: 1 }], ["Over 2%", { min: 2 }], ["Over 4%", { min: 4 }]],
  ev_ebitda: [["Under 10", { max: 10 }], ["10 to 20", { min: 10, max: 20 }], ["Over 20", { min: 20 }]],
  ret_1y: [["Up over 1 year", { min: 0 }], ["Up over 20%", { min: 20 }], ["Down over 20%", { max: -20 }]],
  pct_from_52w_high: [["Within 5% of high", { min: -5 }], ["20%+ below high", { max: -20 }]],
};

export function filterLabel(k: string) {
  if (QUICK[k]) return QUICK[k].label;
  if (k === "name") return "Company";
  if (k === "industry") return "Industry";
  if (k === "sector") return "Sector";
  return BY_KEY[k]?.short ?? BY_KEY[k]?.label ?? (VISUAL as Record<string, string>)[k] ?? k;
}

export function passes(c: Company, filters: Filters | undefined) {
  if (!filters) return true;
  for (const [k, f] of Object.entries(filters)) {
    if (QUICK[k]) { if (f.on && !QUICK[k].test(c)) return false; continue; }
    if (isSetFilter(k)) { if (f.any?.length && !f.any.includes(String(c[k] ?? ""))) return false; continue; }
    if (isTextFilter(k)) {
      if (f.text && !`${c.short} ${c.ticker} ${c.isin}`.toLowerCase().includes(f.text.toLowerCase())) return false;
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

const fmtVal = (k: string, v: number) => (k === "market_cap_cr" ? `₹${crore(v)}` : format(v, BY_KEY[k]?.format ?? "ratio").replace("+", ""));

export function describe(k: string, f: ColFilter) {
  if (QUICK[k]) return QUICK[k].label;
  if (isSetFilter(k)) return f.any!.length === 1 ? f.any![0] : `${filterLabel(k)}: ${f.any!.length} selected`;
  if (isTextFilter(k)) return `Name has “${f.text}”`;
  if (f.min !== undefined && f.max !== undefined) return `${filterLabel(k)} ${fmtVal(k, f.min)} – ${fmtVal(k, f.max)}`;
  if (f.min !== undefined) return `${filterLabel(k)} ≥ ${fmtVal(k, f.min)}`;
  return `${filterLabel(k)} ≤ ${fmtVal(k, f.max!)}`;
}

export const isActive = (k: string, f?: ColFilter) =>
  !!f && (QUICK[k] ? !!f.on : isSetFilter(k) ? !!f.any?.length : isTextFilter(k) ? !!f.text : f.min !== undefined || f.max !== undefined);

export function FilterIcon({ on }: { on: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" style={{ display: "block" }}>
      <path d="M2 3h12l-4.6 5.4V13l-2.8 1V8.4z" fill={on ? "var(--accent)" : "none"} stroke={on ? "var(--accent)" : "currentColor"} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [ref, onClose]);
}

/** Histogram of a metric with two draggable handles and min/max boxes. */
function RangeEditor({ k, values, value, countFor, onApply }: {
  k: string; values: number[]; value?: ColFilter; countFor: (f: ColFilter) => number; onApply: (f: ColFilter | null) => void;
}) {
  const sorted = useMemo(() => [...values].sort((a, b) => a - b), [values]);
  // Chart the middle of the distribution (2nd–95th percentile) so a few
  // extreme values (PEs in the thousands) don't squash everyone else.
  const lo = sorted.length ? sorted[Math.floor(sorted.length * 0.02)] : 0;
  const hi = sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] : 1;
  const span = hi - lo || 1;
  const BINS = 36;
  const bins = useMemo(() => {
    const b = new Array(BINS).fill(0);
    for (const v of sorted) b[Math.max(0, Math.min(BINS - 1, Math.floor(((v - lo) / span) * BINS)))]++;
    return b;
  }, [sorted, lo, hi, span]);
  const maxBin = Math.max(1, ...bins);
  const [min, setMin] = useState(value?.min?.toString() ?? "");
  const [max, setMax] = useState(value?.max?.toString() ?? "");
  const [err, setErr] = useState("");
  const parse = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const cur: ColFilter = { min: parse(min), max: parse(max) };
  const valid = (cur.min === undefined || Number.isFinite(cur.min)) && (cur.max === undefined || Number.isFinite(cur.max));
  const n = valid ? countFor(cur) : 0;
  const step = span / 200;
  const round = (v: number) => Number(v.toPrecision(3));
  const a = cur.min ?? lo, b = cur.max ?? hi;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;
  const col = BY_KEY[k];

  const apply = () => {
    if (!valid) { setErr("Enter numbers only"); return; }
    if (cur.min !== undefined && cur.max !== undefined && cur.min > cur.max) { setErr("Minimum is above maximum"); return; }
    onApply(cur.min === undefined && cur.max === undefined ? null : cur);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
      {sorted.length > 4 ? (
        <div className="hist" aria-hidden="true">
          <div className="bars">
            {bins.map((c, i) => {
              const x = lo + ((i + 0.5) / BINS) * span;
              const inside = x >= a && x <= b;
              return <i key={i} style={{ height: `${(c / maxBin) * 100}%`, opacity: inside ? 1 : 0.28 }} />;
            })}
          </div>
          <div className="slider">
            <span className="fill" style={{ left: pos(a), right: `calc(100% - ${pos(b)})` }} />
            <input type="range" min={lo} max={hi} step={step} value={Math.max(lo, Math.min(hi, a))} aria-label="Minimum"
              onChange={(e) => { setMin(String(round(Number(e.target.value)))); setErr(""); }} />
            <input type="range" min={lo} max={hi} step={step} value={Math.max(lo, Math.min(hi, b))} aria-label="Maximum"
              onChange={(e) => { setMax(String(round(Number(e.target.value)))); setErr(""); }} />
          </div>
          <div className="ends muted num"><span>≤ {fmtVal(k, lo)}</span><span>median {fmtVal(k, sorted[sorted.length >> 1])}</span><span>≥ {fmtVal(k, hi)}</span></div>
        </div>
      ) : <div className="muted" style={{ marginBottom: 8 }}>Too few companies with this value to chart.</div>}
      {PRESETS[k] && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
          {PRESETS[k].map(([label, f]) => (
            <button type="button" key={label} className="btn sm" onClick={() => { setMin(f.min?.toString() ?? ""); setMax(f.max?.toString() ?? ""); setErr(""); }}>{label}</button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ flex: 1 }}><span className="muted" style={{ fontSize: 12 }}>Min{col?.format === "crore" ? " (₹ Cr)" : col?.format === "pct" || col?.format === "signed" ? " (%)" : ""}</span>
          <input className="input num" style={{ width: "100%" }} inputMode="decimal" value={min} placeholder="any" onChange={(e) => { setMin(e.target.value); setErr(""); }} autoFocus /></label>
        <label style={{ flex: 1 }}><span className="muted" style={{ fontSize: 12 }}>Max</span>
          <input className="input num" style={{ width: "100%" }} inputMode="decimal" value={max} placeholder="any" onChange={(e) => { setMax(e.target.value); setErr(""); }} /></label>
      </div>
      {err && <div style={{ color: "var(--down)", fontSize: 12, marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <span className="soft num">{n.toLocaleString("en-IN")} match</span>
        <span style={{ flex: 1 }} />
        {value && <button type="button" className="btn" onClick={() => onApply(null)}>Clear</button>}
        <button type="submit" className="btn primary">Apply</button>
      </div>
    </form>
  );
}

/** Searchable checklist of industries (or sectors) with company counts. */
function SetEditor({ options, value, onApply }: { options: [string, number][]; value?: ColFilter; onApply: (f: ColFilter | null) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set(value?.any ?? []));
  const shown = options.filter(([o]) => o.toLowerCase().includes(q.toLowerCase()));
  const toggle = (o: string) => setSel((s) => { const n = new Set(s); if (n.has(o)) n.delete(o); else n.add(o); return n; });
  return (
    <div>
      <input className="input" style={{ width: "100%" }} placeholder={`Search ${options.length} industries`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div style={{ maxHeight: 260, overflow: "auto", margin: "8px 0" }}>
        {shown.map(([o, n]) => (
          <label key={o} className="item" style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 6px", borderRadius: 6, cursor: "pointer" }}>
            <span className={`cb ${sel.has(o) ? "on" : ""}`} onClick={() => toggle(o)} />
            <span style={{ flex: 1 }} onClick={() => toggle(o)}>{o}</span>
            <span className="muted num">{n}</span>
          </label>
        ))}
        {!shown.length && <div className="muted" style={{ padding: 8 }}>No industry matches “{q}”.</div>}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="btn sm" onClick={() => setSel(new Set(shown.map(([o]) => o)))}>Select shown</button>
        <span className="soft">{sel.size} selected</span>
        <span style={{ flex: 1 }} />
        {value && <button type="button" className="btn" onClick={() => onApply(null)}>Clear</button>}
        <button type="button" className="btn primary" onClick={() => onApply(sel.size ? { any: [...sel] } : null)}>Apply</button>
      </div>
    </div>
  );
}

/** Popover for one filter: range editor, industry checklist or name search. */
function useWindowSize() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
}

export function FilterPopover({ k, at, value, rows, countFor, onApply, onClose }: {
  k: string; at: { x: number; y: number }; value?: ColFilter; rows: Company[];
  countFor: (k: string, f: ColFilter) => number; onApply: (f: ColFilter | null) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onClose);
  useWindowSize();
  const [text, setText] = useState(value?.text ?? "");
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 348));
  const options = useMemo(() => {
    if (!isSetFilter(k)) return [];
    const counts = new Map<string, number>();
    for (const r of rows) { const v = r[k]; if (typeof v === "string" && v) counts.set(v, (counts.get(v) ?? 0) + 1); }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, k]);
  const values = useMemo(() => rows.map((r) => r[k]).filter(isNum), [rows, k]);
  return (
    <div ref={ref} className="menu" role="dialog" aria-label={`Filter ${filterLabel(k)}`}
      style={{ position: "fixed", left, top: Math.min(at.y + 6, window.innerHeight - 420), width: 340, padding: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{filterLabel(k)}</div>
      {BY_KEY[k]?.help && <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{BY_KEY[k].help}</div>}
      {isSetFilter(k) ? <SetEditor options={options} value={value} onApply={onApply} />
        : isTextFilter(k) ? (
          <form onSubmit={(e) => { e.preventDefault(); onApply(text.trim() ? { text: text.trim() } : null); }}>
            <input className="input" style={{ width: "100%" }} autoFocus placeholder="Name, symbol or ISIN" value={text} onChange={(e) => setText(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              {value && <button type="button" className="btn" onClick={() => onApply(null)}>Clear</button>}
              <button type="submit" className="btn primary">Apply</button>
            </div>
          </form>
        ) : <RangeEditor k={k} values={values} value={value} countFor={(f) => countFor(k, f)} onApply={onApply} />}
    </div>
  );
}

/** "+ Add filter": pick any metric. */
export function MetricPicker({ at, onPick, onClose }: { at: { x: number; y: number }; onPick: (k: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onClose);
  const [q, setQ] = useState("");
  const groups = [...new Set(COLUMNS.filter((c) => !["date", "text", "bool"].includes(c.format)).map((c) => c.group))];
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
  return (
    <div ref={ref} className="menu" role="dialog" aria-label="Add a filter"
      style={{ position: "fixed", left: Math.max(8, Math.min(at.x, window.innerWidth - 328)), top: at.y + 6, width: 320, padding: 10 }}>
      <input className="input" style={{ width: "100%", marginBottom: 6 }} autoFocus placeholder="Find a metric (e.g. ROCE, promoter)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 340, overflow: "auto" }}>
        {[["Classification", [["industry", "Industry"], ["sector", "Sector"], ["name", "Company name"]]] as const,
          ...groups.map((g) => [g, COLUMNS.filter((c) => c.group === g && !["date", "text", "bool"].includes(c.format)).map((c) => [c.key, c.label])] as const)]
          .map(([g, items]) => {
            const shown = items.filter(([, l]) => match(l));
            if (!shown.length) return null;
            return (
              <div key={g} style={{ marginBottom: 6 }}>
                <div className="sec" style={{ padding: "4px 6px" }}>{g}</div>
                {shown.map(([k, l]) => <div key={k} className="item" onClick={() => onPick(k)} data-tip={BY_KEY[k]?.help}>{l}</div>)}
              </div>
            );
          })}
      </div>
    </div>
  );
}
