/**
 * Intraday prices: Google Finance's (up to 20 minutes delayed) from the
 * published Google Sheet, as {at, prices: {isin: price}}. Cached at the
 * edge for 5 minutes, so the sheet is read at most that often.
 */
interface Env { LIVE_SHEET_URL?: string }

export async function onRequestGet({ env }: { env: Env }) {
  const headers = { "content-type": "application/json", "cache-control": "public, max-age=120" };
  if (!env.LIVE_SHEET_URL) return new Response(JSON.stringify({ at: null, prices: {} }), { headers });
  const r = await fetch(env.LIVE_SHEET_URL, { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
  if (!r.ok) return new Response(JSON.stringify({ error: `sheet ${r.status}` }), { status: 502, headers });
  const [head, ...lines] = (await r.text()).trim().split(/\r?\n/);
  const cols = head.split(",");
  const isin = cols.indexOf("isin");
  const price = cols.indexOf("price");
  const prices: Record<string, number> = {};
  if (isin >= 0 && price >= 0) {
    for (const line of lines) {
      const f = line.split(",");
      const p = Number(f[price]);
      if (f[isin] && f[price] && Number.isFinite(p) && p > 0) prices[f[isin]] = p;
    }
  }
  return new Response(JSON.stringify({ at: new Date().toISOString(), prices }), { headers });
}
