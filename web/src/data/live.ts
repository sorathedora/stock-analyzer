/**
 * Intraday prices from /api/live (Google Finance, up to 20 minutes delayed),
 * read every 5 minutes on weekdays from the open until the evening data
 * brings the official close. On other days (weekend sessions such as Muhurat
 * trading) they are read only when asked, with checkLive.
 */
import { applyLive, type Dataset } from "./store";

const EVERY_MS = 5 * 60 * 1000;

/** Today's date, minutes past midnight and whether it is a weekend, in India. */
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

/** True on weekend days, when the evening run doesn't load the official close. */
export const isWeekend = () => nowIst().weekend;

/** True while today's official close isn't in the data yet, on a weekday. */
export function wantsLive(asOf: string) {
  const t = nowIst();
  return !t.weekend && t.minutes >= 9 * 60 + 15 && asOf < t.date;
}

/** Read the quotes once: "live" if the market traded, "closed" if not. */
export async function checkLive(): Promise<"live" | "closed" | "failed"> {
  try {
    const r = await fetch("/api/live");
    if (!r.ok) return "failed";
    const { at, prices } = (await r.json()) as { at: string | null; prices: Record<string, number> };
    if (!at || !prices) return "failed";
    return applyLive(prices, at) ? "live" : "closed";
  } catch {
    return "failed";
  }
}

/** Start polling; returns a function that stops it. */
export function startLive(getData: () => Dataset | null) {
  const tick = () => {
    const d = getData();
    if (d && document.visibilityState === "visible" && wantsLive(d.asOf)) void checkLive();
  };
  tick();
  const timer = setInterval(tick, EVERY_MS);
  document.addEventListener("visibilitychange", tick);
  return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
}
