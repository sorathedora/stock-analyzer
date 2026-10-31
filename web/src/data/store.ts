import { useSyncExternalStore } from "react";
import { COLUMNS } from "./columns";
import { cleanName } from "./format";

export interface Company extends Record<string, unknown> {
  isin: string;
  name: string;
  short: string;
  nse_symbol: string | null;
  bse_code: string | null;
  industry: string | null;
  active: boolean;
  /** NSE symbol, else BSE code: what the URL and the UI show. */
  ticker: string;
}

export interface Dataset {
  asOf: string;
  generated: string;
  companies: Company[];
  byIsin: Map<string, Company>;
  byTicker: Map<string, Company>;
  industries: string[];
  sparks: Record<string, number[]>;
  /** Sorted values per metric, per industry and for the whole market. */
  dist: Map<string, Map<string, Float64Array>>;
  /** Set while intraday prices are shown: when they were read, and for how many companies. */
  live?: { at: string; count: number };
}

let data: Dataset | null = null;
let error: string | null = null;
const listeners = new Set<() => void>();

const ALL = "__all__";

function buildDist(companies: Company[]) {
  const dist = new Map<string, Map<string, Float64Array>>();
  const numeric = COLUMNS.filter((c) => !["date", "text", "bool"].includes(c.format)).map((c) => c.key);
  for (const key of numeric) {
    const groups = new Map<string, number[]>();
    for (const c of companies) {
      const v = c[key];
      if (!c.active || typeof v !== "number" || !Number.isFinite(v)) continue;
      for (const g of [ALL, c.industry ?? ""]) {
        if (!g) continue;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(v);
      }
    }
    const sorted = new Map<string, Float64Array>();
    for (const [g, vals] of groups) sorted.set(g, Float64Array.from(vals).sort());
    dist.set(key, sorted);
  }
  return dist;
}

export async function load() {
  if (data) return;
  try {
    const [cRes, sRes] = await Promise.all([fetch("/data/companies.json"), fetch("/data/sparks.json")]);
    if (!cRes.ok) throw new Error(`Couldn't load company data (${cRes.status})`);
    const raw = (await cRes.json()) as { columns: string[]; rows: unknown[][]; as_of: string; generated: string };
    const sparks = sRes.ok ? await sRes.json() : {};
    const companies: Company[] = raw.rows.map((row) => {
      const o: Record<string, unknown> = {};
      raw.columns.forEach((k, i) => (o[k] = row[i]));
      const c = o as Company;
      c.short = cleanName(c.name);
      c.ticker = c.nse_symbol ?? c.bse_code ?? c.isin;
      return c;
    });
    const industries = [...new Set(companies.map((c) => c.industry).filter(Boolean) as string[])].sort();
    data = {
      asOf: raw.as_of, generated: raw.generated, companies, sparks, industries,
      byIsin: new Map(companies.map((c) => [c.isin, c])),
      // Find a company by NSE symbol, BSE code or ISIN. Active companies win
      // a symbol that an old, delisted company also used.
      byTicker: new Map(
        [...companies].sort((a, b) => Number(a.active) - Number(b.active)).flatMap((c) =>
          [c.nse_symbol, c.bse_code, c.isin].filter(Boolean).map((k) => [String(k).toUpperCase(), c] as [string, Company])),
      ),
      dist: buildDist(companies),
    };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  listeners.forEach((l) => l());
}

/** Fields that move with the price, saved before the first live update. */
const LIVE_FIELDS = ["close", "change_pct", "market_cap_cr", "pe", "pb", "peg", "ev_cr", "ev_ebitda",
  "dividend_yield_pct", "earnings_yield_pct", "high_52w", "low_52w", "pct_from_52w_high", "pct_from_52w_low",
  "above_dma_50", "above_dma_200", "ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y", "ret_5y"];
const base = new Map<string, Record<string, unknown>>();
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Show intraday prices on top of the last official close. Everything tied to
 * the price (market cap, PE, PB, yields, returns, 52-week position) is
 * rescaled; the official figures come back with the next daily data.
 */
export function applyLive(prices: Record<string, number>, at: string) {
  if (!data) return;
  let count = 0;
  for (const c of data.companies) {
    const b = base.get(c.isin);
    if (b) Object.assign(c, b);
    const p = prices[c.isin];
    const close = c.close;
    if (!num(p) || !num(close) || close <= 0 || p === close) continue;
    const f = p / close;
    if (f < 0.5 || f > 2) continue; // a split or a bad quote, not a day's move
    if (!b) base.set(c.isin, Object.fromEntries(LIVE_FIELDS.map((k) => [k, c[k]])));
    const scale = (k: string, by: number) => { if (num(c[k])) c[k] = (c[k] as number) * by; };
    c.close = p;
    c.change_pct = (f - 1) * 100;
    if (num(c.market_cap_cr) && num(c.ev_cr) && c.ev_cr > 0) {
      const ev = c.ev_cr + c.market_cap_cr * (f - 1);
      scale("ev_ebitda", ev / c.ev_cr);
      c.ev_cr = ev;
    }
    for (const k of ["market_cap_cr", "pe", "pb", "peg"]) scale(k, f);
    for (const k of ["dividend_yield_pct", "earnings_yield_pct"]) scale(k, 1 / f);
    for (const k of ["ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y", "ret_5y"]) {
      if (num(c[k])) c[k] = ((1 + (c[k] as number) / 100) * f - 1) * 100;
    }
    if (num(c.high_52w)) { const h = Math.max(c.high_52w, p); c.high_52w = h; c.pct_from_52w_high = (p / h - 1) * 100; }
    if (num(c.low_52w)) { const l = Math.min(c.low_52w, p); c.low_52w = l; c.pct_from_52w_low = (p / l - 1) * 100; }
    if (num(c.dma_50)) c.above_dma_50 = p > c.dma_50;
    if (num(c.dma_200)) c.above_dma_200 = p > c.dma_200;
    count++;
  }
  data = { ...data, dist: buildDist(data.companies), live: count ? { at, count } : undefined };
  listeners.forEach((l) => l());
}

export function useData() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => data,
  );
}
export const loadError = () => error;
export const getData = () => data;

/**
 * Where a value sits among peers: percentile 0–100, the median and the group
 * size. Uses the industry when it has at least 5 companies with that metric,
 * otherwise the whole market.
 */
export function rank(d: Dataset, key: string, value: unknown, industry: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const groups = d.dist.get(key);
  if (!groups) return null;
  let arr = industry ? groups.get(industry) : undefined;
  let scope = industry ?? "";
  if (!arr || arr.length < 5) { arr = groups.get(ALL); scope = "all companies"; }
  if (!arr || !arr.length) return null;
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= value) lo = m + 1; else hi = m; }
  return { pct: Math.round((lo / arr.length) * 100), median: arr[arr.length >> 1], n: arr.length, scope };
}

/** Ranked search over names, symbols, BSE codes and ISINs. */
export function search(d: Dataset, q: string, limit = 8): Company[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const scored: [number, Company][] = [];
  for (const c of d.companies) {
    const t = c.ticker.toLowerCase(), n = c.short.toLowerCase();
    let score = 0;
    if (t === s || c.isin.toLowerCase() === s) score = 100;
    else if (t.startsWith(s)) score = 80;
    else if (n.startsWith(s)) score = 70;
    else if (n.includes(` ${s}`)) score = 55;
    else if (n.includes(s)) score = 40;
    else if (c.bse_code === s) score = 90;
    if (!score) continue;
    if (c.active) score += 5;
    score += Math.min(10, Math.log10((c.market_cap_cr as number) || 1));
    scored.push([score, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}
