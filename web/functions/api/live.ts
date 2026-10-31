/**
 * Intraday prices: Google Finance's (up to 20 minutes delayed) from the
 * published Google Sheet, as {at, prices: {isin: price}}. Cached at the
 * edge for 5 minutes, so the sheet is read at most that often.
 */
interface Env { LIVE_SHEET_URL?: string }

export async function onRequestGet({ env }: { env: Env }) {
  const headers = { "content-type": "application/json", "cache-control": "max-age=120" };
  if (!env.LIVE_SHEET_URL) return new Response(JSON.stringify({ at: null, prices: {} }), { headers });
  const r = await fetch(env.LIVE_SHEET_URL, { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
  if (!r.ok) return new Response(JSON.stringify({ error: `sheet ${r.status}` }), { status: 502, headers });
  const text = (await r.text()).trim();
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head.split(",");
  const isin = cols.indexOf("isin");
  const price = cols.indexOf("price");
  // Google sometimes answers with an HTML error page; say so instead of "no prices".
  if (isin < 0 || price < 0) return new Response(JSON.stringify({ error: "sheet isn't CSV with isin and price columns", got: text.slice(0, 120) }), { status: 502, headers });
  const prices: Record<string, number> = {};
  {
    for (const line of lines) {
      const f = line.split(",");
      const p = Number(f[price]);
      if (f[isin] && f[price] && Number.isFinite(p) && p > 0) prices[f[isin]] = p;
    }
  }
  return new Response(JSON.stringify({ at: new Date().toISOString(), prices }), { headers });
}
