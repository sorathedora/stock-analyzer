import { useMemo, useState } from "react";
import { format } from "../data/format";
import type { Company } from "../data/store";
import type { ColFilter } from "./ColumnFilter";

/** Owner types in a fixed order; each keeps its colour whatever is shown. */
const OWNERS = ["Central PSU", "State PSU", "Indian promoter", "MNC", "No promoter"] as const;
const OWNER_HELP: Record<string, string> = {
  "Central PSU": "Owned by the central government, directly or through another PSU",
  "State PSU": "Owned by a state government",
  "Indian promoter": "Run by an Indian promoter family or group",
  MNC: "Controlled by a foreign parent",
  "No promoter": "Widely held with no controlling shareholder",
};
const PSU_GROUPS = ["Maharatna", "Navratna", "Miniratna", "PSU bank", "PSU insurer", "PSU subsidiary", "PSU joint venture", "Other CPSE", "State PSU"];

type Weight = "count" | "mcap";
/** Sectors listed before "Show all". */
const TOP = 8;

function readWeight(): Weight {
  try { return localStorage.getItem("breakdown.weight") === "mcap" ? "mcap" : "count"; } catch { return "count"; }
}

const ownerOf = (c: Company) => (OWNERS as readonly string[]).includes(c.owner_type as string) ? (c.owner_type as string) : "Indian promoter";
const mcap = (c: Company) => (typeof c.market_cap_cr === "number" ? c.market_cap_cr : 0);

interface Tally { n: number; mcap: number }
const add = (t: Tally | undefined, c: Company): Tally => ({ n: (t?.n ?? 0) + 1, mcap: (t?.mcap ?? 0) + mcap(c) });

/** A 100% bar split by owner type, with a gap between segments. */
function OwnerBar({ parts, total, weight, label, height = 14 }: { parts: Map<string, Tally>; total: Tally; weight: Weight; label: string; height?: number }) {
  const of = (t: Tally) => (weight === "count" ? t.n : t.mcap);
  const whole = of(total) || 1;
  return (
    <div className="obar" style={{ height }} role="img" aria-label={label}>
      {OWNERS.filter((o) => parts.get(o) && of(parts.get(o)!) > 0).map((o) => {
        const t = parts.get(o)!;
        const pct = (of(t) / whole) * 100;
        return <i key={o} style={{ flexGrow: of(t), background: `var(--own-${OWNERS.indexOf(o) + 1})` }}
          data-tip={`${label} · ${o}: ${t.n} ${t.n === 1 ? "company" : "companies"} · ₹${format(t.mcap, "crore")} market cap · ${pct.toFixed(0)}% by ${weight === "count" ? "count" : "market cap"}`} />;
      })}
    </div>
  );
}

/** Sector, PSU vs private, and sector × ownership breakdowns of the rows shown. */
export function Breakdown({ rows, filters, onFilter }: { rows: Company[]; filters?: Record<string, ColFilter>; onFilter: (key: string, f: ColFilter | null) => void }) {
  const [weight, setWeightState] = useState<Weight>(readWeight);
  const [all, setAll] = useState(false);
  const setWeight = (w: Weight) => { setWeightState(w); try { localStorage.setItem("breakdown.weight", w); } catch { /* ignore */ } };
  const of = (t: Tally) => (weight === "count" ? t.n : t.mcap);

  const s = useMemo(() => {
    const total: Tally = { n: 0, mcap: 0 };
    const owners = new Map<string, Tally>();
    const groups = new Map<string, Tally>();
    const sectors = new Map<string, { all: Tally; owners: Map<string, Tally> }>();
    for (const c of rows) {
      Object.assign(total, add(total, c));
      const o = ownerOf(c);
      owners.set(o, add(owners.get(o), c));
      if (c.ownership === "PSU" && c.psu_group) groups.set(c.psu_group as string, add(groups.get(c.psu_group as string), c));
      const sec = (c.sector as string) || "Unclassified";
      const e = sectors.get(sec) ?? { all: { n: 0, mcap: 0 }, owners: new Map() };
      e.all = add(e.all, c);
      e.owners.set(o, add(e.owners.get(o), c));
      sectors.set(sec, e);
    }
    const psu = (["Central PSU", "State PSU"] as const).reduce((a, o) => ({ n: a.n + (owners.get(o)?.n ?? 0), mcap: a.mcap + (owners.get(o)?.mcap ?? 0) }), { n: 0, mcap: 0 });
    return { total, owners, groups, sectors, psu, priv: { n: total.n - psu.n, mcap: total.mcap - psu.mcap } };
  }, [rows]);

  const sectors = [...s.sectors].sort((a, b) => of(b[1].all) - of(a[1].all) || a[0].localeCompare(b[0]));
  const maxSector = Math.max(1, ...sectors.map(([, e]) => of(e.all)));
  const listed = all ? sectors : sectors.slice(0, TOP);
  const more = sectors.length > TOP && (
    <button className="btn ghost sm" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={() => setAll(!all)}>
      {all ? `Top ${TOP} only` : `Show all ${sectors.length} sectors`}
    </button>
  );
  const share = (t: Tally) => `${((of(t) / (of(s.total) || 1)) * 100).toFixed(0)}%`;
  const picked = (key: string, v: string) => !!filters?.[key]?.any?.includes(v);
  const toggle = (key: string, v: string) => onFilter(key, picked(key, v) ? null : { any: [v] });
  const groups = PSU_GROUPS.filter((g) => s.groups.get(g));
  const maxGroup = Math.max(1, ...groups.map((g) => of(s.groups.get(g)!)));

  if (!rows.length) return null;
  return (
    <div className="breakdown">
      <div className="bd-head">
        <span className="soft">Breakdown of the {s.total.n} {s.total.n === 1 ? "company" : "companies"} shown · click a row to filter</span>
        <span className="seg" style={{ marginLeft: "auto" }}>
          <button className={weight === "count" ? "on" : ""} onClick={() => setWeight("count")} data-tip="Each company counts once">By count</button>
          <button className={weight === "mcap" ? "on" : ""} onClick={() => setWeight("mcap")} data-tip="Weighted by market cap">By market cap</button>
        </span>
      </div>
      <div className="bd-grid">
        <section className="card">
          <h3>By sector</h3>
          <div className="bd-rows">
            {listed.map(([sec, e]) => (
              <button key={sec} className={`bd-row ${picked("sector", sec) ? "on" : ""}`} onClick={() => sec !== "Unclassified" && toggle("sector", sec)}
                data-tip={`${sec}: ${e.all.n} ${e.all.n === 1 ? "company" : "companies"} · ₹${format(e.all.mcap, "crore")} market cap`}>
                <span className="bd-label">{sec}</span>
                <span className="bd-track"><i style={{ width: `${(of(e.all) / maxSector) * 100}%` }} /></span>
                <span className="bd-val num">{share(e.all)} <span className="muted">· {e.all.n}</span></span>
              </button>
            ))}
            {more}
          </div>
        </section>

        <section className="card">
          <h3>PSU vs private</h3>
          <div className="bd-split">
            <button className={`bd-big ${picked("ownership", "PSU") ? "on" : ""}`} onClick={() => toggle("ownership", "PSU")}>
              <span className="muted">PSU</span><b className="num">{share(s.psu)}</b><span className="muted num">{s.psu.n} · ₹{format(s.psu.mcap, "crore")}</span>
            </button>
            <button className={`bd-big ${picked("ownership", "Private") ? "on" : ""}`} onClick={() => toggle("ownership", "Private")}>
              <span className="muted">Private</span><b className="num">{share(s.priv)}</b><span className="muted num">{s.priv.n} · ₹{format(s.priv.mcap, "crore")}</span>
            </button>
          </div>
          <OwnerBar parts={s.owners} total={s.total} weight={weight} label="All shown" height={18} />
          <div className="bd-rows" style={{ marginTop: 12 }}>
            {OWNERS.map((o, i) => {
              const t = s.owners.get(o);
              if (!t) return null;
              return (
                <button key={o} className={`bd-row ${picked("owner_type", o) ? "on" : ""}`} onClick={() => toggle("owner_type", o)} data-tip={OWNER_HELP[o]}>
                  <span className="bd-label"><span className="sw" style={{ background: `var(--own-${i + 1})` }} />{o}</span>
                  <span className="bd-val num">{share(t)} <span className="muted">· {t.n}</span></span>
                </button>
              );
            })}
          </div>
          {groups.length > 0 && <>
            <h3 style={{ marginTop: 16 }}>Within PSUs</h3>
            <div className="bd-rows">
              {groups.map((g) => {
                const t = s.groups.get(g)!;
                return (
                  <button key={g} className={`bd-row ${picked("psu_group", g) ? "on" : ""}`} onClick={() => toggle("psu_group", g)}
                    data-tip={`${g}: ${t.n} ${t.n === 1 ? "company" : "companies"} · ₹${format(t.mcap, "crore")} market cap`}>
                    <span className="bd-label">{g}</span>
                    <span className="bd-track"><i style={{ width: `${(of(t) / maxGroup) * 100}%` }} /></span>
                    <span className="bd-val num">{((of(t) / (of(s.psu) || 1)) * 100).toFixed(0)}% <span className="muted">· {t.n}</span></span>
                  </button>
                );
              })}
            </div>
          </>}
        </section>

        <section className="card bd-wide">
          <h3>Sector by ownership</h3>
          <div className="bd-legend">
            {OWNERS.map((o, i) => <span key={o} data-tip={OWNER_HELP[o]}><span className="sw" style={{ background: `var(--own-${i + 1})` }} />{o}</span>)}
          </div>
          <div className="bd-rows">
            {listed.map(([sec, e]) => {
              const psu = (e.owners.get("Central PSU")?.n ?? 0) + (e.owners.get("State PSU")?.n ?? 0);
              return (
                <div key={sec} className="bd-row static">
                  <span className="bd-label">{sec}</span>
                  <span className="bd-track plain"><OwnerBar parts={e.owners} total={e.all} weight={weight} label={sec} /></span>
                  <span className="bd-val num">{psu} PSU <span className="muted">· {e.all.n - psu} pvt</span></span>
                </div>
              );
            })}
            {more}
          </div>
        </section>
      </div>
      <p className="note" style={{ margin: "8px 0 0" }}>
        PSU status comes from a hand-kept list of about 100 government-owned companies: DPE's Maharatna, Navratna and Miniratna lists, PSU banks and insurers, PSU subsidiaries, and state PSUs.
        MNC and no-promoter tags cover well-known names only. Any other company counts as Indian promoter.
      </p>
    </div>
  );
}
