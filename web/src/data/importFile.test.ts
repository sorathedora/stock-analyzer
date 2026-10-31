import { describe, expect, it } from "vitest";
import { parseCells, sheetCells, textCells } from "./importFile";

const data: Record<string, string> = { TCS: "INE467B01029", "532540": "INE467B01029", TITAN: "INE280A01028", RELIANCE: "INE002A01018" };
const lookup = (t: string) => data[t];
const known = (i: string) => Object.values(data).includes(i);

describe("importing a company list", () => {
  it("uses only ISINs when the file has any, ignoring words in names", () => {
    const cells = ["Script", "ISIN", "Titan Company Ltd", "INE280A01028", "Reliance Power", "ine002a01018", "Delisted Co", "INE999Z01011", "INE280A01028"];
    const r = parseCells(cells, lookup, known);
    expect(r.by).toBe("isin");
    expect(r.found).toEqual(["INE280A01028", "INE002A01018"]);   // lower case read, repeats dropped
    expect(r.noData).toEqual(["INE999Z01011"]);                   // kept, shown as "no data"
  });
  it("accepts BSE codes and capitalised symbols next to ISINs", () => {
    const r = parseCells(textCells("500325\n532540\nINE002A01018\nTitan"), lookup, known);
    expect(r.found).toEqual(["INE002A01018", "INE467B01029"]);    // 532540 is TCS; "Titan" is a word, not a code
    expect(r.unknown).toEqual(["500325"]);                         // not in this test's data
  });
  it("falls back to symbols and BSE codes, one per cell", () => {
    const r = parseCells(textCells("TCS\n532540\nTITAN, FOOBAR\nTitan Company"), lookup, known);
    expect(r.by).toBe("symbol");
    expect(r.found).toEqual(["INE467B01029", "INE280A01028"]);    // TCS and 532540 are the same company
    expect(r.unknown).toEqual(["FOOBAR"]);
  });
  it("reports nothing found for unrelated text", () => {
    expect(parseCells(textCells("hello world"), lookup, known).by).toBe("none");
  });
});

describe("reading a sheet", () => {
  it("uses only the ISIN column when there is one", () => {
    const rows = [
      [null, null, null], ["Script", "ISIN", "Note"],
      ["Titan Company", "INE280A01028", null],
      ["K-Lifestyle", null, "Fully paid ISIN is INE218A01028"],
    ];
    expect(sheetCells(rows)).toEqual(["INE280A01028"]);
  });
  it("reads every cell when no column is headed ISIN", () => {
    expect(sheetCells([["TCS", "INFY"], ["ITC", null]])).toEqual(["TCS", "INFY", "ITC"]);
  });
});
