import { useEffect, useState } from "react";
import { num } from "../data/format";

export function Spark({ values, w = 92, h = 26 }: { values?: number[]; w?: number; h?: number }) {
  if (!values || values.length < 2) return <span className="muted">—</span>;
  const mn = Math.min(...values), mx = Math.max(...values);
  const up = values[values.length - 1] >= values[0];
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={`var(--${up ? "up" : "down"})`} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function RangeBar({ low, high, value }: { low?: unknown; high?: unknown; value?: unknown }) {
  if (typeof low !== "number" || typeof high !== "number" || typeof value !== "number" || high <= low)
    return <span className="muted">—</span>;
  const pos = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
  return (
    <span className="rng" data-tip={`52-week low ${num(low)} · high ${num(high)} · ${num(((high - value) / high) * 100, 1)}% below high`}>
      <i style={{ left: `${pos}%` }} />
    </span>
  );
}

export function PctBar({ pct, tip }: { pct: number; tip: string }) {
  return (
    <span className="pbar" data-tip={tip}>
      <i style={{ width: `${pct}%` }} />
      <u />
    </span>
  );
}

const TRUST: Record<string, [string, string]> = {
  verified: ["var(--ok)", "Verified: own filings and Google Finance agree within 10%"],
  mismatch: ["var(--down)", "Mismatch: own filings and Google Finance disagree by more than 10%, or one shows a loss. Check before relying on it."],
  "single source": ["var(--warn)", "Single source: only one source has earnings for this company so far"],
};
export function TrustDot({ check, source, note }: { check?: unknown; source?: unknown; note?: unknown }) {
  const t = typeof check === "string" ? TRUST[check] : undefined;
  if (!t) return null;
  const src = source === "filings" ? "Company filings" : source === "google" ? "Google Finance EPS" : "";
  const extra = note ? ` · ${note}` : "";
  return <span className="trust" style={{ background: t[0] }} data-tip={`${t[1]}${src ? ` · PE from ${src}` : ""}${extra}`} />;
}

/** One tooltip for the whole app: any element with data-tip shows it on hover. */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el || !el.dataset.tip) { setTip(null); return; }
      const x = Math.min(e.clientX + 12, window.innerWidth - 350);
      setTip({ text: el.dataset.tip, x, y: e.clientY + 16 });
    };
    const hide = () => setTip(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("scroll", hide, true);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("scroll", hide, true); };
  }, []);
  return tip ? <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div> : null;
}
