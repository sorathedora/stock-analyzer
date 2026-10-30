"""NSE's daily archive zip (PR{ddmmyy}.zip).

It holds three files we use:
  Bc*   corporate actions with ex-dates (bonus, split, dividend, ...)
  MCAP* market cap and number of shares for each NSE security (2024 onward)
  PE_*  NSE's own daily PE (early 2024 to mid 2025 only)
"""
import io
import re
import zipfile

import pandas as pd

from .bhavcopy import NSE_EQUITY_SERIES as EQUITY_SERIES
from .fetch import get

URL = "https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{ddmmyy}.zip"

_AMOUNT = r"R[SE]\.?\s*([\d.]+)"


def parse_purpose(purpose):
    """Turn NSE's free-text purpose into (kind, value) pairs.

    kind is 'bonus' or 'split' (value = price factor, e.g. 0.5 for 1:1
    bonus), 'dividend' (value = rupees per share) or 'other' (value None).
    """
    text = " ".join(str(purpose).upper().split())
    found = []
    m = re.search(r"BONUS\s*(\d+)\s*:\s*(\d+)", text)
    if m:
        new, held = int(m.group(1)), int(m.group(2))
        found.append(("bonus", held / (new + held)))
    m = re.search(r"(?:SPLT|SPLIT|SUB-DIVISION|CONSOLIDATION|CONSL).*?" + _AMOUNT + r".*?" + _AMOUNT, text)
    if m:
        old_fv, new_fv = float(m.group(1)), float(m.group(2).rstrip("."))
        if old_fv > 0 and new_fv > 0:
            found.append(("split", new_fv / old_fv))
    for m in re.finditer(r"DIV(?:IDEND)?\s*-?\s*" + _AMOUNT, text):
        found.append(("dividend", float(m.group(1).rstrip("."))))
    return found or [("other", None)]


def _read(z, prefix):
    names = [n for n in z.namelist() if n.lower().startswith(prefix)]
    if not names:
        return None
    try:
        df = pd.read_csv(io.BytesIO(z.read(names[0])), dtype=str, skipinitialspace=True)
    except pd.errors.EmptyDataError:  # NSE sometimes ships an empty file
        return None
    df.columns = [c.strip() for c in df.columns]
    return df.apply(lambda s: s.str.strip())


def fetch(day):
    """Archive contents for a trading day, or None if NSE has no zip for it."""
    day = pd.Timestamp(day)
    raw = get(URL.format(ddmmyy=day.strftime("%d%m%y")))
    if raw is None:
        return None
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        bc, mcap, pe = _read(z, "bc"), _read(z, "mcap"), _read(z, "pe_")
    out = {"actions": None, "shares": None, "pe": None}

    if bc is not None:
        bc = bc[bc["SERIES"].isin(EQUITY_SERIES)]
        out["actions"] = pd.DataFrame({
            "symbol": bc["SYMBOL"],
            "ex_date": pd.to_datetime(bc["EX_DT"], format="%d/%m/%Y", errors="coerce"),
            "purpose": bc["PURPOSE"],
        }).dropna(subset=["ex_date"]).drop_duplicates()

    if mcap is not None:
        mcap = mcap[mcap["Series"].isin(EQUITY_SERIES)]
        out["shares"] = pd.DataFrame({
            "date": day,
            "symbol": mcap["Symbol"],
            "shares": pd.to_numeric(mcap["Issue Size"], errors="coerce"),
        }).dropna().drop_duplicates("symbol")

    if pe is not None:
        out["pe"] = pd.DataFrame({
            "date": day,
            "symbol": pe["SYMBOL"],
            "nse_pe": pd.to_numeric(pe["SYMBOL P/E"], errors="coerce"),
            "nse_adjusted_pe": pd.to_numeric(pe["ADJUSTED P/E"], errors="coerce"),
        }).drop_duplicates("symbol")
    return out


def expand_actions(actions):
    """One row per parsed action: symbol, ex_date, purpose, kind, value."""
    rows = []
    for r in actions.drop_duplicates(["symbol", "ex_date", "purpose"]).itertuples(index=False):
        for kind, value in parse_purpose(r.purpose):
            rows.append((r.symbol, r.ex_date, r.purpose, kind, value))
    return pd.DataFrame(rows, columns=["symbol", "ex_date", "purpose", "kind", "value"])
