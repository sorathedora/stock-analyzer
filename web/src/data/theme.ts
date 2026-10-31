import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");

function current(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || t === "light" ? t : media.matches ? "dark" : "light";
}

media.addEventListener("change", () => listeners.forEach((l) => l()));

export function toggleTheme() {
  const next = current() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* storage blocked */ }
  listeners.forEach((l) => l());
}

export const useTheme = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, current);
