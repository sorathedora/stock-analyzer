import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Spark } from "../components/visuals";
import { COLUMNS } from "../data/columns";
import { format, isNum, tone } from "../data/format";
import { search, type Dataset } from "../data/store";

const GROUPS = ["Price", "Returns", "Valuation", "Quality", "Results", "Ownership"];

export function ComparePage({ d }: { d: Dataset }) {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const isins = (params.get("i") ?? "").split(",").filter((i) => d.byIsin.has(i)).slice(0, 8);
  const cos = isins.map((i) => d.byIsin.get(i)!);
  const setIsins = (next: string[]) => setParams({ i: next.join(",") });
  const hits = search(d, q, 6).filter((c) => !isins.includes(c.isin));

  const rows = useMemo(() => COLUMNS.filter((c) => GROUPS.includes(c.group) && cos.some((x) => x[c.key] != null)), [cos]);
  const best = (key: string, better?: boolean) => {
    if (better === undefined) return null;
    const v = cos.map((c) => c[key]).filter(isNum);
    if (v.length < 2) return null;
    return better ? Math.max(...v) : Math.min(...v.filter((x) => x > 0));
  };

  return (
    <div className="page">
      <div className="top">
        <h1>Compare</h1>
        <span className="meta">{cos.length} companies · best value in each row is marked</span>
        <div className="right" style={{ position: "relative" }}>
          <input className="input" placeholder="Add a company…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { setIsins([...isins, hits[0].isin]); setQ(""); } }} />
          {q && hits.length > 0 && (
            <div className="menu results" style={{ top: 34, right: 0, width: 320 }}>
              {hits.map((c) => <div key={c.isin} className="item" onMouseDown={() => { setIsins([...isins, c.isin]); setQ(""); }}>{c.short}<span className="k mono">{c.ticker}</span></div>)}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: "0 20px 30px" }}>
        {cos.length === 0 ? <div className="empty"><h3>Pick companies to compare</h3>Select rows in any table and press <kbd>C</kbd>, or add companies above.</div> : (
          <div className="card" style={{ padding: 0, overflow: "auto" }}>
            <table className="ftable">
              <thead>
                <tr>
                  <th style={{ minWidth: 180 }}></th>
                  {cos.map((c) => (
                    <th key={c.isin} style={{ minWidth: 150 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                        <Link to={`/c/${encodeURIComponent(c.ticker)}`} style={{ color: "var(--ink)", fontWeight: 600, fontSize: 13 }}>{c.short}</Link>
                        <button className="btn ghost sm" aria-label={`Remove ${c.short}`} onClick={() => setIsins(isins.filter((i) => i !== c.isin))}>✕</button>
                      </div>
                      <div className="mono muted" style={{ fontWeight: 400 }}>{c.ticker}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr><td>1 year</td>{cos.map((c) => <td key={c.isin}><Spark values={d.sparks[c.isin]} w={120} /></td>)}</tr>
                {GROUPS.map((g) => {
                  const inGroup = rows.filter((r) => r.group === g);
                  if (!inGroup.length) return null;
                  return [
                    <tr key={g}><td colSpan={cos.length + 1} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)", paddingTop: 14 }}>{g}</td></tr>,
                    ...inGroup.map((col) => {
                      const b = best(col.key, col.better);
                      return (
                        <tr key={col.key}>
                          <td data-tip={col.help}>{col.label}</td>
                          {cos.map((c) => {
                            const v = c[col.key], top = b !== null && v === b;
                            return <td key={c.isin} className={`num ${col.format === "signed" ? tone(v) : ""}`} style={top ? { fontWeight: 600, background: "var(--accent-wash)" } : undefined}>{format(v, col.format)}</td>;
                          })}
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {cos.length > 0 && <p className="note">Click a company name to open its page. <a style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => nav(-1)}>Back</a></p>}
      </div>
    </div>
  );
}
