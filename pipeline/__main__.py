"""Price pipeline.

    python -m pipeline daily              # fetch days since the last stored day
    python -m pipeline backfill START END # fetch a date range (YYYY-MM-DD)
    python -m pipeline metrics            # rebuild company list and metrics only
    python -m pipeline filings            # collect new results/shareholding filings
    python -m pipeline ratios             # rebuild ratios from stored data
    python -m pipeline sheet [PATH]       # write the Google Finance sheet (.xlsx)
"""
import argparse
import sys
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from . import archive, collect, google, prices, ratios, store, universe
from .bhavcopy import combine, fetch_bse, fetch_nse

HISTORY_YEARS = 6  # enough for 5-year returns
BACKFILL_WORKERS = 4  # days downloaded at once; kept low to stay polite


def _with_isin(df, symbol_to_isin):
    return df.assign(isin=df["symbol"].map(symbol_to_isin))


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
    return {"prices": rows, "actions": actions, "pe": pe, "nse": nse, "bse": bse}


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
    latest = None
    with ThreadPoolExecutor(max_workers=workers) as pool:
        # Store every 60 days so memory stays small and progress is saved.
        for i in range(0, len(days), 60):
            chunk = days[i:i + 60]
            batch = {"prices": [], "actions": [], "pe": []}
            for day, got in zip(chunk, pool.map(fetch_day, chunk)):
                if got is None:
                    print(f"{day.date()} holiday / no files")
                    continue
                for key in batch:
                    batch[key].append(got[key])
                latest = (day, got["nse"], got["bse"])
                n_actions = 0 if got["actions"] is None else len(got["actions"])
                print(f"{day.date()} {len(got['prices'])} companies, {n_actions} corporate actions")
            for key, save in (("prices", store.save_prices), ("actions", store.save_actions),
                              ("pe", store.save_nse_pe)):
                frames = [f for f in batch[key] if f is not None and not f.empty]
                if frames:
                    save(pd.concat(frames, ignore_index=True))
    return latest


def rebuild(latest):
    if latest is not None and latest[1] is not None and latest[2] is not None:
        day, nse, bse = latest
        u = store.save_universe(universe.build(day, nse, bse), day)
    else:
        u = pd.read_parquet(store.UNIVERSE)
    since = pd.Timestamp.today().year - HISTORY_YEARS
    p, actions, links = prices.link_isins(store.load_prices(since_year=since), store.load_actions())
    # Old ISINs of split shares now live under their current ISIN.
    u = u[~u["isin"].isin(links)]
    m = store.save_metrics(prices.metrics(p, actions), u)
    prices.adjustments(p, actions).to_csv(store.DATA / "adjustments.csv", index=False)
    print(f"{len(u)} companies, metrics as of {m['as_of'].max().date()}")
    build_ratios(m)


def build_ratios(price_metrics=None):
    if price_metrics is None:
        price_metrics = pd.read_parquet(store.METRICS)
    g = google.fetch()
    if g is not None:
        store.save_google(g.assign(date=price_metrics["as_of"].max()))
    r = ratios.compute(price_metrics, store.load(store.RESULTS), g, store.load(store.SHAREHOLDING))
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
    args = ap.parse_args(argv)

    if args.cmd == "filings":
        collect.collect()
        return
    if args.cmd == "ratios":
        build_ratios()
        return
    if args.cmd == "sheet":
        n = google.make_sheet(pd.read_parquet(store.UNIVERSE), args.path)
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
