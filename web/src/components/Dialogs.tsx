import { useState } from "react";
import { BY_KEY, COLUMNS, VISUAL } from "../data/columns";
import type { Dataset } from "../data/store";
import { parseIsins } from "../data/watchlists";

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

/** Paste ISINs / NSE symbols / BSE codes, or load a CSV or text file. */
export function ImportDialog({ d, onImport, onClose }: { d: Dataset; onImport: (isins: string[]) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const lookup = (t: string) => d.byTicker.get(t)?.isin;
  const parsed = parseIsins(text, lookup);
  // Keep well-formed ISINs we have no data for (delisted, suspended, funds):
  // the watchlist shows them as missing and picks them up if data appears.
  const keepIsins = parsed.unknown.filter((t) => /^IN[A-Z0-9]{10}$/i.test(t)).map((t) => t.toUpperCase());
  const found = [...parsed.found, ...keepIsins];
  const unknown = parsed.unknown.filter((t) => !/^IN[A-Z0-9]{10}$/i.test(t));
  return (
    <Modal title="Add companies" onClose={onClose}>
      <p className="soft" style={{ marginTop: 0 }}>
        Paste ISINs, NSE symbols or BSE codes: one per line, or copy a whole column straight from Excel. You can also load a .csv or .txt file.
      </p>
      <textarea className="input" style={{ width: "100%", height: 180, padding: 10, fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
        autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={"INE002A01018\nTCS\n500209"} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <label className="btn">
          Load file
          <input type="file" accept=".csv,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        </label>
        <span className="soft">
          {parsed.found.length} found{keepIsins.length ? ` · ${keepIsins.length} ISINs with no current data (kept)` : ""}{unknown.length ? ` · ${unknown.length} not recognised` : ""}
        </span>
        <button className="btn primary" style={{ marginLeft: "auto" }} disabled={!found.length} onClick={() => { onImport(found); onClose(); }}>
          Add {found.length || ""} {found.length === 1 ? "company" : "companies"}
        </button>
      </div>
      {unknown.length > 0 && <div className="note">Not recognised: {unknown.slice(0, 12).join(", ")}{unknown.length > 12 ? "…" : ""}</div>}
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
