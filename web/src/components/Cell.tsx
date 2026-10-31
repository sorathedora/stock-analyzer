import { BY_KEY } from "../data/columns";
import { format, tone } from "../data/format";
import { rank, type Company, type Dataset } from "../data/store";
import { PctBar, RangeBar, Spark, TrustDot } from "./visuals";

/** Metrics whose cells also show where the company sits in its industry. */
const RANKED = new Set(["pe", "pb", "peg", "roe_pct", "roce_pct", "ev_ebitda", "dividend_yield_pct", "ebitda_margin_q_pct", "debt_to_equity", "net_margin_q_pct", "earnings_yield_pct"]);

/** Metrics that come from the company's statements, with their source in the tooltip. */
const FUNDAMENTAL = new Set(["pb", "debt_to_equity", "roe_pct", "roce_pct", "ev_ebitda", "ev_cr", "book_value_cr", "debt_cr", "cash_cr"]);

function sourceTip(c: Company) {
  if (c.fundamentals_note) return `Blank: ${c.fundamentals_note}.`;
  if (c.fundamentals_source === "NSE filing") return `From the company's latest results filed with NSE (${c.balance_sheet_date ?? ""}).`;
  if (c.fundamentals_source === "annual report") {
    const fy = typeof c.annual_report_fy === "string" ? `FY ending ${c.annual_report_fy.slice(0, 7)}` : "latest year";
    return `From the annual report, ${fy}, standalone figures (via Rediff Money). Updates when newer results are filed.`;
  }
  return "Not available yet for this company.";
}

export function cellAlign(key: string) {
  return key === "spark" || key === "range" ? "l" : "";
}

export function Cell({ k, c, d }: { k: string; c: Company; d: Dataset }) {
  if (k === "spark") return <Spark values={d.sparks[c.isin]} />;
  if (k === "range") return <RangeBar low={c.low_52w} high={c.high_52w} value={c.close} />;
  const col = BY_KEY[k];
  if (!col) return <>{String(c[k] ?? "—")}</>;
  const v = c[k];
  const text = format(v, col.format);
  const colored = col.format === "signed" ? tone(v) : "";
  let bar = null;
  if (RANKED.has(k)) {
    const r = rank(d, k, v, c.industry);
    if (r) {
      const where = r.scope === "all companies" ? "all companies" : `${r.n} ${r.scope} companies`;
      bar = <PctBar pct={r.pct} tip={`${col.label} ${text}: ${r.pct}th percentile of ${where} · median ${format(r.median, col.format)}`} />;
    }
  }
  return (
    <>
      <span className={`num ${colored}`} data-tip={FUNDAMENTAL.has(k) ? sourceTip(c) : undefined}>{text}</span>
      {bar}
      {k === "pe" && <TrustDot check={c.pe_check} source={c.pe_source} note={c.pe_note} />}
    </>
  );
}
