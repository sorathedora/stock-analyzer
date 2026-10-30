"""Write the data the web app reads.

companies.json is column-oriented ({"columns": [...], "rows": [[...], ...]})
to keep it small: one row per company with every ratio and metric.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import store


def _clean(value):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        v = float(value)
        return round(v, 2) if abs(v) >= 1 else round(v, 4)
    return value


def companies(ratios):
    df = ratios.replace({pd.NaT: None})
    columns = list(df.columns)
    rows = [[_clean(v) for v in row] for row in df.itertuples(index=False, name=None)]
    return {"columns": columns, "rows": rows}


def write(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ratios = pd.read_parquet(store.RATIOS)
    metrics = pd.read_parquet(store.METRICS, columns=["as_of"])
    payload = companies(ratios)
    payload["as_of"] = _clean(metrics["as_of"].max())
    payload["generated"] = pd.Timestamp.now(tz="Asia/Kolkata").strftime("%Y-%m-%d %H:%M")
    (out / "companies.json").write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {len(payload['rows'])} companies to {out / 'companies.json'}")
