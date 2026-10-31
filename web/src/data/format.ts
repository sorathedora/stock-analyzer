import type { Format } from "./columns";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: min, maximumFractionDigits: max });
const n0 = nf(0, 0), n1 = nf(1, 1), n2 = nf(2, 2);

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function num(v: unknown, digits = 2): string {
  if (!isNum(v)) return "—";
  return (digits === 0 ? n0 : digits === 1 ? n1 : n2).format(v);
}

/** ₹ crore, shortened to lakh crore above 1,00,000. */
export function crore(v: unknown): string {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e5) return `${n2.format(v / 1e5)} L Cr`;
  if (a >= 100) return `${n0.format(v)} Cr`;
  return `${n1.format(v)} Cr`;
}

export function signed(v: unknown, digits = 1): string {
  if (!isNum(v)) return "—";
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}${num(Math.abs(v), digits)}%`;
}

export function format(v: unknown, f: Format): string {
  switch (f) {
    case "price": return isNum(v) ? num(v, 2) : "—";
    case "pct": return isNum(v) ? `${num(v, 1)}%` : "—";
    case "signed": return signed(v);
    case "ratio": return isNum(v) ? num(v, Math.abs(v) >= 100 ? 0 : 1) : "—";
    case "crore": return crore(v);
    case "int": return isNum(v) ? num(v, 0) : "—";
    case "date": return typeof v === "string" ? shortDate(v) : "—";
    case "bool": return v === true ? "Yes" : v === false ? "No" : "—";
    default: return v == null ? "—" : String(v);
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function monthYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

export const tone = (v: unknown) => (isNum(v) ? (v > 0 ? "up" : v < 0 ? "down" : "") : "");

export function cleanName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s+(Limited|Ltd\.?)$/i, "").replace(/\s{2,}/g, " ");
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st … */
export function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
