/**
 * Intraday prices from /api/live (Google Finance, up to 20 minutes delayed),
 * read every 5 minutes on weekdays from the open until the evening data
 * brings the official close.
 */
import { applyLive, type Dataset } from "./store";

const EVERY_MS = 5 * 60 * 1000;

/** Today's date and minutes past midnight in India. */
function nowIst() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekend: ["Sat", "Sun"].includes(get("weekday")),
  };
}

/** True while the official close for today isn't in the data yet. */
export function wantsLive(asOf: string) {
  const t = nowIst();
  return !t.weekend && t.minutes >= 9 * 60 + 15 && asOf < t.date;
}

async function refresh() {
  try {
    const r = await fetch("/api/live");
    if (!r.ok) return;
    const { at, prices } = (await r.json()) as { at: string | null; prices: Record<string, number> };
    if (at && prices) applyLive(prices, at);
  } catch { /* offline: keep what is shown */ }
}

/** Start polling; returns a function that stops it. */
export function startLive(getData: () => Dataset | null) {
  const tick = () => {
    const d = getData();
    if (d && document.visibilityState === "visible" && wantsLive(d.asOf)) void refresh();
  };
  tick();
  const timer = setInterval(tick, EVERY_MS);
  document.addEventListener("visibilitychange", tick);
  return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
}
