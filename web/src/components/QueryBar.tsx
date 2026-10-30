import { useMemo, useRef, useState } from "react";
import { COLUMNS } from "../data/columns";
import { compile, QueryError, type Compiled } from "../data/query";

const FIELDS = [
  ...COLUMNS.map((c) => ({ name: c.aliases?.[0] ?? c.key, key: c.key, help: c.label })),
  { name: "industry", key: "industry", help: 'Industry text, e.g. industry ~ "bank"' },
];

/** The word being typed at the caret, for suggestions. */
function wordAt(s: string, caret: number) {
  const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(s.slice(0, caret));
  return m ? { word: m[0], start: m.index } : null;
}

export function useQuery(text: string): { compiled: Compiled; error: string | null } {
  return useMemo(() => {
    try { return { compiled: compile(text), error: null }; }
    catch (e) { return { compiled: compile(""), error: e instanceof QueryError ? e.message : String(e) }; }
  }, [text]);
}

export function QueryBar({ value, onChange, count, total, error }: {
  value: string; onChange: (v: string) => void; count: number; total: number; error: string | null;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [focus, setFocus] = useState(false);
  const [pick, setPick] = useState(0);
  const w = focus ? wordAt(value, caret) : null;
  const hits = w && !["and", "or", "not"].includes(w.word.toLowerCase())
    ? FIELDS.filter((f) => f.name.startsWith(w.word.toLowerCase()) || f.help.toLowerCase().includes(w.word.toLowerCase())).slice(0, 8)
    : [];
  const showHits = hits.length > 0 && !(hits.length === 1 && hits[0].name === w?.word.toLowerCase());

  const apply = (name: string) => {
    if (!w) return;
    const next = value.slice(0, w.start) + name + " " + value.slice(caret);
    onChange(next);
    const pos = w.start + name.length + 1;
    requestAnimationFrame(() => { ref.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };

  return (
    <div className={`query ${error && value.trim() ? "bad" : ""}`}>
      <div className="box">
        <span className="mono muted" aria-hidden="true">ƒ</span>
        <input
          ref={ref}
          value={value}
          spellCheck={false}
          aria-label="Filter with a query, for example pe < 20 and roe > 15"
          placeholder="Filter: pe < 20 and roe > 15 and mcap > 5000"
          onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? 0); setPick(0); }}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.currentTarget.blur(); return; }
            if (!showHits) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setPick((p) => Math.min(p + 1, hits.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setPick((p) => Math.max(p - 1, 0)); }
            if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); apply(hits[pick].name); }
          }}
        />
        {value && <button className="btn ghost sm" onClick={() => onChange("")} aria-label="Clear filter">✕</button>}
        <span className="count num">{error && value.trim() ? "—" : `${count.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}</span>
      </div>
      {showHits && (
        <div className="suggest" role="listbox">
          {hits.map((h, i) => (
            <div key={h.key} className={i === pick ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); apply(h.name); }}>
              <span className="k">{h.name}</span><span className="h">{h.help}</span>
            </div>
          ))}
        </div>
      )}
      {!showHits && focus && error && value.trim() && <div className="err">{error}</div>}
    </div>
  );
}
