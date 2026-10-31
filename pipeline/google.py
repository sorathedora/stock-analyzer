"""Google Finance price, EPS and share count via a published Google Sheet.

`make_sheet` writes an .xlsx with GOOGLEFINANCE formulas for every company.
Once imported into Google Sheets and published to the web as CSV, `fetch`
reads it. Each daily read is kept, which builds a PE history over time.

The price (up to 20 minutes delayed) also feeds the web app's intraday
prices; the share count fills market cap for BSE-only companies, which
NSE's share file doesn't cover. PE is our close divided by Google's EPS.
"""
import io
import os

import pandas as pd

from .fetch import get

ATTRIBUTES = ["price", "eps", "shares"]


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
    col = lambda k: pd.to_numeric(df[k], errors="coerce") if k in df else pd.Series(float("nan"), index=df.index)
    out = pd.DataFrame({
        "isin": df["isin"],
        "google_pe": col("pe"),  # older sheets only
        "google_eps": col("eps"),
        "google_price": col("price"),
        "google_shares": col("shares"),
    })
    return out.dropna(subset=["google_pe", "google_eps", "google_price", "google_shares"], how="all")
