import { useState } from "react";
import { Link } from "react-router-dom";
import { useCompanyFile } from "../data/company";
import { crore, format, num, signed, tone } from "../data/format";
import type { Dataset } from "../data/store";
import { IndustryPosition, PeerScatter } from "./Peers";
import { PriceChart, RANGES, type Range } from "./PriceChart";
import { TrustDot } from "./visuals";
import { AddToWatchlist } from "./AddToWatchlist";

export function QuickView({ d, isin, onClose, onPick }: { d: Dataset; isin: string | null; onClose: () => void; onPick: (isin: string) => void }) {
  const c = isin ? d.byIsin.get(isin) : undefined;
  const { file, loading } = useCompanyFile(isin);
  const [range, setRange] = useState<Range>("1Y");
  return (
    <aside className={`drawer ${c ? "open" : ""}`} aria-hidden={!c} aria-label="Company quick view">
      {c && (
        <>
          <div className="dh">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>{c.short}</h2>
                <div className="mono muted" style={{ marginTop: 2 }}>
                  {c.nse_symbol ? `NSE: ${c.nse_symbol}` : `BSE: ${c.bse_code}`}{c.industry ? ` · ${c.industry}` : ""}
                </div>
              </div>
              <AddToWatchlist isins={[c.isin]} compact />
              <button className="btn icon" onClick={onClose} aria-label="Close quick view" data-tip="Close (Esc)">✕</button>
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="num" style={{ fontSize: 26, fontWeight: 600 }}>₹{num(c.close)}</span>
              <span className={`num ${tone(c.change_pct)}`} style={{ fontWeight: 500 }}>{signed(c.change_pct)} today</span>
            </div>
          </div>
          <div className="db">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div className="ranges">
                {(Object.keys(RANGES) as Range[]).map((r) => <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}
              </div>
            </div>
            {file ? <PriceChart file={file} range={range} height={190} showVolume={false} />
              : <div className="skel" style={{ height: 190, width: "100%" }} aria-label={loading ? "Loading chart" : "No price history"} />}
            <div className="kv num" style={{ marginTop: 14 }}>
              <div><span>Market cap</span><b style={{ fontWeight: 500 }}>{c.market_cap_cr ? `₹${crore(c.market_cap_cr)}` : "—"}</b></div>
              <div><span>PE</span><b style={{ fontWeight: 500, display: "flex", alignItems: "center" }}>{format(c.pe, "ratio")}<TrustDot check={c.pe_check} source={c.pe_source} note={c.pe_note} /></b></div>
              <div><span>52W high</span><b style={{ fontWeight: 500 }}>{num(c.high_52w)}</b></div>
              <div><span>52W low</span><b style={{ fontWeight: 500 }}>{num(c.low_52w)}</b></div>
              <div><span>1Y return</span><b className={tone(c.ret_1y)} style={{ fontWeight: 500 }}>{signed(c.ret_1y)}</b></div>
              <div><span>Dividend yield</span><b style={{ fontWeight: 500 }}>{format(c.dividend_yield_pct, "pct")}</b></div>
            </div>
            <h3 className="sechead">Where it sits in its industry</h3>
            <IndustryPosition d={d} c={c} metrics={["pe", "pb", "roe_pct", "dividend_yield_pct", "ret_1y", "market_cap_cr"]} />
            {c.industry && (
              <>
                <h3 className="sechead">{c.industry} · PE vs 1-year return</h3>
                <PeerScatter d={d} c={c} onPick={onPick} />
              </>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Link className="btn primary" style={{ flex: 1, justifyContent: "center" }} to={`/c/${encodeURIComponent(c.ticker)}`}>Open full page →</Link>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
