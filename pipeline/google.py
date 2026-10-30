"""Google Finance PE and EPS via a published Google Sheet.

`make_sheet` writes an .xlsx with GOOGLEFINANCE formulas for every company.
Once imported into Google Sheets and published to the web as CSV, `fetch`
reads it. Each daily read is kept, which builds a PE history over time.
"""
import io
import os

import pandas as pd

from .fetch import get

ATTRIBUTES = ["pe", "eps"]


def ticker(row):
    if pd.notna(row["nse_symbol"]):
        return f"NSE:{row['nse_symbol']}"
    if pd.notna(row["bse_code"]):
        return f"BOM:{row['bse_code']}"
    return None


def make_sheet(universe, path):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "GF"
    ws.append(["isin", "ticker"] + ATTRIBUTES)
    rows = universe.assign(ticker=universe.apply(ticker, axis=1)).dropna(subset=["ticker"])
    for i, r in enumerate(rows.itertuples(index=False), start=2):
        ws.append([r.isin, r.ticker] + [f'=IFERROR(GOOGLEFINANCE($B{i},"{a}"),"")' for a in ATTRIBUTES])
    wb.save(path)
    return len(rows)


def fetch(url=None):
    """The published sheet as isin, google_pe, google_eps; None if not set up."""
    url = url or os.environ.get("GOOGLE_SHEET_CSV_URL")
    if not url:
        return None
    raw = get(url)
    if not raw:
        return None
    df = pd.read_csv(io.BytesIO(raw))
    out = pd.DataFrame({
        "isin": df["isin"],
        "google_pe": pd.to_numeric(df["pe"], errors="coerce"),
        "google_eps": pd.to_numeric(df["eps"], errors="coerce"),
    })
    return out.dropna(subset=["google_pe", "google_eps"], how="all")
