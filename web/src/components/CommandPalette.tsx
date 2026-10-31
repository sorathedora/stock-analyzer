import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { num, signed, tone } from "../data/format";
import { search, type Dataset } from "../data/store";
import { toggleTheme } from "../data/theme";
import { useWatchlists } from "../data/watchlists";

type Item = { id: string; group: string; label: React.ReactNode; hint?: React.ReactNode; run: () => void };

export function CommandPalette({ d, open, onClose, onNewList }: { d: Dataset; open: boolean; onClose: () => void; onNewList: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const lists = useWatchlists();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => { nav(to); onClose(); };
    const companies: Item[] = search(d, q, q ? 8 : 0).map((c) => ({
      id: c.isin, group: "Companies",
      label: <><b style={{ fontWeight: 500 }}>{c.short}</b><span className="mono muted">{c.ticker}</span></>,
      hint: <span className="num">₹{num(c.close)} <span className={tone(c.change_pct)}>{signed(c.change_pct)}</span></span>,
      run: go(`/c/${encodeURIComponent(c.ticker)}`),
    }));
    const s = q.trim().toLowerCase();
    const match = (t: string) => !s || t.toLowerCase().includes(s);
    const pages: Item[] = [
      ...lists.map((w) => ({ id: `w-${w.id}`, group: "Watchlists", label: w.name, hint: `${w.isins.length}`, run: go(`/w/${w.id}`) })),
      { id: "all", group: "Go to", label: "All companies", run: go("/all") },
      { id: "ind", group: "Go to", label: "Industries", run: go("/industries") },
      ...d.industries.filter(() => s.length > 1).map((n) => ({ id: `i-${n}`, group: "Industries", label: n, run: go(`/industries/${encodeURIComponent(n)}`) })),
      { id: "new", group: "Actions", label: "New watchlist", run: () => { onClose(); onNewList(); } },
      { id: "theme", group: "Actions", label: "Toggle dark mode", run: () => { toggleTheme(); onClose(); } },
    ].filter((x) => match(typeof x.label === "string" ? x.label : x.group));
    return [...companies, ...pages].slice(0, 30);
  }, [d, q, lists, nav, onClose, onNewList]);

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Search and commands">
        <input
          ref={input} value={q} placeholder={`Search ${d.companies.length.toLocaleString("en-IN")} companies, watchlists, industries…`}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
            if (e.key === "Enter") items[i]?.run();
          }}
          aria-activedescendant={items[i]?.id}
        />
        <div className="results" role="listbox">
          {items.map((it, idx) => {
            const head = it.group !== lastGroup ? <div className="group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head}
                <div id={it.id} role="option" aria-selected={idx === i} className={`item ${idx === i ? "on" : ""}`}
                  onMouseEnter={() => setI(idx)} onClick={it.run}>
                  {it.label}<span className="k">{it.hint}</span>
                </div>
              </div>
            );
          })}
          {!items.length && <div className="empty" style={{ padding: 24 }}>No matches for “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}
