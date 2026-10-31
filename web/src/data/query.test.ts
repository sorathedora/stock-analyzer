import { describe, expect, it } from "vitest";
import { compile, QueryError } from "./query";

const tcs = { pe: 17.4, roe_pct: 48, market_cap_cr: 896562, industry: "Information Technology", dividend_yield_pct: 4.5, above_dma_200: false };
const loss = { pe: null, roe_pct: -5, market_cap_cr: 900, industry: "Chemicals" };

describe("query", () => {
  it("compares with friendly names and and/or", () => {
    const q = compile("pe < 20 and roe > 15");
    expect(q.test(tcs)).toBe(true);
    expect(q.test(loss)).toBe(false);
    expect(compile("PE > 30 OR mcap < 1000").test(loss)).toBe(true);
  });
  it("treats missing values as not matching", () => {
    expect(compile("pe < 1000").test(loss)).toBe(false);
    expect(compile("not pe < 1000").test(loss)).toBe(true);
  });
  it("supports arithmetic and parentheses", () => {
    expect(compile("(dy * 2) >= 9 and mcap / 1000 > 800").test(tcs)).toBe(true);
    expect(compile("-roe > 0").test(loss)).toBe(true);
  });
  it("matches text exactly or by contains", () => {
    expect(compile('industry ~ "tech"').test(tcs)).toBe(true);
    expect(compile('industry = "chemicals"').test(loss)).toBe(true);
    expect(compile('industry != "chemicals"').test(tcs)).toBe(true);
  });
  it("compares booleans as 0/1", () => {
    expect(compile("above_dma_200 = 0").test(tcs)).toBe(true);
  });
  it("reports clear errors with positions", () => {
    expect(() => compile("pe <")).toThrowError(QueryError);
    expect(() => compile("pee < 3")).toThrowError(/Unknown field "pee"/);
    expect(() => compile("pe < 3 roe")).toThrowError(/Unexpected "roe"/);
  });
  it("lists the fields used", () => {
    expect(compile("pe < 20 and roe > 15").fields.sort()).toEqual(["pe", "roe_pct"]);
  });
});
