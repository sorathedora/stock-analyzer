"""Write the data the web app reads.

  companies.json       every company and ratio, column-oriented
                       ({"columns": [...], "rows": [[...], ...]}) to stay small
  sparks.json          ~1 year of weekly adjusted closes per company
  company/{isin}.json  daily adjusted prices, results, shareholding and
                       corporate actions for one company's page
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import prices, store

# Companies with no trade for this long are delisted, suspended or merged.
INACTIVE_AFTER_DAYS = 30
EPOCH = pd.Timestamp("1970-01-01")


def _clean(value):
    if value is None or value is pd.NaT:
        return None
    if isinstance(value, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (float, np.floating)):
        v = float(value)
        if np.isnan(v) or np.isinf(v):
            return None
        return round(v, 2) if abs(v) >= 1 else round(v, 4)
    return value


def _dump(path, payload):
    path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))


def companies(ratios, as_of):
    df = ratios.copy()
    df["active"] = df["last_trade_date"] >= as_of - pd.Timedelta(days=INACTIVE_AFTER_DAYS)
    columns = list(df.columns)
    rows = [[_clean(v) for v in row] for row in df.itertuples(index=False, name=None)]
    return {"columns": columns, "rows": rows}


def _days(dates):
    return ((pd.to_datetime(dates) - EPOCH).dt.days).tolist()


def write(out_dir):
    out = Path(out_dir)
    (out / "company").mkdir(parents=True, exist_ok=True)
    ratios = pd.read_parquet(store.RATIOS)
    as_of = pd.read_parquet(store.METRICS, columns=["as_of"])["as_of"].max()

    payload = companies(ratios, as_of)
    payload["as_of"] = _clean(as_of)
    payload["generated"] = pd.Timestamp.now(tz="Asia/Kolkata").strftime("%Y-%m-%d %H:%M")
    _dump(out / "companies.json", payload)

    p, actions, _ = prices.link_isins(store.load_prices(), store.load_actions())
    p = prices.add_adjustment(p, actions)
    p["c"] = p["close"] * p["adj"]

    year = p[p["date"] > as_of - pd.Timedelta(days=365)]
    sparks = {isin: [_clean(v) for v in g["c"].iloc[::5].tolist() + [g["c"].iloc[-1]]]
              for isin, g in year.groupby("isin") if len(g) >= 10}
    _dump(out / "sparks.json", sparks)

    results = store.load(store.RESULTS)
    holdings = store.load(store.SHAREHOLDING)
    keep = set(ratios["isin"])
    for isin, g in p[p["isin"].isin(keep)].groupby("isin"):
        doc = {
            "d": _days(g["date"]),
            "c": [_clean(v) for v in g["c"]],
            "h": [_clean(v) for v in g["high"] * g["adj"]],
            "l": [_clean(v) for v in g["low"] * g["adj"]],
            "v": g["volume"].astype(int).tolist(),
        }
        if actions is not None:
            a = actions[(actions["isin"] == isin) & (actions["kind"] != "other")]
            doc["actions"] = [[_clean(r.ex_date), r.kind, _clean(r.value), r.purpose]
                              for r in a.sort_values("ex_date").itertuples()]
        if results is not None:
            r = results[results["isin"] == isin].drop(columns=["link", "published", "isin"], errors="ignore")
            doc["results"] = [{k: _clean(v) for k, v in row.items() if _clean(v) is not None}
                              for row in r.to_dict("records")]
        if holdings is not None:
            s = holdings[holdings["isin"] == isin].drop(columns=["link", "published", "isin"], errors="ignore")
            doc["shareholding"] = [{k: _clean(v) for k, v in row.items()} for row in s.to_dict("records")]
        _dump(out / "company" / f"{isin}.json", doc)
    print(f"wrote {len(payload['rows'])} companies, {len(sparks)} sparklines, company files to {out}")
