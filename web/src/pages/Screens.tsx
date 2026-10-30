import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ImportDialog } from "../components/Dialogs";
import { defaultView, ScreenView, type ViewState } from "../components/ScreenView";
import { format, num, signed, tone } from "../data/format";
import { search, type Dataset } from "../data/store";
import { actions, useWatchlists } from "../data/watchlists";

function usePersisted<T>(key: string, initial: () => T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); if (s) return { ...initial(), ...JSON.parse(s) }; } catch { /* ignore */ }
    return initial();
  });
  const set = (n: T) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } };
  return [v, set];
}

/** Type-ahead to add one company at a time. */
function AddCompany({ d, onAdd }: { d: Dataset; onAdd: (isin: string) => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const hits = search(d, q, 7);
  return (
    <div style={{ position: "relative" }}>
      <input className="input" style={{ width: 240 }} placeholder="Add a company…" value={q}
        onChange={(e) => { setQ(e.target.value); setI(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
          if (e.key === "Enter" && hits[i]) { onAdd(hits[i].isin); setQ(""); }
          if (e.key === "Escape") setQ("");
        }} aria-label="Add a company to this watchlist" />
      {hits.length > 0 && (
        <div className="menu results" style={{ top: 34, right: 0, width: 380 }}>
          {hits.map((c, idx) => (
            <div key={c.isin} className={`item ${idx === i ? "on" : ""}`} onMouseEnter={() => setI(idx)}
              onMouseDown={(e) => { e.preventDefault(); onAdd(c.isin); setQ(""); }}>
              <b style={{ fontWeight: 500 }}>{c.short}</b><span className="mono muted">{c.ticker}</span>
              <span className="k num">₹{num(c.close)} <span className={tone(c.change_pct)}>{signed(c.change_pct)}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WatchlistPage({ d }: { d: Dataset }) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const lists = useWatchlists();
  const nav = useNavigate();
  const w = lists.find((x) => x.id === id) ?? lists[0];
  const [importing, setImporting] = useState(false);
  const [renaming, setRenaming] = useState(params.get("rename") === "1");
  const [sort, setSort] = useState(defaultView().sort);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renaming) nameRef.current?.select(); }, [renaming]);

  const rows = useMemo(() => (w ? w.isins.map((i) => d.byIsin.get(i)).filter((c) => !!c) : []), [w, d]);
  if (!w) return <div className="empty"><h3>No watchlists yet</h3><button className="btn primary" onClick={() => nav(`/w/${actions.create("My watchlist")}`)}>Create one</button></div>;

  const view: ViewState = { ...defaultView(), preset: w.preset ?? "Overview", columns: w.columns ?? defaultView().columns, query: w.query ?? "", sort };
  const missing = w.isins.length - rows.length;
  const finishRename = (v: string) => { actions.rename(w.id, v); setRenaming(false); params.delete("rename"); setParams(params, { replace: true }); };

  return (
    <>
      <ScreenView
        d={d}
        exportName={w.name}
        title={renaming
          ? <input ref={nameRef} defaultValue={w.name} autoFocus onBlur={(e) => finishRename(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") finishRename(e.currentTarget.value); if (e.key === "Escape") setRenaming(false); }} />
          : <span onDoubleClick={() => setRenaming(true)} data-tip="Double-click to rename">{w.name}</span>}
        meta={<>{rows.length} {rows.length === 1 ? "company" : "companies"}{missing > 0 ? ` · ${missing} not found in today's data` : ""} · close {format(d.asOf, "date")}</>}
        rows={rows}
        view={view}
        onView={(v) => { setSort(v.sort); actions.setView(w.id, { preset: v.preset, columns: v.columns, query: v.query }); }}
        onRemove={(isins) => actions.drop(w.id, isins)}
        actions={<>
          <AddCompany d={d} onAdd={(i) => actions.add(w.id, [i])} />
          <button className="btn" onClick={() => setImporting(true)}>Import</button>
          <button className="btn ghost icon" aria-label="Rename watchlist" data-tip="Rename" onClick={() => setRenaming(true)}>✎</button>
          <button className="btn ghost icon" aria-label="Delete watchlist" data-tip="Delete watchlist"
            onClick={() => { if (confirm(`Delete “${w.name}”? This can't be undone.`)) { actions.remove(w.id); nav("/"); } }}>🗑</button>
        </>}
        empty={
          <div className="empty">
            <h3>Add your first companies</h3>
            Search with the box above, paste a list of ISINs or symbols with <b>Import</b>, or press <kbd>⌘K</kbd> anywhere.
            <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => setImporting(true)}>Import a list</button></div>
          </div>
        }
      />
      {importing && <ImportDialog d={d} onImport={(isins) => actions.add(w.id, isins)} onClose={() => setImporting(false)} />}
    </>
  );
}

export function AllPage({ d }: { d: Dataset }) {
  const [view, setView] = usePersisted<ViewState>("view.all", defaultView);
  const [inactive, setInactive] = useState(false);
  const rows = useMemo(() => d.companies.filter((c) => inactive || c.active), [d, inactive]);
  return (
    <ScreenView
      d={d} exportName="all-companies" title="All companies" rows={rows} view={view} onView={setView}
      meta={<>{rows.length.toLocaleString("en-IN")} listed on NSE or BSE · close {format(d.asOf, "date")}</>}
      actions={<label className="soft" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <span className={`cb ${inactive ? "on" : ""}`} onClick={() => setInactive(!inactive)} /> <span onClick={() => setInactive(!inactive)}>Include inactive</span>
      </label>}
    />
  );
}

export function IndustryPage({ d }: { d: Dataset }) {
  const { name = "" } = useParams();
  const industry = decodeURIComponent(name);
  const [view, setView] = usePersisted<ViewState>("view.industry", defaultView);
  const rows = useMemo(() => d.companies.filter((c) => c.active && c.industry === industry), [d, industry]);
  return (
    <ScreenView
      d={d} exportName={industry} title={industry} rows={rows} view={view} onView={setView}
      meta={<><Link to="/industries" className="soft">Industries</Link> · {rows.length} companies</>}
    />
  );
}

export function IndustriesPage({ d }: { d: Dataset }) {
  const stats = useMemo(() => {
    const med = (a: number[]) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
    const all = d.industries.map((ind) => {
      const cs = d.companies.filter((c) => c.active && c.industry === ind);
      const pick = (k: string) => cs.map((c) => c[k]).filter((v): v is number => typeof v === "number");
      return {
        ind, n: cs.length,
        mcap: pick("market_cap_cr").reduce((a, b) => a + b, 0),
        pe: med(pick("pe")), ret1y: med(pick("ret_1y")), dy: med(pick("dividend_yield_pct")),
        top: [...cs].sort((a, b) => ((b.market_cap_cr as number) || 0) - ((a.market_cap_cr as number) || 0)).slice(0, 3),
      };
    });
    return all.sort((a, b) => b.mcap - a.mcap);
  }, [d]);
  const untagged = d.companies.filter((c) => c.active && !c.industry).length;
  return (
    <div className="page">
      <div className="top"><h1>Industries</h1><span className="meta">{stats.length} industries · medians across each industry's companies</span></div>
      <div style={{ padding: "0 20px 20px" }}>
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table className="ftable">
            <thead><tr><th>Industry</th><th>Companies</th><th>Total market cap</th><th>Median PE</th><th>Median 1Y</th><th>Median div yield</th><th style={{ textAlign: "left" }}>Largest</th></tr></thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.ind}>
                  <td><Link to={`/industries/${encodeURIComponent(s.ind)}`} style={{ color: "var(--ink)", fontWeight: 500 }}>{s.ind}</Link></td>
                  <td className="num">{s.n}</td>
                  <td className="num">₹{format(s.mcap, "crore")}</td>
                  <td className="num">{format(s.pe, "ratio")}</td>
                  <td className={`num ${tone(s.ret1y)}`}>{format(s.ret1y, "signed")}</td>
                  <td className="num">{format(s.dy, "pct")}</td>
                  <td style={{ textAlign: "left" }} className="soft">{s.top.map((c) => c.short).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          {untagged.toLocaleString("en-IN")} companies don't have an industry yet. NSE's free industry lists cover the ~750 largest; tagging the rest is a planned one-time job.
        </p>
      </div>
    </div>
  );
}
