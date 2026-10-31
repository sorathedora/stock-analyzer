import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { NewWatchlistDialog, SyncDialog } from "./components/Dialogs";
import { Tooltips } from "./components/visuals";
import { format } from "./data/format";
import { startLive } from "./data/live";
import { getData, load, loadError, useData, type Dataset } from "./data/store";
import { toggleTheme, useTheme } from "./data/theme";
import { actions, syncFromServer, useSyncStatus, useWatchlists } from "./data/watchlists";
import { CompanyPage } from "./pages/CompanyPage";
import { ComparePage } from "./pages/ComparePage";
import { AllPage, IndustriesPage, IndustryPage, WatchlistPage } from "./pages/Screens";

const SYNC_DOT = { off: "var(--ink-3)", on: "var(--ok)", badkey: "var(--down)", offline: "var(--warn)" };
const SYNC_LABEL = { off: "This device only", on: "Synced", badkey: "Sync key rejected", offline: "Sync waiting" };

function Rail({ d, onSearch, onNewList, onSync, open, onClose }: { d: Dataset; onSearch: () => void; onNewList: () => void; onSync: () => void; open: boolean; onClose: () => void }) {
  const lists = useWatchlists();
  const sync = useSyncStatus();
  const theme = useTheme();
  const active = d.companies.filter((c) => c.active).length;
  return (
    <aside className={`rail ${open ? "open" : ""}`} aria-label="Navigation" onClick={(e) => (e.target as HTMLElement).closest("a") && onClose()}>
      <div className="brand">
        <i aria-hidden="true"><svg width="14" height="14" viewBox="0 0 32 32"><path d="M5 22l7-7 5 5 10-11" stroke="white" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></i>
        Parakh
      </div>
      <button className="searchbox" onClick={onSearch}><span>Search</span><kbd>⌘K</kbd></button>
      <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="sec">Watchlists<button aria-label="New watchlist" data-tip="New watchlist (from a file, a pasted list, or empty)" onClick={onNewList}>+</button></div>
        <nav className="nav">
          {lists.map((w) => (
            <NavLink key={w.id} to={`/w/${w.id}`}><span>{w.name}</span><span className="count num">{w.isins.length}</span></NavLink>
          ))}
        </nav>
      </div>
      <div>
        <div className="sec">Explore</div>
        <nav className="nav">
          <NavLink to="/all"><span>All companies</span><span className="count num">{active.toLocaleString("en-IN")}</span></NavLink>
          <NavLink to="/industries"><span>Industries</span><span className="count num">{d.industries.length}</span></NavLink>
          <NavLink to="/compare"><span>Compare</span></NavLink>
        </nav>
      </div>
      <div className="fresh">
        {d.live ? (
          <div data-tip={`Google Finance prices (up to 20 minutes delayed) for ${d.live.count.toLocaleString("en-IN")} companies, on top of the ${format(d.asOf, "date")} close. PE, market cap and other price-based figures move with them; official closing figures arrive in the evening.`}>
            <span className="dot live" style={{ background: "var(--up)" }} />Live <b>{new Date(d.live.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</b> · ~20 min delay
          </div>
        ) : (
          <div><span className="dot" style={{ background: "var(--ok)" }} />Prices <b>{format(d.asOf, "date")} close</b></div>
        )}
        <div className="muted">Data built {d.generated} IST</div>
        <div><button onClick={onSync} data-tip="Sync watchlists across devices"><span className="dot" style={{ background: SYNC_DOT[sync] }} />Watchlists: {SYNC_LABEL[sync]}</button></div>
        <div style={{ marginTop: 8 }}><button onClick={toggleTheme}>{theme === "dark" ? "Light mode" : "Dark mode"}</button></div>
      </div>
    </aside>
  );
}

function Home() {
  const lists = useWatchlists();
  return <Navigate to={lists.length ? `/w/${lists[0].id}` : "/all"} replace />;
}

export function App() {
  const d = useData();
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const [newList, setNewList] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const nav = useNavigate();
  // Intraday prices once the data is in, until the evening brings the official close.
  const asOf = d?.asOf;
  useEffect(() => (asOf ? startLive(getData) : undefined), [asOf]);
  useEffect(() => {
    void load(); void syncFromServer();
    // Pick up changes made on another device when coming back to this tab.
    const onShow = () => { if (document.visibilityState === "visible") void syncFromServer(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!d) {
    const err = loadError();
    return (
      <div className="app">
        <aside className="rail"><div className="brand">Parakh</div></aside>
        <div className="main" style={{ padding: 20 }}>
          {err ? <div className="empty"><h3>Couldn't load data</h3>{err}. Check your connection and reload.</div>
            : Array.from({ length: 12 }, (_, i) => <div key={i} className="skel" style={{ margin: "18px 0", width: `${60 + ((i * 17) % 35)}%` }} />)}
        </div>
      </div>
    );
  }
  return (
    <div className="app">
      <Rail d={d} onSearch={() => { setMenu(false); setPalette(true); }} onNewList={() => { setMenu(false); setNewList(true); }} onSync={() => { setMenu(false); setSyncOpen(true); }} open={menu} onClose={() => setMenu(false)} />
      {menu && <div className="railscrim" onClick={() => setMenu(false)} />}
      <main className="main">
        <div className="mobilebar">
          <button className="btn icon ghost" aria-label="Menu" onClick={() => setMenu(true)}>☰</button>
          <span style={{ fontWeight: 600 }}>Parakh</span>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setPalette(true)}>Search</button>
        </div>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/w/:id" element={<WatchlistPage d={d} />} />
          <Route path="/all" element={<AllPage d={d} />} />
          <Route path="/industries" element={<IndustriesPage d={d} />} />
          <Route path="/industries/:name" element={<IndustryPage d={d} />} />
          <Route path="/c/:ticker" element={<CompanyPage d={d} />} />
          <Route path="/compare" element={<ComparePage d={d} />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <CommandPalette d={d} open={palette} onClose={() => setPalette(false)} onNewList={() => setNewList(true)} />
      {newList && (
        <NewWatchlistDialog d={d} onClose={() => setNewList(false)}
          onCreate={(name, isins) => { const id = actions.create(name, isins); setNewList(false); nav(`/w/${id}`); }} />
      )}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
      <Tooltips />
    </div>
  );
}
