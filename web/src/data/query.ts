/**
 * Screener-style queries such as `pe < 20 and roe > 15`.
 *
 * Grammar (case-insensitive):
 *   expr  := and ("or" and)*
 *   and   := not ("and" not)*
 *   not   := "not" not | cmp
 *   cmp   := sum (("<"|"<="|">"|">="|"="|"=="|"!=") sum | "~" string)?
 *   sum   := term (("+"|"-") term)*
 *   term  := unary (("*"|"/") unary)*
 *   unary := "-" unary | atom
 *   atom  := number | string | name | "(" expr ")"
 * `~` is a case-insensitive "contains" for text fields.
 * Comparisons with a missing value are false, as in Screener.
 */
import { COLUMNS } from "./columns";

export type Row = Record<string, unknown>;
type Fn = (r: Row) => unknown;

const NAMES: Record<string, string> = {};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
for (const c of COLUMNS) {
  NAMES[c.key] = c.key;
  NAMES[norm(c.label)] = c.key;
  for (const a of c.aliases ?? []) NAMES[a] = c.key;
}
Object.assign(NAMES, { industry: "industry", sector: "sector", sub_industry: "sub_industry", name: "name", symbol: "nse_symbol", nse_symbol: "nse_symbol", bse_code: "bse_code" });

export const queryNames = () => Object.keys(NAMES);

type Tok = { t: "num" | "str" | "name" | "op" | "lp" | "rp" | "end"; v: string; at: number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|"([^"]*)"|'([^']*)'|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|[<>=~+\-*/])|(\()|(\)))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new QueryError(`Unexpected "${src.slice(i).trim()[0]}"`, i);
    const at = i + m[0].length - m[0].trimStart().length;
    if (m[1]) out.push({ t: "num", v: m[1], at });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: "str", v: m[2] ?? m[3], at });
    else if (m[4]) out.push({ t: "name", v: m[4].toLowerCase(), at });
    else if (m[5]) out.push({ t: "op", v: m[5], at });
    else if (m[6]) out.push({ t: "lp", v: "(", at });
    else out.push({ t: "rp", v: ")", at });
    i = re.lastIndex;
  }
  out.push({ t: "end", v: "", at: src.length });
  return out;
}

export class QueryError extends Error {
  constructor(message: string, public at: number) { super(message); }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface Compiled { test: (r: Row) => boolean; fields: string[] }

export function compile(src: string): Compiled {
  const toks = lex(src);
  let p = 0;
  const fields = new Set<string>();
  const peek = () => toks[p];
  const isWord = (w: string) => peek().t === "name" && peek().v === w;
  const expect = (t: Tok["t"], what: string) => {
    if (peek().t !== t) throw new QueryError(`Expected ${what}`, peek().at);
    return toks[p++];
  };

  function atom(): Fn {
    const k = peek();
    if (k.t === "num") { p++; const v = Number(k.v); return () => v; }
    if (k.t === "str") { p++; return () => k.v; }
    if (k.t === "lp") { p++; const e = or(); expect("rp", '")"'); return e; }
    if (k.t === "name" && !["and", "or", "not"].includes(k.v)) {
      p++;
      const key = NAMES[k.v];
      if (!key) throw new QueryError(`Unknown field "${k.v}"`, k.at);
      fields.add(key);
      return (r) => r[key];
    }
    throw new QueryError(k.t === "end" ? "Query is incomplete" : `Unexpected "${k.v}"`, k.at);
  }
  function unary(): Fn {
    if (peek().t === "op" && peek().v === "-") { p++; const f = unary(); return (r) => { const v = num(f(r)); return v === null ? null : -v; }; }
    return atom();
  }
  function arith(next: () => Fn, ops: string[]): Fn {
    let left = next();
    while (peek().t === "op" && ops.includes(peek().v)) {
      const op = toks[p++].v, l = left, r = next();
      left = (row) => {
        const a = num(l(row)), b = num(r(row));
        if (a === null || b === null) return null;
        return op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : b === 0 ? null : a / b;
      };
    }
    return left;
  }
  const term = () => arith(unary, ["*", "/"]);
  const sum = () => arith(term, ["+", "-"]);
  function cmp(): Fn {
    const left = sum();
    const k = peek();
    if (k.t !== "op" || !["<", "<=", ">", ">=", "=", "==", "!=", "~"].includes(k.v)) return left;
    p++;
    if (k.v === "~") {
      const s = expect("str", "text in quotes after ~").v.toLowerCase();
      return (r) => String(left(r) ?? "").toLowerCase().includes(s);
    }
    const right = sum();
    return (r) => {
      const a = left(r), b = right(r);
      if (typeof a === "string" || typeof b === "string") {
        const eq = String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
        return k.v === "!=" ? !eq : (k.v === "=" || k.v === "==") && eq;
      }
      const x = num(a ?? null) ?? (typeof a === "boolean" ? Number(a) : null);
      const y = num(b ?? null) ?? (typeof b === "boolean" ? Number(b) : null);
      if (x === null || y === null) return false;
      switch (k.v) {
        case "<": return x < y; case "<=": return x <= y;
        case ">": return x > y; case ">=": return x >= y;
        case "!=": return x !== y; default: return x === y;
      }
    };
  }
  function not(): Fn {
    if (isWord("not")) { p++; const f = not(); return (r) => !f(r); }
    return cmp();
  }
  function and(): Fn {
    let left = not();
    while (isWord("and")) { p++; const l = left, r = not(); left = (row) => !!l(row) && !!r(row); }
    return left;
  }
  function or(): Fn {
    let left = and();
    while (isWord("or")) { p++; const l = left, r = and(); left = (row) => !!l(row) || !!r(row); }
    return left;
  }

  if (!src.trim()) return { test: () => true, fields: [] };
  const fn = or();
  if (peek().t !== "end") throw new QueryError(`Unexpected "${peek().v}"`, peek().at);
  return { test: (r) => !!fn(r), fields: [...fields] };
}
