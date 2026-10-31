/**
 * Watchlist sync (Cloudflare Pages Function, D1 database bound as DB).
 *
 *   GET /api/watchlists   -> the saved state, or null
 *   PUT /api/watchlists   -> save the state unless the server copy is newer;
 *                            replies with whichever copy is kept
 *
 * Every request needs "Authorization: Bearer <sync key>", where the key
 * matches the SYNC_KEY secret. One person, one row.
 */
interface D1 {
  prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } };
}
interface Env { DB: D1; SYNC_KEY: string }
interface Ctx { request: Request; env: Env }
interface State { lists: unknown[]; updated: number }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function digest(s: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Compares hashes so the time taken says nothing about the key. */
async function authorised(request: Request, env: Env) {
  if (!env.SYNC_KEY) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const [a, b] = await Promise.all([digest(given), digest(env.SYNC_KEY)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return given.length > 0 && diff === 0;
}

async function stored(env: Env): Promise<State | null> {
  const row = await env.DB.prepare("SELECT body FROM watchlists WHERE id = 'me'").bind().first<{ body: string }>();
  return row ? JSON.parse(row.body) : null;
}

export async function onRequest({ request, env }: Ctx) {
  if (!(await authorised(request, env))) return json({ error: "wrong or missing sync key" }, 401);
  if (request.method === "GET") return json(await stored(env));
  if (request.method !== "PUT") return json({ error: "use GET or PUT" }, 405);

  const text = await request.text();
  if (text.length > 1_000_000) return json({ error: "too large" }, 413);
  let next: State;
  try { next = JSON.parse(text); } catch { return json({ error: "not JSON" }, 400); }
  if (!Array.isArray(next?.lists) || typeof next.updated !== "number") return json({ error: "expected {lists, updated}" }, 400);

  const current = await stored(env);
  if (current && current.updated > next.updated) return json(current);
  await env.DB.prepare(
    "INSERT INTO watchlists (id, body, updated) VALUES ('me', ?1, ?2) ON CONFLICT(id) DO UPDATE SET body = ?1, updated = ?2",
  ).bind(text, next.updated).run();
  return json(next);
}
