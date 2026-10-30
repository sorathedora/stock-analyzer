"""Split/bonus adjustment and price-based metrics.

Adjustment factors come from NSE's corporate actions (see archive.py). An
action is applied only when the price actually moved that way on its ex-date,
so a misparsed action cannot distort history. Companies traded only on BSE
have no action data; for them a jump bigger than normal daily price limits
that matches a simple ratio such as 1:2 or 1:5 is treated as a split/bonus.
"""
from fractions import Fraction

import numpy as np
import pandas as pd

RETURN_WINDOWS = {"ret_1w": 7, "ret_1m": 30, "ret_3m": 91, "ret_6m": 182,
                  "ret_1y": 365, "ret_3y": 3 * 365, "ret_5y": 5 * 365}

# BSE-only fallback: jumps at least this big, close to a price factor that
# common bonuses (1:1, 1:2, 2:1, 3:2, 4:1) and face-value splits or
# consolidations (10 to 5/2/1, 5 to 1, 2 to 1, and back) produce.
GUESS_MIN_JUMP = 0.30
GUESS_TOLERANCE = 0.02
_COMMON_FACTORS = [Fraction(1, 2), Fraction(1, 3), Fraction(2, 3), Fraction(2, 5),
                   Fraction(1, 5), Fraction(1, 10)]
_SIMPLE_RATIOS = sorted({float(f) for f in _COMMON_FACTORS} | {float(1 / f) for f in _COMMON_FACTORS})


def isin_changes(prices):
    """Old ISIN -> current ISIN for shares whose ISIN changed.

    A face-value split or consolidation issues a new ISIN while the NSE symbol
    or BSE scrip code stays the same, so a symbol moving to a new ISIN links
    the two histories.
    """
    s = prices[["exchange", "symbol", "isin", "date"]].sort_values("date")
    s = s.drop_duplicates(["exchange", "symbol", "isin"], keep="last")
    links = {}
    for _, g in s.groupby(["exchange", "symbol"]):
        isins = g["isin"].tolist()
        for old, new in zip(isins, isins[1:]):
            links.setdefault(old, new)
    resolved = {}
    for old in links:
        new, seen = links[old], {old}
        while new in links and new not in seen:
            seen.add(new)
            new = links[new]
        resolved[old] = new
    return resolved


def link_isins(prices, actions=None):
    """Rewrite old ISINs to current ones in prices (and actions)."""
    links = isin_changes(prices)
    prices = prices.assign(isin=prices["isin"].replace(links))
    if actions is not None:
        actions = actions.assign(isin=actions["isin"].replace(links))
    return prices, actions, links


def _nearest_simple_ratio(x):
    r = min(_SIMPLE_RATIOS, key=lambda s: abs(np.log(x / s)))
    return r if abs(np.log(x / r)) < GUESS_TOLERANCE else None


def _place_actions(p, actions):
    """Map each split/bonus to the first trading row on or after its ex-date."""
    a = actions[actions["kind"].isin(["bonus", "split"]) & actions["isin"].notna()]
    if a.empty:
        return pd.DataFrame(columns=["isin", "date", "action_factor", "purpose"])
    a = (a.groupby(["isin", "ex_date"])
         .agg(action_factor=("value", "prod"), purpose=("purpose", " / ".join))
         .reset_index().sort_values("ex_date"))
    rows = p[["isin", "date"]].sort_values("date")
    placed = pd.merge_asof(a, rows, left_on="ex_date", right_on="date", by="isin", direction="forward")
    return (placed.dropna(subset=["date"])
            .groupby(["isin", "date"])
            .agg(action_factor=("action_factor", "prod"), purpose=("purpose", " / ".join))
            .reset_index())


def add_adjustment(prices, actions=None):
    """Add `factor` (on ex-dates), `adj` (multiplier for the row's prices)
    and `adj_source` ('exchange', 'guessed' or 'unconfirmed')."""
    p = prices.sort_values(["isin", "date"]).reset_index(drop=True)
    same = p["isin"].eq(p["isin"].shift()) & p["exchange"].eq(p["exchange"].shift())
    jump = (p["close"] / p["close"].shift()).where(same)

    if actions is not None and not actions.empty:
        p = p.merge(_place_actions(p, actions), on=["isin", "date"], how="left")
    else:
        p["action_factor"], p["purpose"] = np.nan, None

    has_action = p["action_factor"].notna()
    # Confirmed when the price jump is closer to the action's factor than to no change.
    confirmed = has_action & jump.notna() & (np.log(jump / p["action_factor"]).abs() < np.log(jump).abs())
    guessed = pd.Series(
        [_nearest_simple_ratio(j) if (e == "BSE" and pd.notna(j) and abs(np.log(j)) > -np.log(1 - GUESS_MIN_JUMP))
         else None for j, e in zip(jump, p["exchange"])], index=p.index, dtype="float64")
    guessed[has_action] = np.nan

    p["factor"] = np.where(confirmed, p["action_factor"], np.where(guessed.notna(), guessed, 1.0))
    p["adj_source"] = np.select([confirmed, guessed.notna(), has_action], ["exchange", "guessed", "unconfirmed"], None)
    p["jump"] = jump
    # A row's multiplier is the product of all factors strictly after it.
    later = p.groupby("isin")["factor"].transform(lambda f: f[::-1].cumprod()[::-1])
    p["adj"] = later / p["factor"]
    return p.drop(columns=["action_factor"])


def adjustments(prices, actions=None):
    """Every applied or rejected split/bonus, for review."""
    p = add_adjustment(prices, actions)
    return p.loc[p["adj_source"].notna(),
                 ["isin", "date", "exchange", "symbol", "purpose", "factor", "jump", "adj_source"]]


def dividends_ttm(p, actions, as_of):
    """Dividends per share over the last year, adjusted to today's share basis."""
    d = actions[(actions["kind"] == "dividend") & actions["isin"].notna()]
    d = d[(d["ex_date"] > as_of - pd.Timedelta(days=365)) & (d["ex_date"] <= as_of)]
    if d.empty:
        return pd.Series(dtype="float64")
    d = d.drop_duplicates(["isin", "ex_date", "value"]).sort_values("ex_date")
    rows = p[["isin", "date", "adj"]].sort_values("date")
    d = pd.merge_asof(d, rows, left_on="ex_date", right_on="date", by="isin", direction="forward")
    return (d["value"] * d["adj"].fillna(1.0)).groupby(d["isin"]).sum()


def metrics(prices, actions=None, as_of=None):
    """Latest price and price-based metrics for every ISIN."""
    p = add_adjustment(prices, actions)
    if as_of is not None:
        p = p[p["date"] <= pd.Timestamp(as_of)]
    as_of = p["date"].max()
    for c in ["close", "high", "low"]:
        p["adj_" + c] = p[c] * p["adj"]

    g = p.groupby("isin")
    last = g.tail(1).set_index("isin")
    out = pd.DataFrame({
        "exchange": last["exchange"],
        "symbol": last["symbol"],
        "last_trade_date": last["date"],
        "close": last["close"],
        "change_pct": (last["close"] / last["prev_close"] - 1) * 100,
    })
    if "shares" in p:
        shares = p.dropna(subset=["shares"]).groupby("isin")["shares"].last()
        out["shares"] = shares
        out["market_cap_cr"] = out["close"] * shares / 1e7

    year = p[p["date"] > as_of - pd.Timedelta(days=365)].groupby("isin")
    out["high_52w"] = year["adj_high"].max()
    out["low_52w"] = year["adj_low"].min()
    out["pct_from_52w_high"] = (out["close"] / out["high_52w"] - 1) * 100
    out["pct_from_52w_low"] = (out["close"] / out["low_52w"] - 1) * 100

    wide = p.pivot_table(index="date", columns="isin", values="adj_close").sort_index().ffill()
    latest = wide.iloc[-1]
    first_seen = g["date"].min()
    for col, days in RETURN_WINDOWS.items():
        start = as_of - pd.Timedelta(days=days)
        before = wide.index[wide.index <= start]
        if len(before) == 0:
            out[col] = np.nan
            continue
        ret = (latest / wide.loc[before[-1]] - 1) * 100
        # No return for companies that started trading after the window start.
        ret[first_seen.reindex(ret.index) > start] = np.nan
        out[col] = ret

    out["dma_50"] = g["adj_close"].apply(lambda s: s.tail(50).mean() if len(s) >= 50 else np.nan)
    out["dma_200"] = g["adj_close"].apply(lambda s: s.tail(200).mean() if len(s) >= 200 else np.nan)
    out["above_dma_50"] = out["close"] > out["dma_50"]
    out["above_dma_200"] = out["close"] > out["dma_200"]
    out["avg_volume_20d"] = g["volume"].apply(lambda s: s.tail(20).mean())
    out["avg_value_20d_cr"] = g["value"].apply(lambda s: s.tail(20).mean()) / 1e7

    if actions is not None and not actions.empty:
        div = dividends_ttm(p, actions, as_of)
        out["dividend_ttm"] = div.reindex(out.index).fillna(0.0)
        out["dividend_yield_pct"] = out["dividend_ttm"] / out["close"] * 100
    out["as_of"] = as_of
    return out.reset_index()
