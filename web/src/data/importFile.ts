/**
 * Read a list of companies from pasted text or a CSV / TXT / XLSX file.
 *
 * ISINs are always used. A cell is also read as an NSE symbol or BSE code
 * when it holds exactly one code: a 6-digit BSE code, or an all-capitals
 * symbol (when the input has ISINs too). Words inside company names, such
 * as "Titan" in "Titan Company", never match by accident.
 */
const ISIN = /\bIN[A-Z0-9]{9}\d\b/gi;
const ISIN_ONE = /^IN[A-Z0-9]{9}\d$/i;

export interface Parsed {
  /** ISINs that match a company in the data, in file order, no repeats. */
  found: string[];
  /** Well-formed ISINs with no data (delisted, suspended, funds): kept. */
  noData: string[];
  /** Cells that looked like codes but matched nothing. */
  unknown: string[];
  by: "isin" | "symbol" | "none";
}

export function parseCells(cells: string[], lookup: (token: string) => string | undefined, known: (isin: string) => boolean): Parsed {
  const isins: string[] = [];
  for (const cell of cells) for (const m of String(cell).toUpperCase().matchAll(ISIN)) if (!isins.includes(m[0])) isins.push(m[0]);
  const found = isins.filter(known), noData = isins.filter((i) => !known(i)), unknown: string[] = [];
  let bySymbol = 0;
  for (const raw of cells) {
    const cell = String(raw).trim().replace(/^"|"$/g, "");
    if (!cell || /\s/.test(cell) || cell.length > 20 || ISIN_ONE.test(cell)) continue;
    // Alongside ISINs, accept only unmistakable codes, not ordinary words.
    if (isins.length && !/^\d{6}$/.test(cell) && !/^[A-Z0-9&-]{2,20}$/.test(cell)) continue;
    const isin = lookup(cell.toUpperCase());
    if (isin) { if (!found.includes(isin)) { found.push(isin); bySymbol++; } }
    else if (/^[A-Z0-9&-]{2,20}$/i.test(cell)) unknown.push(cell.toUpperCase());
  }
  const by = isins.length ? "isin" : bySymbol ? "symbol" : "none";
  return { found, noData, unknown, by };
}

/** Cells of pasted text: split on new lines, tabs, commas and semicolons. */
export const textCells = (text: string) => text.split(/[\r\n\t,;]+/);

export interface Sheet { name: string; cells: string[] }

const ISIN_HEADER = /^\s*isin(\s*(code|number|no\.?))?\s*$/i;

/**
 * The cells to read from a sheet. If a column is headed "ISIN" (or "ISIN
 * code"), only that column is used, so ISINs mentioned in notes or other
 * columns aren't picked up by mistake.
 */
export function sheetCells(rows: unknown[][]): string[] {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const c = rows[r].findIndex((v) => typeof v === "string" && ISIN_HEADER.test(v));
    if (c >= 0) return rows.slice(r + 1).map((row) => row[c]).filter((v) => v !== null && v !== undefined).map(String);
  }
  return rows.flat().filter((v) => v !== null && v !== undefined).map(String);
}

/** All sheets of a file as lists of cells. CSV and TXT give one sheet. */
export async function readFile(file: File): Promise<Sheet[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile, readSheetNames } = await import("read-excel-file");
    const names = await readSheetNames(file);
    const sheets: Sheet[] = [];
    for (const name of names) {
      const rows = await readXlsxFile(file, { sheet: name });
      sheets.push({ name, cells: sheetCells(rows as unknown[][]) });
    }
    return sheets;
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error("Old .xls files aren't supported. In Excel, use Save As → .xlsx or .csv, then try again.");
  }
  const text = await file.text();
  if (/\.csv$/i.test(file.name)) {
    const rows = text.split(/\r?\n/).map((line) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
    return [{ name: file.name, cells: sheetCells(rows) }];
  }
  return [{ name: file.name, cells: textCells(text) }];
}

export const baseName = (file: File) => file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
