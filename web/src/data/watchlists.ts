/**
 * Watchlists live in the browser (instant, works offline) and sync to the
 * server's /api/watchlists once this device has the sync key, so every
 * device sees the same lists. The most recently changed copy wins.
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

/** off: no key on this device · on: last sync worked · badkey · offline */
export type SyncStatus = "off" | "on" | "badkey" | "offline";
const SYNC_KEY = "sync.key";
let sync: SyncStatus = syncKey() ? "offline" : "off";
const syncListeners = new Set<() => void>();

function syncKey() {
  try { return localStorage.getItem(SYNC_KEY) ?? ""; } catch { return ""; }
}
function setSync(s: SyncStatus) { sync = s; syncListeners.forEach((l) => l()); }
export function useSyncStatus() {
  return useSyncExternalStore((l) => { syncListeners.add(l); return () => syncListeners.delete(l); }, () => sync);
}
/** Save (or clear, with "") this device's sync key, then sync. */
export async function setSyncKey(key: string) {
  try { key ? localStorage.setItem(SYNC_KEY, key.trim()) : localStorage.removeItem(SYNC_KEY); } catch { /* storage blocked */ }
  setSync(key ? "offline" : "off");
  if (key) await syncFromServer();
  return sync;
}

/** Calls the sync API; null when there is no key or the server can't be reached. */
async function api(method: "GET" | "PUT", body?: State): Promise<State | null | undefined> {
  const key = syncKey();
  if (!key) return undefined;
  try {
    const r = await fetch("/api/watchlists", {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { setSync("badkey"); return undefined; }
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) { setSync("offline"); return undefined; }
    setSync("on");
    return (await r.json()) as State | null;
  } catch { setSync("offline"); return undefined; }
}

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

/** Push this device's copy; the server keeps (and returns) whichever is newer. */
async function pushRemote() {
  const kept = await api("PUT", state);
  if (kept && kept.updated > state.updated) write(kept, false);
}

/** Pull the server copy; keep whichever side changed last. */
export function syncFromServer() {
  syncing ??= (async () => {
    try {
      const remote = await api("GET");
      if (remote === undefined) return;
      if (remote && Array.isArray(remote.lists) && remote.updated > state.updated) write(remote, false);
      else if (state.updated > (remote?.updated ?? 0)) await pushRemote();
    } finally { syncing = null; }
  })();
  return syncing;
}
