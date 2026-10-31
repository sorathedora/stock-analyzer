import { useEffect, useState } from "react";

export interface ResultRow extends Record<string, unknown> {
  basis: string;
  period: "quarter" | "year_to_date";
  period_start: string;
  period_end: string;
  months: number;
}
export interface CompanyFile {
  d: number[];          // days since 1970-01-01
  c: number[];          // adjusted close
  h: (number | null)[];
  l: (number | null)[];
  v: number[];
  actions?: [string, string, number | null, string][];
  results?: ResultRow[];
  shareholding?: Record<string, unknown>[];
}

const cache = new Map<string, Promise<CompanyFile | null>>();

export function fetchCompany(isin: string) {
  if (!cache.has(isin)) {
    cache.set(isin, fetch(`/data/company/${isin}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(isin)!;
}

export function useCompanyFile(isin: string | null) {
  const [state, setState] = useState<{ isin: string | null; file: CompanyFile | null; loading: boolean }>({ isin: null, file: null, loading: false });
  useEffect(() => {
    if (!isin) return;
    let live = true;
    setState((s) => ({ isin, file: s.isin === isin ? s.file : null, loading: true }));
    fetchCompany(isin).then((file) => live && setState({ isin, file, loading: false }));
    return () => { live = false; };
  }, [isin]);
  return state.isin === isin ? state : { isin, file: null, loading: !!isin };
}

export const dayToIso = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10);
