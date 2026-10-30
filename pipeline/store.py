"""Local data files. The GitHub workflows sync this folder with a release."""
from pathlib import Path

import pandas as pd

DATA = Path("data")
UNIVERSE = DATA / "universe.parquet"
METRICS = DATA / "price_metrics.parquet"
ACTIONS = DATA / "corporate_actions.parquet"
NSE_PE = DATA / "nse_pe.parquet"
FILINGS_INDEX = DATA / "filings_index.parquet"
RESULTS = DATA / "results.parquet"
SHAREHOLDING = DATA / "shareholding.parquet"

PRICE_COLUMNS = ["date", "exchange", "isin", "symbol", "series", "open", "high", "low",
                 "close", "prev_close", "volume", "value", "trades", "shares"]


def price_file(year):
    return DATA / f"prices_{year}.parquet"


def load_prices(since_year=None):
    files = sorted(DATA.glob("prices_*.parquet"))
    if since_year:
        files = [f for f in files if int(f.stem.split("_")[1]) >= since_year]
    if not files:
        return None
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)


def save_prices(new):
    """Merge new daily rows into the per-year files (re-runs replace a day)."""
    DATA.mkdir(exist_ok=True)
    new = new.reindex(columns=PRICE_COLUMNS)
    for year, rows in new.groupby(new["date"].dt.year):
        f = price_file(year)
        if f.exists():
            old = pd.read_parquet(f)
            rows = pd.concat([old[~old["date"].isin(rows["date"].unique())], rows], ignore_index=True)
        rows.sort_values(["date", "isin"]).to_parquet(f, index=False)


def last_price_date():
    files = sorted(DATA.glob("prices_*.parquet"))
    if not files:
        return None
    return pd.read_parquet(files[-1], columns=["date"])["date"].max()


def _append(path, new, keys):
    """Add rows to a table, replacing any with the same keys."""
    DATA.mkdir(exist_ok=True)
    if path.exists():
        new = pd.concat([pd.read_parquet(path), new], ignore_index=True)
    new = new.drop_duplicates(keys, keep="last")
    new.to_parquet(path, index=False)
    return new


def save_actions(new):
    return _append(ACTIONS, new, ["symbol", "ex_date", "purpose", "kind", "value"])


def load_actions():
    return pd.read_parquet(ACTIONS) if ACTIONS.exists() else None


def save_nse_pe(new):
    return _append(NSE_PE, new, ["date", "symbol"])


def save_filings_index(new):
    return _append(FILINGS_INDEX, new, ["link"])


def save_results(new):
    # A revised filing for the same company, basis and period replaces the old one.
    return _append(RESULTS, new.sort_values("published"),
                   ["isin", "basis", "period", "period_start", "period_end"])


def save_shareholding(new):
    return _append(SHAREHOLDING, new.sort_values("published"), ["isin", "as_of"])


GOOGLE = DATA / "google_history.parquet"
RATIOS = DATA / "ratios.parquet"


def load(path):
    return pd.read_parquet(path) if path.exists() else None


def save_google(new):
    return _append(GOOGLE, new, ["isin", "date"])


def save_ratios(r):
    DATA.mkdir(exist_ok=True)
    r.to_parquet(RATIOS, index=False)
    numeric = r.select_dtypes("number").columns
    r.assign(**r[numeric].round(2)).to_csv(DATA / "ratios.csv", index=False)


def save_universe(today, day):
    """Keep companies that did not trade today; refresh the ones that did."""
    today = today.assign(last_seen=pd.Timestamp(day))
    if UNIVERSE.exists():
        old = pd.read_parquet(UNIVERSE)
        today = pd.concat([today, old[~old["isin"].isin(today["isin"])]], ignore_index=True)
    today.sort_values("name").to_parquet(UNIVERSE, index=False)
    return today


def save_metrics(metrics, universe):
    m = universe[["isin", "name", "nse_symbol", "bse_code", "industry"]].merge(metrics, on="isin", how="right")
    m.to_parquet(METRICS, index=False)
    numeric = m.select_dtypes("number").columns
    m.assign(**m[numeric].round(2)).to_csv(DATA / "price_metrics.csv", index=False)
    return m
