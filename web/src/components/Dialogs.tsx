import { useEffect, useState } from "react";
import { BY_KEY, COLUMNS, VISUAL } from "../data/columns";
import type { Dataset } from "../data/store";
import { baseName, parseCells, readFile, textCells, type Parsed, type Sheet } from "../data/importFile";

function Modal({ title, onClose, children, width = 560 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={{ width }}>
        <div className="body">
          <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ flex: 1 }}>{title}</h2>
            <button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Paste box + file picker that reads ISINs (or symbols) and summarises what matched. */
function ListInput({ d, onParsed, onFileName }: { d: Dataset; onParsed: (p: Parsed | null) => void; onFileName?: (name: string) => void }) {
  const [text, setText] = useState("");
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheet, setSheet] = useState(0);
  const [file, setFile] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const lookup = (t: string) => d.byTicker.get(t)?.isin;
  const known = (i: string) => d.byIsin.has(i);
  const parse = (cells: string[]) => parseCells(cells, lookup, known);

  const cells = sheets ? sheets[sheet]?.cells ?? [] : textCells(text);
  const parsed = cells.length ? parse(cells) : null;
  const report = parsed && parsed.by !== "none" ? parsed : null;
  useEffect(() => { onParsed(report); }, [report?.found.length, report?.noData.length, sheet, text, sheets]);

  const load = async (f: File) => {
    setErr(""); setBusy(true);
    try {
      const s = await readFile(f);
      // Start on the sheet with the most ISINs or codes.
      const scores = s.map((sh) => { const p = parse(sh.cells); return p.found.length + p.noData.length; });
      setSheets(s); setSheet(scores.indexOf(Math.max(...scores))); setFile(f.name); setText("");
      onFileName?.(baseName(f));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally { setBusy(false); }
  };

  return (
    <div>
      {!sheets ? (
        <textarea className="input" style={{ width: "100%", height: 140, padding: 10, fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
          value={text} onChange={(e) => setText(e.target.value)} placeholder={"Paste ISINs (or NSE symbols / BSE codes), one per line, or a column copied from Excel\nINE002A01018\nINE467B01029"}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void load(f); }} />
      ) : (
        <div className="banner" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>📄 <b>{file}</b></span>
          {sheets.length > 1 && (
            <select className="input" style={{ height: 26 }} value={sheet} onChange={(e) => setSheet(Number(e.target.value))} aria-label="Sheet">
              {sheets.map((s, i) => <option key={s.name} value={i}>Sheet: {s.name}</option>)}
            </select>
          )}
          <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => { setSheets(null); setFile(null); }}>Use a different list</button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <label className="btn">
          {busy ? "Reading…" : "Choose file (.xlsx, .csv)"}
          <input type="file" accept=".xlsx,.csv,.txt,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f); }} />
        </label>
        <span className="muted" style={{ fontSize: 12 }}>or drop a file on the box</span>
      </div>
      {err && <div style={{ color: "var(--down)", marginTop: 8 }}>{err}</div>}
      {cells.length > 0 && (
        <div className="soft" style={{ marginTop: 10 }}>
          {report ? <>
            <b>{report.found.length.toLocaleString("en-IN")}</b> {report.found.length === 1 ? "company" : "companies"} found{report.by === "isin" ? " by ISIN" : " by symbol/code"}
            {report.noData.length > 0 && <> · <b>{report.noData.length}</b> ISINs with no market data (delisted, suspended or funds), kept so you can see them</>}
            {report.unknown.length > 0 && <> · not recognised: {report.unknown.slice(0, 8).join(", ")}{report.unknown.length > 8 ? "…" : ""}</>}
          </> : <span style={{ color: "var(--down)" }}>No ISINs, NSE symbols or BSE codes found{sheets && sheets.length > 1 ? " in this sheet; try another" : ""}.</span>}
        </div>
      )}
    </div>
  );
}

/** Add companies to an existing watchlist. */
export function ImportDialog({ d, onImport, onClose }: { d: Dataset; onImport: (isins: string[]) => void; onClose: () => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const all = parsed ? [...parsed.found, ...parsed.noData] : [];
  return (
    <Modal title="Add companies" onClose={onClose}>
      <ListInput d={d} onParsed={setParsed} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!all.length} onClick={() => { onImport(all); onClose(); }}>
          Add {all.length ? all.length.toLocaleString("en-IN") : ""} {all.length === 1 ? "company" : "companies"}
        </button>
      </div>
    </Modal>
  );
}

/** Create a watchlist, optionally filled from a file or pasted list. */
export function NewWatchlistDialog({ d, onCreate, onClose }: { d: Dataset; onCreate: (name: string, isins: string[]) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const all = parsed ? [...parsed.found, ...parsed.noData] : [];
  const finalName = name.trim();
  const submit = () => { if (!finalName) { setTouched(true); return; } onCreate(finalName, all); };
  return (
    <Modal title="New watchlist" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="soft" style={{ fontSize: 12 }}>Name</label>
        <input className="input" style={{ width: "100%", marginBottom: 4 }} autoFocus placeholder="e.g. Long-term holdings" value={name}
          onChange={(e) => { setName(e.target.value); setTouched(true); }} />
        {touched && !finalName && <div style={{ color: "var(--down)", fontSize: 12 }}>Enter a name for the watchlist.</div>}
        <div className="soft" style={{ fontSize: 12, margin: "12px 0 6px" }}>Companies (optional: you can add them later)</div>
        <ListInput d={d} onParsed={setParsed} onFileName={(n) => { if (!name.trim()) setName(n); }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Create{all.length ? ` with ${all.length.toLocaleString("en-IN")} companies` : ""}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Choose and order the table's columns. */
export function ColumnPicker({ columns, onChange, onClose }: { columns: string[]; onChange: (c: string[]) => void; onClose: () => void }) {
  const [sel, setSel] = useState(columns);
  const [q, setQ] = useState("");
  const groups = [...new Set(COLUMNS.map((c) => c.group))];
  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const move = (k: string, by: number) => setSel((s) => {
    const i = s.indexOf(k), j = i + by;
    if (j < 0 || j >= s.length) return s;
    const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const label = (k: string) => (k in VISUAL ? VISUAL[k as keyof typeof VISUAL] : BY_KEY[k]?.label ?? k);
  const match = (t: string) => t.toLowerCase().includes(q.toLowerCase());
  return (
    <Modal title="Columns" onClose={onClose} width={760}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 16 }}>
        <div>
          <input className="input" style={{ width: "100%", marginBottom: 8 }} placeholder="Find a metric" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div style={{ maxHeight: 400, overflow: "auto" }}>
            {[["Charts", Object.keys(VISUAL)] as const, ...groups.map((g) => [g, COLUMNS.filter((c) => c.group === g).map((c) => c.key)] as const)].map(([g, keys]) => {
              const shown = keys.filter((k) => match(label(k)));
              if (!shown.length) return null;
              return (
                <div key={g} style={{ marginBottom: 10 }}>
                  <div className="sec" style={{ padding: 0 }}>{g}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                    {shown.map((k) => (
                      <label key={k} className="item" style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 6px", cursor: "pointer", borderRadius: 6 }}
                        data-tip={BY_KEY[k]?.help}>
                        <span className={`cb ${sel.includes(k) ? "on" : ""}`} onClick={() => toggle(k)} />
                        <span onClick={() => toggle(k)}>{label(k)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 16 }}>
          <div className="sec" style={{ padding: 0 }}>Shown, in order</div>
          {sel.map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 0" }}>
              <span style={{ flex: 1 }}>{label(k)}</span>
              <button className="btn ghost sm" onClick={() => move(k, -1)} aria-label={`Move ${label(k)} up`}>↑</button>
              <button className="btn ghost sm" onClick={() => move(k, 1)} aria-label={`Move ${label(k)} down`}>↓</button>
              <button className="btn ghost sm" onClick={() => toggle(k)} aria-label={`Remove ${label(k)}`}>✕</button>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => { onChange(sel); onClose(); }}>Apply</button>
      </div>
    </Modal>
  );
}
