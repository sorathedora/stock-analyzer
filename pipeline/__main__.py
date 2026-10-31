"""Price pipeline.

    python -m pipeline daily              # fetch days since the last stored day
    python -m pipeline backfill START END # fetch a date range (YYYY-MM-DD)
    python -m pipeline metrics            # rebuild company list and metrics only
    python -m pipeline filings            # collect new results/shareholding filings
    python -m pipeline ratios             # rebuild ratios from stored data
    python -m pipeline sheet [PATH]       # write the Google Finance sheet (.xlsx)
    python -m pipeline archive START END  # re-read NSE's archive for stored days
    python -m pipeline names START END [--every N]  # company names from past price files
    python -m pipeline industries         # industry of every company from Rediff (resumable)
    python -m pipeline fundamentals       # import annual-report figures from Rediff (resumable)
    python -m pipeline export [DIR]       # write companies.json for the web app
"""
import argparse
import sys
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from . import archive, collect, export, google, prices, ratios, rediff, store, universe
from .bhavcopy import combine, fetch_bse, fetch_nse

HISTORY_YEARS = 6  # enough for 5-year returns
BACKFILL_WORKERS = 4  # days downloaded at once; kept low to stay polite


def _with_isin(df, symbol_to_isin):
    return df.assign(isin=df["symbol"].map(symbol_to_isin))


def fetch_day_safely(day):
    """fetch_day, but a failure is returned instead of stopping the run."""
    try:
        return fetch_day(day)
    except Exception as e:
        return e


def fetch_day(day):
    """Prices plus NSE archive data for one day, or None on a holiday."""
    nse, bse = fetch_nse(day), fetch_bse(day)
    rows = combine(nse, bse)
    if rows is None:
        return None
    arc = archive.fetch(day) or {}
    symbol_to_isin = nse.drop_duplicates("symbol").set_index("symbol")["isin"] if nse is not None else pd.Series(dtype=str)

    shares = arc.get("shares")
    if shares is not None:
        s = _with_isin(shares, symbol_to_isin).dropna(subset=["isin"]).drop_duplicates("isin")
        rows = rows.merge(s[["isin", "shares"]], on="isin", how="left")
        rows.loc[rows["exchange"] != "NSE", "shares"] = None
    actions = arc.get("actions")
    if actions is not None and not actions.empty:
        actions = _with_isin(archive.expand_actions(actions), symbol_to_isin)
    pe = arc.get("pe")
    if pe is not None:
        pe = _with_isin(pe, symbol_to_isin)
    names = pd.concat([f.assign(last_seen=pd.Timestamp(day))[["isin", "exchange", "symbol", "name", "last_seen"]]
                       for f in (nse, bse) if f is not None], ignore_index=True)
    return {"prices": rows, "actions": actions, "pe": pe, "names": names, "nse": nse, "bse": bse}


def fetch_range(start, end, workers=1, skip_stored=False):
    """Fetch and store each weekday; return the last trading day's raw files.

    Several days can be downloaded at once (backfills); results are still
    stored in date order. With skip_stored, days already saved are skipped,
    so an interrupted backfill can resume.
    """
    days = list(pd.bdate_range(start, end))
    if skip_stored:
        stored = store.stored_dates()
        days = [d for d in days if d not in stored]
    latest, failed = None, []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        # Store every 60 days so memory stays small and progress is saved.
        for i in range(0, len(days), 60):
            chunk = days[i:i + 60]
            batch = {"prices": [], "actions": [], "pe": [], "names": []}
            for day, got in zip(chunk, pool.map(fetch_day_safely, chunk)):
                if isinstance(got, Exception):
                    print(f"{day.date()} FAILED: {got!r}")
                    failed.append(day)
                    continue
                if got is None:
                    print(f"{day.date()} holiday / no files")
                    continue
                for key in batch:
                    batch[key].append(got[key])
                latest = (day, got["nse"], got["bse"])
                n_actions = 0 if got["actions"] is None else len(got["actions"])
                print(f"{day.date()} {len(got['prices'])} companies, {n_actions} corporate actions")
            for key, save in (("prices", store.save_prices), ("actions", store.save_actions),
                              ("pe", store.save_nse_pe), ("names", store.save_names)):
                frames = [f for f in batch[key] if f is not None and not f.empty]
                if frames:
                    save(pd.concat(frames, ignore_index=True))
    if failed:
        # Stored days are skipped on the next run, so a rerun retries only these.
        print(f"{len(failed)} days failed: {', '.join(str(d.date()) for d in failed)}")
    return latest


def refetch_archive(start, end):
    """Re-download only NSE's archive (corporate actions, shares, PE) for
    days already stored, e.g. after fixing how those files are read."""
    stored = store.load_prices(since_year=pd.Timestamp(start).year)
    nse = stored[(stored["exchange"] == "NSE") & stored["date"].between(start, end)]
    days = sorted(nse["date"].unique())

    def one(day):
        try:
            return day, archive.fetch(day)
        except Exception as e:
            return day, e

    actions, pe = [], []
    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as pool:
        for day, arc in pool.map(one, days):
            if isinstance(arc, Exception) or arc is None:
                print(f"{pd.Timestamp(day).date()} skipped: {arc!r}")
                continue
            symbol_to_isin = nse[nse["date"] == day].drop_duplicates("symbol").set_index("symbol")["isin"]
            if arc["actions"] is not None and not arc["actions"].empty:
                actions.append(_with_isin(archive.expand_actions(arc["actions"]), symbol_to_isin))
            if arc["pe"] is not None:
                pe.append(_with_isin(arc["pe"], symbol_to_isin))
    if actions:
        store.save_actions(pd.concat(actions, ignore_index=True))
    if pe:
        store.save_nse_pe(pd.concat(pe, ignore_index=True))
    print(f"{len(days)} days re-read: {sum(len(a) for a in actions)} corporate actions")


def fill_names(start, end, every=1):
    """Read past price files only for company names (BSE files always carry
    them). Reading one day in `every` is enough for most companies."""
    days = list(pd.bdate_range(start, end))[::every]

    def one(day):
        try:
            return [f.assign(last_seen=day)[["isin", "exchange", "symbol", "name", "last_seen"]]
                    for f in (fetch_bse(day), fetch_nse(day)) if f is not None]
        except Exception as e:
            print(f"{day.date()} skipped: {e!r}")
            return []
    frames = []
    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as pool:
        for got in pool.map(one, days):
            frames.extend(got)
    if frames:
        store.save_names(pd.concat(frames, ignore_index=True))
    print(f"{len(days)} days read for names")


def with_names(u):
    """Add companies that didn't trade on the day the list was built, using
    the last name and symbol seen for them."""
    names = store.load(store.NAMES)
    if names is None:
        return u
    names = names.dropna(subset=["isin"]).sort_values("last_seen")
    nse = names[names["exchange"] == "NSE"].drop_duplicates("isin", keep="last").set_index("isin")
    bse = names[names["exchange"] == "BSE"].drop_duplicates("isin", keep="last").set_index("isin")
    missing = sorted((set(nse.index) | set(bse.index)) - set(u["isin"]))
    add = pd.DataFrame({"isin": missing})
    add["nse_symbol"] = add["isin"].map(nse["symbol"])
    add["bse_code"] = add["isin"].map(bse["symbol"])
    add["name"] = add["isin"].map(nse["name"]).fillna(add["isin"].map(bse["name"])).fillna(add["nse_symbol"])
    add["listed_on"] = [("NSE+BSE" if n and b else "NSE" if n else "BSE") for n, b in zip(add["nse_symbol"].notna(), add["bse_code"].notna())]
    add["last_seen"] = add["isin"].map(names.drop_duplicates("isin", keep="last").set_index("isin")["last_seen"])
    # Fill names still blank in the list itself.
    u = u.copy()
    blank = u["name"].isna()
    u.loc[blank, "name"] = u.loc[blank, "isin"].map(nse["name"]).fillna(u.loc[blank, "isin"].map(bse["name"]))
    return pd.concat([u, add], ignore_index=True)


def rebuild(latest):
    if latest is not None and latest[1] is not None and latest[2] is not None:
        day, nse, bse = latest
        u = store.save_universe(universe.build(day, nse, bse), day)
    else:
        u = pd.read_parquet(store.UNIVERSE)
    since = pd.Timestamp.today().year - HISTORY_YEARS
    p, actions, links = prices.link_isins(store.load_prices(since_year=since), store.load_actions())
    # Old ISINs of split shares now live under their current ISIN.
    u = with_names(u)
    u = u[~u["isin"].isin(links)]
    m = store.save_metrics(prices.metrics(p, actions), u)
    prices.adjustments(p, actions).to_csv(store.DATA / "adjustments.csv", index=False)
    print(f"{len(u)} companies, metrics as of {m['as_of'].max().date()}")
    build_ratios(m, eps_history(p, actions, links))


def eps_history(p=None, actions=None, links=None):
    """EPS implied by NSE's published PE (last day: March 2025), for PEG."""
    nse_pe = store.load(store.NSE_PE)
    if nse_pe is None or nse_pe.empty:
        return None
    if p is None:
        p, actions, links = prices.link_isins(store.load_prices(since_year=nse_pe["date"].max().year), store.load_actions())
    nse_pe = nse_pe.assign(isin=nse_pe["isin"].replace(links or {}))
    return ratios.eps_then(nse_pe, prices.add_adjustment(p, actions))


def build_ratios(price_metrics=None, history=None):
    if price_metrics is None:
        price_metrics = pd.read_parquet(store.METRICS)
        history = eps_history()
    g = google.fetch()
    if g is not None:
        store.save_google(g.assign(date=price_metrics["as_of"].max()))
    u = with_names(pd.read_parquet(store.UNIVERSE))
    annual = store.load(store.ANNUAL)
    if annual is not None and "fy_end" in annual:
        annual = rediff.match_isins(annual.dropna(subset=["fy_end"]), u)
    industries = store.load(store.INDUSTRIES)
    if industries is not None and "industry" in industries:
        industries = rediff.match_isins(industries.dropna(subset=["industry"]), u)
    r = ratios.compute(price_metrics, store.load(store.RESULTS), g, store.load(store.SHAREHOLDING), history, annual, industries)
    store.save_ratios(r)
    counts = r["pe_source"].value_counts().to_dict()
    print(f"ratios for {len(r)} companies; PE from {counts}; checks {r['pe_check'].value_counts().to_dict()}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("daily")
    b = sub.add_parser("backfill")
    b.add_argument("start")
    b.add_argument("end")
    sub.add_parser("metrics")
    sub.add_parser("filings")
    sub.add_parser("ratios")
    s = sub.add_parser("sheet")
    s.add_argument("path", nargs="?", default="google_sheet.xlsx")
    n = sub.add_parser("names")
    n.add_argument("start")
    n.add_argument("end")
    n.add_argument("--every", type=int, default=1, help="read one day in N")
    a = sub.add_parser("archive")
    a.add_argument("start")
    a.add_argument("end")
    sub.add_parser("industries")
    f = sub.add_parser("fundamentals")
    f.add_argument("--limit", type=int, default=None, help="read only the first N companies (testing)")
    f.add_argument("--fresh", action="store_true", help="re-read companies already imported")
    e = sub.add_parser("export")
    e.add_argument("out_dir", nargs="?", default="web/public/data")
    args = ap.parse_args(argv)

    if args.cmd == "names":
        fill_names(args.start, args.end, args.every)
        rebuild(None)
        return
    if args.cmd == "archive":
        refetch_archive(args.start, args.end)
        rebuild(None)
        return
    if args.cmd == "industries":
        have = store.load(store.INDUSTRIES)
        done = set() if have is None else set(have.loc[have["industry"].notna(), "rediff_url"])
        rediff.import_industries(done=done, save=store.save_industries)
        build_ratios()
        return
    if args.cmd == "fundamentals":
        urls = rediff.company_urls()[: args.limit]
        have = store.load(store.ANNUAL)
        done = set() if args.fresh or have is None else set(have.loc[have["fy_end"].notna(), "rediff_url"])
        rediff.import_all(urls, done=done, save=store.save_annual)
        build_ratios()
        return
    if args.cmd == "export":
        export.write(args.out_dir)
        return

    if args.cmd == "filings":
        collect.collect()
        return
    if args.cmd == "ratios":
        build_ratios()
        return
    if args.cmd == "sheet":
        # Companies traded in the last 30 days; delisted ones would only add errors.
        m = pd.read_parquet(store.METRICS)
        m = m[m["last_trade_date"] >= m["last_trade_date"].max() - pd.Timedelta(days=30)]
        n = google.make_sheet(m.sort_values("name"), args.path)
        print(f"wrote {n} companies to {args.path}")
        return
    if args.cmd == "backfill":
        latest = fetch_range(args.start, args.end, workers=BACKFILL_WORKERS, skip_stored=True)
        if latest is None:
            print("Nothing new in this range")
            return
    elif args.cmd == "daily":
        last = store.last_price_date()
        if last is None:
            sys.exit("No stored prices; run backfill first")
        start = last + pd.Timedelta(days=1)
        today = pd.Timestamp.now(tz="Asia/Kolkata").normalize().tz_localize(None)
        if start > today:
            print("Up to date")
            return
        latest = fetch_range(start, today)
        if latest is None:
            print("No new trading days")
            return
    else:
        latest = None
    rebuild(latest)


if __name__ == "__main__":
    main()
