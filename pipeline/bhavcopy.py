"""Daily end-of-day price files (bhavcopy) from NSE and BSE.

Both exchanges switched to a common file format on 8 July 2024. Each fetch
tries the new format first and falls back to the old one, then returns rows
in one shared shape (COLUMNS).
"""
import io

import pandas as pd

from .fetch import get, unzip_single

COLUMNS = ["date", "exchange", "isin", "symbol", "name", "series",
           "open", "high", "low", "close", "prev_close", "volume", "value", "trades"]

NSE_NEW = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{ymd}_F_0000.csv.zip"
NSE_OLD = "https://nsearchives.nseindia.com/content/historical/EQUITIES/{yyyy}/{mon}/cm{dd}{mon}{yyyy}bhav.csv.zip"
BSE_NEW = "https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{ymd}_F_0000.CSV"
BSE_OLD = "https://www.bseindia.com/download/BhavCopy/Equity/EQ_ISINCODE_{ddmmyy}.zip"

NEW_FORMAT_START = pd.Timestamp("2024-07-08")
NSE_EQUITY_SERIES = {"EQ", "BE", "BZ", "SM", "ST", "SZ"}


def is_equity_share(isin):
    """Ordinary shares of Indian companies: INE prefix and security type 01.

    This drops ETFs and mutual funds (INF), bonds and debentures, government
    securities and partly paid shares.
    """
    return isinstance(isin, str) and len(isin) == 12 and isin.startswith("INE") and isin[7:9] == "01"


def _parse_new(raw, exchange):
    df = pd.read_csv(io.BytesIO(raw), dtype=str)
    df = df[df["FinInstrmTp"] == "STK"]
    out = pd.DataFrame({
        "date": pd.to_datetime(df["TradDt"]),
        "exchange": exchange,
        "isin": df["ISIN"].str.strip(),
        "symbol": df["TckrSymb"].str.strip() if exchange == "NSE" else df["FinInstrmId"].str.strip(),
        "name": df["FinInstrmNm"].str.strip(),
        "series": df["SctySrs"].str.strip(),
        "open": df["OpnPric"], "high": df["HghPric"], "low": df["LwPric"],
        "close": df["ClsPric"], "prev_close": df["PrvsClsgPric"],
        "volume": df["TtlTradgVol"], "value": df["TtlTrfVal"], "trades": df["TtlNbOfTxsExctd"],
    })
    return _finish(out)


def _parse_nse_old(raw):
    df = pd.read_csv(io.BytesIO(raw), dtype=str)
    out = pd.DataFrame({
        "date": pd.to_datetime(df["TIMESTAMP"], format="%d-%b-%Y"),
        "exchange": "NSE",
        "isin": df["ISIN"].str.strip(),
        "symbol": df["SYMBOL"].str.strip(),
        "name": None,
        "series": df["SERIES"].str.strip(),
        "open": df["OPEN"], "high": df["HIGH"], "low": df["LOW"],
        "close": df["CLOSE"], "prev_close": df["PREVCLOSE"],
        "volume": df["TOTTRDQTY"], "value": df["TOTTRDVAL"], "trades": df["TOTALTRADES"],
    })
    return _finish(out)


def _parse_bse_old(raw):
    df = pd.read_csv(io.BytesIO(raw), dtype=str)
    df.columns = [c.strip() for c in df.columns]
    out = pd.DataFrame({
        "date": pd.to_datetime(df["TRADING_DATE"], format="%d-%b-%y"),
        "exchange": "BSE",
        "isin": df["ISIN_CODE"].str.strip(),
        "symbol": df["SC_CODE"].str.strip(),
        "name": df["SC_NAME"].str.strip(),
        "series": df["SC_GROUP"].str.strip(),
        "open": df["OPEN"], "high": df["HIGH"], "low": df["LOW"],
        "close": df["CLOSE"], "prev_close": df["PREVCLOSE"],
        "volume": df["NO_OF_SHRS"], "value": df["NET_TURNOV"], "trades": df["NO_TRADES"],
    })
    return _finish(out)


def _finish(out):
    out = out[out["isin"].map(is_equity_share)].copy()
    if (out["exchange"] == "NSE").any():
        # Drop block-deal (BL) and other special windows; keep normal trading.
        out = out[out["series"].isin(NSE_EQUITY_SERIES)]
    for c in ["open", "high", "low", "close", "prev_close", "value"]:
        out[c] = pd.to_numeric(out[c], errors="coerce")
    for c in ["volume", "trades"]:
        out[c] = pd.to_numeric(out[c], errors="coerce").fillna(0).astype("int64")
    out = out.dropna(subset=["close"])
    return out[COLUMNS].reset_index(drop=True)


def fetch_nse(day):
    day = pd.Timestamp(day)
    if day >= NEW_FORMAT_START:
        raw = get(NSE_NEW.format(ymd=day.strftime("%Y%m%d")))
        if raw:
            return _parse_new(unzip_single(raw), "NSE")
    mon = day.strftime("%b").upper()
    raw = get(NSE_OLD.format(yyyy=day.year, mon=mon, dd=day.strftime("%d")))
    return _parse_nse_old(unzip_single(raw)) if raw else None


def fetch_bse(day):
    day = pd.Timestamp(day)
    if day >= NEW_FORMAT_START:
        raw = get(BSE_NEW.format(ymd=day.strftime("%Y%m%d")))
        if raw:
            return _parse_new(raw, "BSE")
    raw = get(BSE_OLD.format(ddmmyy=day.strftime("%d%m%y")))
    return _parse_bse_old(unzip_single(raw)) if raw else None


def combine(nse, bse):
    """One price row per ISIN: a company listed on both exchanges keeps its
    NSE row. Returns None when neither file exists (a market holiday)."""
    frames = [x.drop_duplicates("isin") for x in (nse, bse) if x is not None]
    if not frames:
        return None
    if len(frames) == 2:
        frames[1] = frames[1][~frames[1]["isin"].isin(frames[0]["isin"])]
    return pd.concat(frames, ignore_index=True)
