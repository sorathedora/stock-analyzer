"""Fundamental ratios for every company.

PE uses the best available earnings, in this order:
  1. last four quarters from the company's own filings (TTM)
  2. the latest full financial year from its filings
  3. Google Finance's EPS
and is cross-checked against Google Finance whenever both exist. Consolidated
figures are preferred over standalone, as on Screener.
"""
import numpy as np
import pandas as pd

from . import filings

# A PE more than this far from Google Finance's is flagged for review.
PE_MISMATCH_PCT = 10
EXTREME_PE = 200


def _pick_basis(results):
    """Consolidated rows where a company files them, else standalone."""
    consolidated = results["basis"] == "consolidated"
    files_consolidated = results["isin"].isin(results.loc[consolidated, "isin"])
    return results[consolidated | ~files_consolidated]


def _owners_profit(df):
    return df["net_profit_owners"].where(df["net_profit_owners"].fillna(0) != 0, df["net_profit"])


def _ebit(df):
    return df["profit_before_tax"] + df["finance_cost"].fillna(0)


def _ebitda(df):
    return _ebit(df) + df["depreciation"].fillna(0) - df["other_income"].fillna(0)


def eps_then(nse_pe, adjusted_prices):
    """EPS on the last day NSE published PE (March 2025), per today's share.

    NSE's PE file gives price ÷ EPS on that day; dividing that day's
    split-adjusted close by it gives EPS on today's share basis.
    """
    if nse_pe is None or nse_pe.empty:
        return pd.DataFrame(columns=["eps_then", "eps_then_date"])
    day = nse_pe["date"].max()
    pe = nse_pe[(nse_pe["date"] == day) & (nse_pe["nse_pe"] > 0)].dropna(subset=["isin"]).drop_duplicates("isin")
    px = adjusted_prices[adjusted_prices["date"] == day].drop_duplicates("isin").set_index("isin")
    out = pe.set_index("isin")[["nse_pe"]].join(px[["close", "adj"]], how="inner")
    return pd.DataFrame({"eps_then": out["close"] * out["adj"] / out["nse_pe"], "eps_then_date": day})


def ttm(results):
    """Trailing-twelve-month profit and EPS from four consecutive quarters."""
    q = _pick_basis(results[results["period"] == "quarter"]).copy()
    q = q.reindex(columns=q.columns.union(["profit_before_tax", "finance_cost", "depreciation", "other_income"]))
    q["profit"] = _owners_profit(q)
    q["ebit"], q["ebitda"] = _ebit(q), _ebitda(q)
    q = q.sort_values("period_end").drop_duplicates(["isin", "period_end"], keep="last")
    rows = []
    for isin, g in q.groupby("isin"):
        last4 = g.tail(4)
        ends = last4["period_end"].tolist()
        consecutive = len(ends) == 4 and all(
            80 <= (b - a).days <= 100 for a, b in zip(ends, ends[1:]))
        if consecutive:
            rows.append({"isin": isin, "ttm_end": ends[-1], "ttm_profit": last4["profit"].sum(),
                         "ttm_eps": last4["eps_diluted"].fillna(last4["eps_basic"]).sum(),
                         "ttm_revenue": last4["revenue"].sum(),
                         "ttm_ebit": last4["ebit"].sum(), "ttm_ebitda": last4["ebitda"].sum()})
    return pd.DataFrame(rows, columns=["isin", "ttm_end", "ttm_profit", "ttm_eps", "ttm_revenue", "ttm_ebit", "ttm_ebitda"])


def latest_rows(results):
    """Per company: its latest quarter, year-to-date row and full year."""
    r = _pick_basis(results).sort_values("period_end")
    quarter = r[r["period"] == "quarter"].groupby("isin").tail(1).set_index("isin")
    ytd = r[r["period"] == "year_to_date"].groupby("isin").tail(1).set_index("isin")
    year = r[(r["period"] == "year_to_date") & (r["months"] == 12)].groupby("isin").tail(1).set_index("isin")
    return quarter, ytd, year


# Filled from the latest annual report wherever no newer NSE filing is on file.
ANNUAL_METRICS = ["book_value_cr", "debt_cr", "cash_cr", "debt_to_equity", "roe_pct", "roce_pct", "pb", "ev_cr", "ev_ebitda"]


def _fill_from_annual(out, annual, shares):
    """Use Rediff's annual-report figures (standalone, ₹ crore) for companies
    without results filings yet. Also takes Rediff's industry, which is finer
    than NSE's broad sectors; NSE's label is kept as `sector`."""
    a = (annual.dropna(subset=["isin"]).sort_values("fy_end")
         .drop_duplicates("isin", keep="last").set_index("isin").reindex(out.index))
    out["sector"] = out["industry"]
    out["industry"] = a["industry"].fillna(out["industry"])

    eq, debt, cash = a["equity_cr"], a["debt_cr"], a["cash_cr"]
    eq_avg = ((eq + a["equity_prev_cr"]) / 2).fillna(eq)
    capital = eq + debt.fillna(0)
    ebit = a["pbt_cr"] + a["interest_cr"].fillna(0)
    ebitda = a["operating_profit_cr"]
    ev = out["market_cap_cr"] + debt.fillna(0) - cash.fillna(0)
    d = pd.DataFrame({
        "book_value_cr": eq, "debt_cr": debt, "cash_cr": cash,
        "debt_to_equity": (debt / eq).where(eq > 0),
        "roe_pct": (a["net_profit_cr"] / eq_avg * 100).where(eq_avg > 0),
        "roce_pct": (ebit / capital * 100).where(capital > 0),
        "pb": (out["close"] / (eq * 1e7 / shares)).where(eq > 0) if shares is not None else np.nan,
        "ev_cr": ev, "ev_ebitda": (ev / ebitda).where(ebitda > 0),
    }, index=out.index)
    # Lenders: interest is the main cost, so ROCE, EV/EBITDA and D/E mislead.
    lender = (a["interest_cr"] > 0.4 * a["revenue_cr"]) | (out["sector"] == "Financial Services")
    d.loc[lender.fillna(False).astype(bool), ["roce_pct", "ev_ebitda", "debt_to_equity"]] = np.nan

    filled = pd.Series(False, index=out.index)
    for k in ANNUAL_METRICS:
        cur = out[k] if k in out else pd.Series(np.nan, index=out.index, dtype="float64")
        take = cur.isna() & d[k].notna()
        filled |= take
        out[k] = cur.where(~take, d[k])
    from_filings = out["balance_sheet_date"].notna() if "balance_sheet_date" in out else pd.Series(False, index=out.index)
    out["fundamentals_source"] = np.select([from_filings, filled], ["NSE filing", "annual report"], None)
    out["annual_report_fy"] = a["fy_end"]


def compute(price_metrics, results=None, google=None, shareholding=None, eps_history=None, annual=None):
    m = price_metrics.set_index("isin")
    out = m[["name", "nse_symbol", "bse_code", "industry", "close", "market_cap_cr"]].copy()
    shares = m.get("shares")

    if results is not None and not results.empty:
        # Filings only carry the items a company reports; add the rest as blanks.
        fields = set(filings.PERIOD_ITEMS.values()) | set(filings.BALANCE_ITEMS.values())
        results = results.reindex(columns=results.columns.union(sorted(fields)))
        quarter, ytd, year = latest_rows(results)
        t = ttm(results).set_index("isin")

        out["eps_ttm"] = t["ttm_eps"]
        out["eps_last_fy"] = year["eps_diluted"].fillna(year["eps_basic"])
        out["last_fy_end"] = year["period_end"]
        out["pe_filings"] = np.where(out["eps_ttm"].notna(), out["close"] / out["eps_ttm"],
                                     out["close"] / out["eps_last_fy"])
        out["pe_filings_basis"] = np.where(out["eps_ttm"].notna(), "TTM",
                                           np.where(out["eps_last_fy"].notna(), "last FY", None))

        q = quarter
        out["latest_quarter"] = q["period_end"]
        out["revenue_q_cr"] = q["revenue"] / 1e7
        out["net_profit_q_cr"] = _owners_profit(q) / 1e7
        out["ebitda_margin_q_pct"] = _ebitda(q) / q["revenue"] * 100
        # Interest is a lender's main cost, so EBITDA says nothing for banks and NBFCs.
        is_bank = q["is_bank"] if "is_bank" in q else pd.Series(False, index=q.index)
        lender = (out["industry"] == "Financial Services") | is_bank.reindex(out.index).fillna(False).astype(bool)
        out.loc[lender, "ebitda_margin_q_pct"] = np.nan
        out["net_margin_q_pct"] = q["net_profit"] / q["revenue"] * 100

        b = ytd  # balance sheet sits on the latest year-to-date row
        equity = b["equity_owners"].fillna(b["total_equity"])
        debt = b["borrowings"].fillna(b["borrowings_noncurrent"].fillna(0) + b["borrowings_current"].fillna(0))
        cash = b["cash"].fillna(0) + b["other_bank_balances"].fillna(0) + b["current_investments"].fillna(0)
        out["balance_sheet_date"] = b["period_end"]
        out["book_value_cr"] = equity / 1e7
        out["debt_cr"] = debt / 1e7
        out["cash_cr"] = cash / 1e7
        out["debt_to_equity"] = debt / equity
        out["current_ratio"] = b["current_assets"] / b["current_liabilities"]
        if shares is not None:
            out["book_value_per_share"] = equity / shares
            out["pb"] = out["close"] / out["book_value_per_share"]
        out["ev_cr"] = out["market_cap_cr"] + out["debt_cr"] - out["cash_cr"]

        # Annualised from the year to date until four quarters are on file.
        months = b["months"].replace(0, np.nan)
        annual_profit = t["ttm_profit"].reindex(out.index).fillna(_owners_profit(b) * 12 / months)
        out["roe_pct"] = annual_profit / equity * 100
        out["roe_basis"] = np.where(t["ttm_profit"].reindex(out.index).notna(), "TTM",
                                    np.where(annual_profit.notna(), "annualised YTD", None))
        # ROCE and EV/EBITDA need a year of operating profit: last four
        # quarters when on file, else the year to date annualised.
        annual_ebit = t["ttm_ebit"].reindex(out.index).fillna(_ebit(b) * 12 / months)
        annual_ebitda = t["ttm_ebitda"].reindex(out.index).fillna(_ebitda(b) * 12 / months)
        capital_employed = equity + debt
        out["roce_pct"] = (annual_ebit / capital_employed * 100).where(capital_employed > 0)
        out["ev_ebitda"] = (out["ev_cr"] * 1e7 / annual_ebitda).where(annual_ebitda > 0)
        out.loc[lender, ["roce_pct", "ev_ebitda"]] = np.nan
        out["cash_from_operations_ytd_cr"] = b["cash_from_operations"] / 1e7
        out["free_cash_flow_ytd_cr"] = (b["cash_from_operations"] - b["capex"].fillna(0)) / 1e7

    if annual is not None and not annual.empty:
        _fill_from_annual(out, annual, shares)

    if google is not None and not google.empty:
        g = google.drop_duplicates("isin").set_index("isin")
        out["eps_google"] = g["google_eps"]
        # Same closing price as our own PE, so the two differ only by EPS.
        out["pe_google"] = out["close"] / out["eps_google"]

    # Final PE: own filings first, Google as fallback, with a cross-check.
    pe_f = out.get("pe_filings", pd.Series(np.nan, index=out.index))
    pe_g = out.get("pe_google", pd.Series(np.nan, index=out.index))
    eps_f = out.get("eps_ttm", pd.Series(np.nan, index=out.index)).fillna(
        out.get("eps_last_fy", pd.Series(np.nan, index=out.index)))
    eps_g = out.get("eps_google", pd.Series(np.nan, index=out.index))
    out["pe"] = pe_f.where(pe_f.notna(), pe_g)
    out["eps"] = eps_f.where(eps_f.notna(), eps_g)
    out["eps_source"] = np.select([eps_f.notna(), eps_g.notna()], ["filings", "google"], None)
    out["pe_source"] = np.select([pe_f.notna(), pe_g.notna()], ["filings", "google"], None)
    diff = (pe_f / pe_g - 1).abs() * 100
    loss_mismatch = (eps_f < 0) != (eps_g < 0)
    out["pe_check"] = np.select(
        [pe_f.notna() & pe_g.notna() & (diff <= PE_MISMATCH_PCT),
         pe_f.notna() & eps_g.notna() & ((diff > PE_MISMATCH_PCT) | loss_mismatch),
         pe_f.notna() | pe_g.notna()],
        ["verified", "mismatch", "single source"], None)
    # A loss makes PE meaningless; show it blank rather than negative.
    eps_used = eps_f.where(pe_f.notna(), eps_g)
    out.loc[eps_used <= 0, "pe"] = np.nan
    out["pe"] = pd.to_numeric(out["pe"])
    # Near-zero earnings give PEs in the hundreds or thousands; say so.
    out["pe_note"] = np.where(out["pe"] > EXTREME_PE, "earnings near zero", None)
    out["earnings_yield_pct"] = 100 / out["pe"]

    # Industry PE: median PE of the industry's actively traded companies
    # (5 or more with a PE), so one company's PE can be judged against peers.
    last = m["last_trade_date"] if "last_trade_date" in m else pd.Series(pd.NaT, index=m.index)
    active = (last >= last.max() - pd.Timedelta(days=30)) if last.notna().any() else pd.Series(True, index=m.index)
    has_pe = out[active.reindex(out.index).fillna(False) & out["pe"].notna() & out["industry"].notna()]
    medians = has_pe.groupby("industry")["pe"].agg(["median", "count"])
    medians = medians.loc[medians["count"] >= 5, "median"]
    out["industry_pe"] = out["industry"].map(medians)

    # PEG = PE ÷ yearly EPS growth (%). Growth compares today's EPS with EPS
    # implied by NSE's published PE in March 2025, until a year of the
    # company's own quarterly results is on file.
    if eps_history is not None and not eps_history.empty:
        h = eps_history.reindex(out.index)
        years = (last.reindex(out.index) - h["eps_then_date"]).dt.days / 365.25
        ok = (h["eps_then"] > 0) & (out["eps"] > 0) & (years >= 0.5)
        growth = ((out["eps"] / h["eps_then"]) ** (1 / years) - 1) * 100
        out["eps_growth_pct"] = growth.where(ok)
        out["peg"] = (out["pe"] / out["eps_growth_pct"]).where(out["eps_growth_pct"] > 0)

    if shareholding is not None and not shareholding.empty:
        s = shareholding.sort_values("as_of")
        latest = s.groupby("isin").tail(1).set_index("isin")
        previous = s.groupby("isin").nth(-2).set_index("isin") if len(s) > 1 else latest.iloc[0:0]
        for c in ["promoter_pct", "fii_pct", "dii_pct", "mutual_fund_pct", "retail_pct", "public_pct", "promoter_pledged_pct"]:
            if c in latest:
                out[c] = latest[c]
                if c in previous:
                    out[c + "_change"] = latest[c] - previous[c].reindex(latest.index)
        out["shareholding_as_of"] = latest["as_of"]

    keep = m.columns.difference(out.columns).difference(["exchange", "symbol", "as_of"])
    return out.join(m[keep]).reset_index()
