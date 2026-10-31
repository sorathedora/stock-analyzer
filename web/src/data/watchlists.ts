/**
 * Watchlists live in the browser (instant, works offline) and sync to the
 * server's /api/watchlists when it is reachable, so every device sees the
 * same lists. The most recently changed copy wins.
 */
import { useSyncExternalStore } from "react";

export interface Watchlist {
  id: string;
  name: string;
  isins: string[];
  preset?: string;
  columns?: string[];
  query?: string;
  filters?: Record<string, { min?: number; max?: number; text?: string }>;
  notes?: Record<string, string>;
}
interface State { lists: Watchlist[]; updated: number }

const KEY = "watchlists.v1";
const listeners = new Set<() => void>();
let state: State = read();
let syncing: Promise<void> | null = null;

function read(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "");
    if (s && Array.isArray(s.lists)) return s;
  } catch { /* first visit or storage blocked */ }
  return { lists: [{ id: "core", name: "My watchlist", isins: [] }], updated: 0 };
}

function write(next: State, push = true) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ }
  listeners.forEach((l) => l());
  if (push) void pushRemote();
}

const update = (fn: (lists: Watchlist[]) => Watchlist[]) => write({ lists: fn(state.lists), updated: Date.now() });

export function useWatchlists() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state.lists);
}
export const getLists = () => state.lists;

const newId = () => Math.random().toString(36).slice(2, 10);

export const actions = {
  create(name: string, isins: string[] = []) {
    const w = { id: newId(), name: name.trim() || "Untitled", isins };
    update((ls) => [...ls, w]);
    return w.id;
  },
  rename(id: string, name: string) { update((ls) => ls.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w))); },
  remove(id: string) { update((ls) => ls.filter((w) => w.id !== id)); },
  add(id: string, isins: string[]) {
    update((ls) => ls.map((w) => (w.id === id ? { ...w, isins: [...w.isins, ...isins.filter((i) => !w.isins.includes(i))] } : w)));
  },
  drop(id: string, isins: string[]) {
    update((ls) => ls.map((w) => (w.id === id ? { ...w, isins: w.isins.filter((i) => !isins.includes(i)) } : w)));
  },
  setView(id: string, view: Partial<Pick<Watchlist, "preset" | "columns" | "query" | "filters">>) {
    update((ls) => ls.map((w) => (w.id === id ? { ...w, ...view } : w)));
  },
  setNote(id: string, isin: string, note: string) {
    update((ls) => ls.map((w) => (w.id === id ? { ...w, notes: { ...w.notes, [isin]: note } } : w)));
  },
};

async function pushRemote() {
  try {
    await fetch("/api/watchlists", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch { /* offline or no server: the local copy is kept */ }
}

/** Pull the server copy; keep whichever side changed last. */
export function syncFromServer() {
  syncing ??= (async () => {
    try {
      const r = await fetch("/api/watchlists");
      if (!r.ok) return;
      const remote = (await r.json()) as State | null;
      if (remote && Array.isArray(remote.lists) && remote.updated > state.updated) write(remote, false);
      else if (state.updated > (remote?.updated ?? 0)) await pushRemote();
    } catch { /* offline */ } finally { syncing = null; }
  })();
  return syncing;
}
