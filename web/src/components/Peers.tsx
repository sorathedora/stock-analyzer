import { useMemo } from "react";
import { BY_KEY } from "../data/columns";
import { format, isNum, ordinal } from "../data/format";
import { rank, type Company, type Dataset } from "../data/store";

export const PEER_METRICS = ["pe", "pb", "roe_pct", "dividend_yield_pct", "ret_1y", "debt_to_equity", "ebitda_margin_q_pct", "market_cap_cr"];

/** Industry peers, nearest in size first. */
export function peersOf(d: Dataset, c: Company, n = 12) {
  if (!c.industry) return [];
  const size = (x: Company) => Math.log10(((x.market_cap_cr as number) || 1));
  return d.companies
    .filter((x) => x.industry === c.industry && x.active && x.isin !== c.isin)
    .sort((a, b) => Math.abs(size(a) - size(c)) - Math.abs(size(b) - size(c)))
    .slice(0, n);
}

/** Where the company sits in its industry for each key metric. */
export function IndustryPosition({ d, c, metrics = PEER_METRICS }: { d: Dataset; c: Company; metrics?: string[] }) {
  const rows = metrics.map((k) => ({ k, col: BY_KEY[k], r: rank(d, k, c[k], c.industry) })).filter((x) => x.r && x.col);
  if (!rows.length) return <div className="muted">Not enough data yet to compare this company.</div>;
  const scope = rows[0].r!.scope;
  return (
    <div>
      {rows.map(({ k, col, r }) => {
        const good = col.better === undefined ? null : col.better ? r!.pct >= 50 : r!.pct <= 50;
        return (
          <div className="vs" key={k}>
            <span className="soft" data-tip={col.help}>{col.label}</span>
            <span className="num" style={{ fontWeight: 500 }}>{format(c[k], col.format)}</span>
            <span className="track" data-tip={`${ordinal(r!.pct)} percentile of ${r!.n} ${r!.scope === "all companies" ? "companies" : `${r!.scope} companies`} · median ${format(r!.median, col.format)}${good === null ? "" : good ? " · better than most" : " · weaker than most"}`}>
              <u style={{ left: "50%" }} />
              <i style={{ left: `${r!.pct}%` }} />
            </span>
          </div>
        );
      })}
      <div className="note">Dot = this company · tick = median of {scope === "all companies" ? "all companies (no industry tag yet)" : scope}. Hover for detail.</div>
    </div>
  );
}

/** Scatter of two metrics across the industry, this company highlighted. */
export function PeerScatter({ d, c, x = "pe", y = "ret_1y", width = 420, height = 230, onPick }: {
  d: Dataset; c: Company; x?: string; y?: string; width?: number; height?: number; onPick?: (isin: string) => void;
}) {
  const pts = useMemo(() => {
    const peers = d.companies.filter((p) => p.active && p.industry && p.industry === c.industry && isNum(p[x]) && isNum(p[y]));
    return peers.filter((p) => (p[x] as number) > 0 && (p[x] as number) < 150);
  }, [d, c, x, y]);
  if (pts.length < 4) return <div className="muted">Too few industry peers with {BY_KEY[x]?.label} and {BY_KEY[y]?.label} to plot.</div>;
  const l = 40, b = 26, t = 8, r = 10;
  const xs = pts.map((p) => p[x] as number), ys = pts.map((p) => p[y] as number);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys, 0), Math.max(...ys, 0)];
  const X = (v: number) => l + ((v - x0) / (x1 - x0 || 1)) * (width - l - r);
  const Y = (v: number) => t + (1 - (v - y0) / (y1 - y0 || 1)) * (height - t - b);
  const sorted = [...xs].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  const fx = BY_KEY[x], fy = BY_KEY[y];
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${fx.label} versus ${fy.label} for ${c.industry} companies`}>
      <line x1={l} x2={width - r} y1={Y(0)} y2={Y(0)} stroke="var(--line-2)" />
      <line x1={X(med)} x2={X(med)} y1={t} y2={height - b} stroke="var(--line-2)" strokeDasharray="3 3" />
      <text x={X(med) + 4} y={t + 10} fontSize="10.5" fill="var(--ink-3)">median {fx.label} {format(med, fx.format)}</text>
      <text x={width - r} y={height - 8} fontSize="10.5" fill="var(--ink-3)" textAnchor="end">{fx.label} →</text>
      <text x={2} y={t + 10} fontSize="10.5" fill="var(--ink-3)">{fy.short ?? fy.label}</text>
      {pts.map((p) => {
        const me = p.isin === c.isin;
        return (
          <circle key={p.isin} cx={X(p[x] as number)} cy={Y(p[y] as number)} r={me ? 6 : 4}
            fill={me ? "var(--accent)" : "var(--ink-3)"} fillOpacity={me ? 1 : 0.45} stroke="var(--panel)" strokeWidth={2}
            style={{ cursor: onPick ? "pointer" : undefined }} onClick={() => onPick?.(p.isin)}
            data-tip={`${p.short} · ${fx.label} ${format(p[x], fx.format)} · ${fy.label} ${format(p[y], fy.format)}`} />
        );
      })}
      {isNum(c[x]) && isNum(c[y]) && (c[x] as number) < 150 && (
        <text x={X(c[x] as number) + 9} y={Y(c[y] as number) + 4} fontSize="11.5" fontWeight="500" fill="var(--ink)">{c.ticker}</text>
      )}
    </svg>
  );
}
