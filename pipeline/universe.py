"""Company list: every equity share traded on NSE or BSE, keyed by ISIN."""
import io

import pandas as pd

from .bhavcopy import fetch_bse, fetch_nse, is_equity_share
from .fetch import get

NSE_EQUITY_LIST = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
NSE_INDEX_LIST = "https://nsearchives.nseindia.com/content/indices/ind_{}.csv"
# Index constituent files carry NSE's broad industry for their members.
INDUSTRY_INDICES = ["niftytotalmarket_list", "niftymicrocap250_list", "nifty500list"]

COLUMNS = ["isin", "name", "nse_symbol", "nse_series", "bse_code", "bse_group",
           "listed_on", "industry", "industry_source", "nse_listing_date"]


def nse_equity_list():
    df = pd.read_csv(io.BytesIO(get(NSE_EQUITY_LIST)), dtype=str)
    df.columns = [c.strip() for c in df.columns]
    df = df.rename(columns={"SYMBOL": "nse_symbol", "NAME OF COMPANY": "nse_name",
                            "ISIN NUMBER": "isin", "DATE OF LISTING": "nse_listing_date"})
    df["isin"] = df["isin"].str.strip()
    df["nse_listing_date"] = pd.to_datetime(df["nse_listing_date"], format="%d-%b-%Y", errors="coerce")
    return df[df["isin"].map(is_equity_share)][["isin", "nse_symbol", "nse_name", "nse_listing_date"]]


def nse_industries():
    frames = []
    for name in INDUSTRY_INDICES:
        raw = get(NSE_INDEX_LIST.format(name))
        if raw:
            df = pd.read_csv(io.BytesIO(raw), dtype=str)
            frames.append(df[["ISIN Code", "Industry"]].rename(columns={"ISIN Code": "isin", "Industry": "industry"}))
    if not frames:
        return pd.DataFrame(columns=["isin", "industry"])
    return pd.concat(frames).dropna().drop_duplicates("isin")


def build(day, nse_day=None, bse_day=None):
    """Company list as of `day`, from that day's price files plus NSE's lists.

    Pass already-downloaded price files to avoid fetching them twice.
    """
    nse = nse_day if nse_day is not None else fetch_nse(day)
    bse = bse_day if bse_day is not None else fetch_bse(day)
    if nse is None or bse is None:
        raise RuntimeError(f"No price files for {day}; pick a trading day")

    nse = nse.drop_duplicates("isin")[["isin", "symbol", "series", "name"]].rename(
        columns={"symbol": "nse_symbol", "series": "nse_series", "name": "nse_bhav_name"})
    bse = bse.drop_duplicates("isin")[["isin", "symbol", "series", "name"]].rename(
        columns={"symbol": "bse_code", "series": "bse_group", "name": "bse_name"})
    listed = nse_equity_list()

    u = pd.merge(nse, bse, on="isin", how="outer")
    u = u.merge(listed[["isin", "nse_name", "nse_listing_date"]], on="isin", how="left")
    # NSE's official list has the proper company name; BSE names are abbreviated.
    u["name"] = u["nse_name"].fillna(u["nse_bhav_name"]).fillna(u["bse_name"])
    u["listed_on"] = u.apply(
        lambda r: "+".join(x for x, v in (("NSE", r["nse_symbol"]), ("BSE", r["bse_code"])) if pd.notna(v)), axis=1)

    ind = nse_industries()
    u = u.merge(ind, on="isin", how="left")
    u["industry_source"] = u["industry"].notna().map({True: "NSE index list", False: None})
    return u[COLUMNS].sort_values("name").reset_index(drop=True)
