import { useEffect, useRef, useState } from "react";
import { actions, useWatchlists } from "../data/watchlists";

/** Button + menu to add companies to any watchlist (or a new one). */
export function AddToWatchlist({ isins, compact = false, label = "Add to watchlist" }: { isins: string[]; compact?: boolean; label?: string }) {
  const lists = useWatchlists();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const inAll = (id: string) => isins.every((i) => lists.find((w) => w.id === id)?.isins.includes(i));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={`btn ${compact ? "icon" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        data-tip={compact ? "Add to watchlist (W)" : undefined} aria-label={label} data-add-watchlist>
        {compact ? "☆" : `☆ ${label}`}
      </button>
      {open && (
        <div className="menu" role="menu" style={{ right: 0, top: 34 }}>
          {lists.map((w) => {
            const on = inAll(w.id);
            return (
              <div key={w.id} className="item" role="menuitemcheckbox" aria-checked={on}
                onClick={() => (on ? actions.drop(w.id, isins) : actions.add(w.id, isins))}>
                <span className={`cb ${on ? "on" : ""}`} />{w.name}<span className="muted" style={{ marginLeft: "auto" }}>{w.isins.length}</span>
              </div>
            );
          })}
          <hr />
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { actions.create(name, isins); setName(""); setOpen(false); } }}
            style={{ padding: 4, display: "flex", gap: 6 }}>
            <input className="input" style={{ height: 28, flex: 1 }} placeholder="New watchlist" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn sm" type="submit">Create</button>
          </form>
        </div>
      )}
    </div>
  );
}
