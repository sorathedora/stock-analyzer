import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AddToWatchlist } from "../components/AddToWatchlist";
import { IndustryPosition, PEER_METRICS, PeerScatter, peersOf } from "../components/Peers";
import { PriceChart, RANGES, type Range } from "../components/PriceChart";
import { TrustDot } from "../components/visuals";
import { BY_KEY, COLUMNS } from "../data/columns";
import { useCompanyFile, type ResultRow } from "../data/company";
import { crore, format, isNum, monthYear, num, shortDate, signed, tone } from "../data/format";
import type { Company, Dataset } from "../data/store";

const SECTIONS = [["overview", "Overview"], ["peers", "Peers"], ["results", "Results"], ["ownership", "Shareholding"], ["actions", "Corporate actions"]] as const;

function KeyNumbers({ c }: { c: Company }) {
  const items: [string, React.ReactNode, string?][] = [
    ["Market cap", c.market_cap_cr ? `₹${crore(c.market_cap_cr)}` : "—", BY_KEY.market_cap_cr.help],
    ["PE", <span style={{ display: "inline-flex", alignItems: "center" }}>{format(c.pe, "ratio")}<TrustDot check={c.pe_check} source={c.pe_source} note={c.pe_note} /></span>, BY_KEY.pe.help],
    ["Price to book", format(c.pb, "ratio"), BY_KEY.pb.help],
    ["ROE", format(c.roe_pct, "pct"), BY_KEY.roe_pct.help],
    ["Dividend yield", format(c.dividend_yield_pct, "pct"), BY_KEY.dividend_yield_pct.help],
    ["Debt to equity", format(c.debt_to_equity, "ratio"), BY_KEY.debt_to_equity.help],
    ["52-week high", num(c.high_52w)], ["52-week low", num(c.low_52w)],
    ["1Y return", <span className={tone(c.ret_1y)}>{signed(c.ret_1y)}</span>],
    ["3Y return", <span className={tone(c.ret_3y)}>{signed(c.ret_3y)}</span>],
    ["Promoter holding", format(c.promoter_pct, "pct")],
    ["Avg traded value", c.avg_value_20d_cr ? `₹${crore(c.avg_value_20d_cr)}/day` : "—", BY_KEY.avg_value_20d_cr.help],
  ];
  return (
    <div className="kv num">
      {items.map(([k, v, help]) => <div key={k}><span data-tip={help}>{k}</span><b style={{ fontWeight: 500 }}>{v}</b></div>)}
    </div>
  );
}

function PeersTable({ d, c }: { d: Dataset; c: Company }) {
  const nav = useNavigate();
  const peers = peersOf(d, c, 10);
  const all = [c, ...peers];
  // Hide metrics nobody in the group has yet (e.g. ROE before results are filed).
  const metrics = PEER_METRICS.filter((k) => all.some((p) => isNum(p[k])));
  const median = (k: string) => {
    const v = d.companies.filter((x) => x.active && x.industry === c.industry).map((x) => x[k]).filter(isNum).sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : null;
  };
  return (
    <div style={{ overflow: "auto" }}>
      <table className="ftable">
        <thead><tr><th>Company</th>{metrics.map((k) => <th key={k} data-tip={BY_KEY[k].help}>{BY_KEY[k].short ?? BY_KEY[k].label}</th>)}</tr></thead>
        <tbody>
          {all.map((p) => (
            <tr key={p.isin} style={p.isin === c.isin ? { background: "var(--accent-wash)" } : { cursor: "pointer" }}
              onClick={() => p.isin !== c.isin && nav(`/c/${encodeURIComponent(p.ticker)}`)}>
              <td style={p.isin === c.isin ? { background: "var(--accent-wash)", fontWeight: 600, color: "var(--ink)" } : undefined}>{p.short}</td>
              {metrics.map((k) => <td key={k} className={`num ${BY_KEY[k].format === "signed" ? tone(p[k]) : ""}`}>{format(p[k], BY_KEY[k].format)}</td>)}
            </tr>
          ))}
          <tr className="total"><td>Industry median</td>{metrics.map((k) => <td key={k} className="num">{format(median(k), BY_KEY[k].format)}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

const RESULT_LINES: [string, string, (r: ResultRow) => number | null][] = [
  ["revenue", "Revenue", (r) => r.revenue as number],
  ["other_income", "Other income", (r) => r.other_income as number],
  ["total_expenses", "Total expenses", (r) => r.total_expenses as number],
  ["ebitda", "EBITDA", (r) => isNum(r.profit_before_tax) ? (r.profit_before_tax as number) + ((r.finance_cost as number) || 0) + ((r.depreciation as number) || 0) - ((r.other_income as number) || 0) : null],
  ["depreciation", "Depreciation", (r) => r.depreciation as number],
  ["finance_cost", "Finance cost", (r) => r.finance_cost as number],
  ["profit_before_tax", "Profit before tax", (r) => r.profit_before_tax as number],
  ["tax", "Tax", (r) => r.tax as number],
  ["net_profit", "Net profit", (r) => (isNum(r.net_profit_owners) && r.net_profit_owners !== 0 ? r.net_profit_owners : r.net_profit) as number],
];
const BALANCE_LINES: [string, string][] = [
  ["total_equity", "Shareholders' equity"], ["borrowings_noncurrent", "Long-term borrowings"], ["borrowings_current", "Short-term borrowings"],
  ["cash", "Cash"], ["receivables", "Receivables"], ["inventories", "Inventories"], ["fixed_assets", "Fixed assets"], ["total_assets", "Total assets"],
  ["cash_from_operations", "Cash from operations"], ["capex", "Capex"], ["cash_from_investing", "Cash from investing"], ["cash_from_financing", "Cash from financing"],
];

function Results({ results }: { results: ResultRow[] }) {
  const bases = [...new Set(results.map((r) => r.basis))];
  const [basis, setBasis] = useState(bases.includes("consolidated") ? "consolidated" : bases[0]);
  const rows = results.filter((r) => r.basis === basis);
  const quarters = rows.filter((r) => r.period === "quarter").sort((a, b) => a.period_end.localeCompare(b.period_end));
  const ytd = rows.filter((r) => r.period === "year_to_date").sort((a, b) => a.period_end.localeCompare(b.period_end));
  const cr = (v: number | null | undefined) => (isNum(v) ? num(v / 1e7, Math.abs(v / 1e7) >= 100 ? 0 : 1) : "—");
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <div className="seg">{bases.map((b) => <button key={b} className={b === basis ? "on" : ""} onClick={() => setBasis(b)}>{b[0].toUpperCase() + b.slice(1)}</button>)}</div>
        <span className="muted">₹ crore · from the company's XBRL filings with NSE</span>
      </div>
      {quarters.length > 0 && (
        <div style={{ overflow: "auto" }}>
          <table className="ftable">
            <thead><tr><th>Quarter ending</th>{quarters.map((q) => <th key={q.period_end}>{monthYear(q.period_end)}</th>)}</tr></thead>
            <tbody>
              {RESULT_LINES.map(([k, label, f]) => (
                <tr key={k} className={k === "net_profit" ? "total" : ""}><td>{label}</td>{quarters.map((q) => <td key={q.period_end} className="num">{cr(f(q))}</td>)}</tr>
              ))}
              <tr><td>EPS (₹)</td>{quarters.map((q) => <td key={q.period_end} className="num">{num(q.eps_diluted ?? q.eps_basic)}</td>)}</tr>
              <tr><td>EBITDA margin</td>{quarters.map((q) => { const e = RESULT_LINES[3][2](q); return <td key={q.period_end} className="num">{isNum(e) && isNum(q.revenue) && q.revenue ? `${num((e / (q.revenue as number)) * 100, 1)}%` : "—"}</td>; })}</tr>
            </tbody>
          </table>
        </div>
      )}
      {ytd.length > 0 && (
        <>
          <h3 className="sechead">Balance sheet and cash flow</h3>
          <div style={{ overflow: "auto" }}>
            <table className="ftable">
              <thead><tr><th>As of</th>{ytd.map((y) => <th key={y.period_end}>{shortDate(y.period_end)}{y.months !== 12 ? ` (${y.months}m YTD)` : ""}</th>)}</tr></thead>
              <tbody>
                {BALANCE_LINES.filter(([k]) => ytd.some((y) => isNum(y[k]))).map(([k, label]) => (
                  <tr key={k}><td>{label}</td>{ytd.map((y) => <td key={y.period_end} className="num">{cr(y[k] as number)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Shareholding({ rows }: { rows: Record<string, unknown>[] }) {
  const sorted = [...rows].sort((a, b) => String(a.as_of).localeCompare(String(b.as_of)));
  const lines: [string, string][] = [["promoter_pct", "Promoters"], ["fii_pct", "FIIs"], ["dii_pct", "DIIs"], ["mutual_fund_pct", "of which mutual funds"], ["retail_pct", "Retail (up to ₹2 lakh)"], ["public_pct", "Non-institutional"], ["promoter_pledged_pct", "Promoter shares pledged"]];
  return (
    <div style={{ overflow: "auto" }}>
      <table className="ftable">
        <thead><tr><th>As of</th>{sorted.map((r) => <th key={String(r.as_of)}>{shortDate(String(r.as_of))}</th>)}</tr></thead>
        <tbody>
          {lines.filter(([k]) => sorted.some((r) => isNum(r[k]))).map(([k, label]) => (
            <tr key={k}><td>{label}</td>{sorted.map((r) => <td key={String(r.as_of)} className="num">{format(r[k], "pct")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompanyPage({ d }: { d: Dataset }) {
  const { ticker = "" } = useParams();
  const c = d.byTicker.get(decodeURIComponent(ticker).toUpperCase());
  const { file, loading } = useCompanyFile(c?.isin ?? null);
  const [range, setRange] = useState<Range>("1Y");
  const [axes, setAxes] = useState<[string, string]>(["pe", "ret_1y"]);
  const [section, setSection] = useState("overview");
  const nav = useNavigate();

  useEffect(() => { document.title = c ? `${c.short} · Parakh` : "Parakh"; }, [c]);
  useEffect(() => {
    const page = document.querySelector(".page");
    if (!page) return;
    const onScroll = () => {
      let cur = "overview";
      for (const [id] of SECTIONS) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < 140) cur = id; }
      setSection(cur);
    };
    page.addEventListener("scroll", onScroll);
    return () => page.removeEventListener("scroll", onScroll);
  }, [c]);
  const numericCols = useMemo(() => COLUMNS.filter((x) => !["date", "text", "bool"].includes(x.format)), []);

  if (!c) return <div className="empty"><h3>Company not found</h3>Nothing matches “{ticker}”. Try <kbd>⌘K</kbd> to search.</div>;
  const results = file?.results ?? [];
  const holdings = file?.shareholding ?? [];
  const acts = (file?.actions ?? []).slice().reverse();

  return (
    <div className="page">
      <div className="cp">
        <div className="cp-head">
          <div style={{ flex: 1, minWidth: 280 }}>
            <h1>{c.short}</h1>
            <div className="soft" style={{ marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {c.nse_symbol && <span className="mono">NSE: {c.nse_symbol}</span>}
              {c.bse_code && <span className="mono">BSE: {c.bse_code}</span>}
              <span className="mono muted">{c.isin}</span>
              {typeof c.sector === "string" && <span>{String(c.sector)}</span>}
              {c.industry && <Link to={`/industries/${encodeURIComponent(c.industry)}`} style={{ color: "var(--accent)" }}>{c.industry}</Link>}
              {typeof c.sub_industry === "string" && <span className="muted" data-tip="Sub-industry (Rediff Money)">{String(c.sub_industry)}</span>}
              {!c.active && <span className="down">Not traded in the last 30 days</span>}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="px num">₹{num(c.close)}</div>
            <div className={`num ${tone(c.change_pct)}`} style={{ fontWeight: 500 }}>{signed(c.change_pct)} · close {format(c.last_trade_date, "date")}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignSelf: "center" }}>
            <AddToWatchlist isins={[c.isin]} />
          </div>
        </div>

        <nav className="tabs">
          {SECTIONS.map(([id, label]) => (
            <a key={id} className={section === id ? "on" : ""} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{label}</a>
          ))}
        </nav>

        <section id="overview" className="cols2" style={{ scrollMarginTop: 60 }}>
          <div className="card">
            <h3>Price<span style={{ marginLeft: "auto" }} className="ranges">
              {(Object.keys(RANGES) as Range[]).map((r) => <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}
            </span></h3>
            {file ? <PriceChart file={file} range={range} height={320} /> : <div className="skel" style={{ height: 320, width: "100%" }} aria-label={loading ? "Loading chart" : "No price history"} />}
          </div>
          <div className="card"><h3>Key numbers</h3><KeyNumbers c={c} /></div>
        </section>

        <section id="peers" style={{ marginTop: 16, scrollMarginTop: 60 }}>
          <div className="cols2">
            <div className="card">
              <h3>Peers{c.industry ? ` in ${c.industry}` : ""}</h3>
              {c.industry ? <PeersTable d={d} c={c} /> : <div className="muted">This company doesn't have an industry tag yet, so peers can't be listed.</div>}
            </div>
            <div className="card">
              <h3>Where it sits in its industry</h3>
              <IndustryPosition d={d} c={c} />
            </div>
          </div>
          {c.industry && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>
                Industry map
                <span style={{ marginLeft: "auto", display: "flex", gap: 6, textTransform: "none", letterSpacing: 0 }}>
                  {[0, 1].map((i) => (
                    <select key={i} className="input" style={{ height: 26, fontSize: 12 }} value={axes[i]} aria-label={i ? "Vertical axis" : "Horizontal axis"}
                      onChange={(e) => setAxes((a) => (i ? [a[0], e.target.value] : [e.target.value, a[1]]))}>
                      {numericCols.map((x) => <option key={x.key} value={x.key}>{i ? "↕ " : "↔ "}{x.label}</option>)}
                    </select>
                  ))}
                </span>
              </h3>
              <PeerScatter d={d} c={c} x={axes[0]} y={axes[1]} width={1100} height={320} onPick={(i) => nav(`/c/${encodeURIComponent(d.byIsin.get(i)!.ticker)}`)} />
            </div>
          )}
        </section>

        <section id="results" className="card" style={{ marginTop: 16, scrollMarginTop: 60 }}>
          <h3>Results</h3>
          {results.length ? <Results results={results} /> : (
            <div className="banner">
              No results on file yet. Results are collected from NSE as companies file them (started Oct 2026), so quarterly history builds up from here.
            </div>
          )}
        </section>

        <section id="ownership" className="card" style={{ marginTop: 16, scrollMarginTop: 60 }}>
          <h3>Shareholding</h3>
          {holdings.length ? <Shareholding rows={holdings} /> : <div className="banner">No shareholding filings collected yet. They arrive quarterly as companies file them.</div>}
        </section>

        <section id="actions" className="card" style={{ marginTop: 16, scrollMarginTop: 60 }}>
          <h3>Corporate actions</h3>
          {acts.length ? (
            <table className="ftable">
              <thead><tr><th>Ex-date</th><th style={{ textAlign: "left" }}>Action</th><th>Amount / ratio</th></tr></thead>
              <tbody>
                {acts.map(([date, kind, value, purpose], i) => (
                  <tr key={i}>
                    <td className="num">{shortDate(date)}</td>
                    <td style={{ textAlign: "left" }}>{purpose}</td>
                    <td className="num">{kind === "dividend" ? `₹${num(value)}` : isNum(value) ? `price × ${num(value, 3)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="muted">No dividends, splits or bonuses in the period on file.</div>}
        </section>
      </div>
    </div>
  );
}
