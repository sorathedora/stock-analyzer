from pathlib import Path

import pandas as pd
import pytest

from pipeline.filings import parse_results, parse_shareholding
from pipeline.ratios import compute, ttm

FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return (FIXTURES / name).read_bytes()


def test_integrated_filing_quarter_and_half_year():
    df = parse_results(load("results_integrated_consolidated.xml")).set_index("period")
    assert set(df.index) == {"quarter", "year_to_date"}
    q, y = df.loc["quarter"], df.loc["year_to_date"]
    assert q["symbol"] == "AETHER" and q["basis"] == "consolidated"
    assert q["months"] == 3 and y["months"] == 6
    assert q["revenue"] == pytest.approx(3.47219e9)
    assert q["eps_basic"] == pytest.approx(5.12)
    # Balance sheet and cash flow sit on the year-to-date row only.
    assert pd.isna(q["total_equity"]) and y["total_equity"] == pytest.approx(2.593774e10)
    assert y["cash_from_operations"] == pytest.approx(3.3272e8)


def test_old_format_with_mislabelled_year_to_date():
    # The filer gave the full-year context the quarter's dates.
    df = parse_results(load("results_old_format.xml")).set_index("period")
    assert df.loc["quarter", "months"] == 3
    assert df.loc["year_to_date", "period_start"] == pd.Timestamp("2020-04-01")
    assert df.loc["year_to_date", "months"] == 12
    assert df.loc["year_to_date", "net_profit"] == pytest.approx(-1.488596e9)


def test_half_yearly_non_ind_as_filing():
    df = parse_results(load("results_non_indas.xml"))
    assert len(df) == 1
    h = df.iloc[0]
    assert h["period"] == "year_to_date" and h["months"] == 6
    assert h["net_profit"] == pytest.approx(3695000)
    assert h["total_equity"] == pytest.approx(113000000 + 399043000)


def test_shareholding_categories():
    s = parse_shareholding(load("shareholding.xml"))
    assert s["symbol"] == "ZETWERK"
    assert s["promoter_pct"] == pytest.approx(15.71)
    assert s["fii_pct"] == pytest.approx(7.55)
    assert s["dii_pct"] == pytest.approx(12.53)
    assert s["retail_pct"] == pytest.approx(3.78)
    assert s["mutual_fund_pct"] == pytest.approx(6.02)
    # The filing only says "no shares pledged"; that's 0%, not unknown.
    assert s["promoter_pledged_pct"] == 0.0


def quarters(isin, eps_values, start="2025-06-30", basis="consolidated"):
    ends = pd.date_range(start, periods=len(eps_values), freq="QE")
    return pd.DataFrame({
        "isin": isin, "basis": basis, "period": "quarter", "period_end": ends,
        "period_start": ends - pd.offsets.QuarterBegin(startingMonth=1), "months": 3,
        "eps_basic": eps_values, "eps_diluted": eps_values, "net_profit": [e * 1e7 for e in eps_values],
        "net_profit_owners": [e * 1e7 for e in eps_values], "revenue": 1e9,
    })


def test_ttm_needs_four_consecutive_quarters():
    four = quarters("INE000A01011", [1.0, 2.0, 3.0, 4.0])
    assert ttm(four).set_index("isin").loc["INE000A01011", "ttm_eps"] == pytest.approx(10.0)
    gap = four.drop(index=1)
    assert ttm(gap).empty


def test_pe_prefers_filings_and_flags_google_mismatch():
    metrics = pd.DataFrame({"isin": ["INE000A01011", "INE000B01011"], "name": ["A", "B"],
                            "nse_symbol": ["A", "B"], "bse_code": [None, None], "industry": [None, None],
                            "close": [200.0, 50.0], "market_cap_cr": [1000.0, 500.0], "shares": [1e7, 1e7]})
    results = pd.concat([quarters("INE000A01011", [2.5, 2.5, 2.5, 2.5]),
                         quarters("INE000B01011", [1.0, 1.0, 1.0, 1.0])])
    google = pd.DataFrame({"isin": ["INE000A01011", "INE000B01011"], "google_pe": [None, None],
                           "google_eps": [10.2, -2.0]})
    r = compute(metrics, results, google).set_index("isin")
    assert r.loc["INE000A01011", "pe"] == pytest.approx(20.0)
    assert r.loc["INE000A01011", "pe_source"] == "filings"
    assert r.loc["INE000A01011", "pe_check"] == "verified"
    # Filings show a profit, Google a loss: flagged.
    assert r.loc["INE000B01011", "pe_check"] == "mismatch"


def test_pe_blank_for_loss_makers():
    metrics = pd.DataFrame({"isin": ["INE000A01011"], "name": ["A"], "nse_symbol": ["A"], "bse_code": [None],
                            "industry": [None], "close": [100.0], "market_cap_cr": [100.0], "shares": [1e7]})
    google = pd.DataFrame({"isin": ["INE000A01011"], "google_pe": [None], "google_eps": [-3.0]})
    r = compute(metrics, None, google).iloc[0]
    assert pd.isna(r["pe"])
    assert r["pe_source"] == "google"


def test_industry_pe_and_peg():
    n = 6
    metrics = pd.DataFrame({
        "isin": [f"INE00{i}A01011" for i in range(n)], "name": list("ABCDEF"), "nse_symbol": list("ABCDEF"),
        "bse_code": [None] * n, "industry": ["IT"] * n, "close": [100.0] * n, "market_cap_cr": [1000.0] * n,
        "shares": [1e7] * n, "last_trade_date": [pd.Timestamp("2026-10-29")] * n,
    })
    eps = [10.0, 5.0, 4.0, 2.5, 2.0, 1.0]           # PEs 10, 20, 25, 40, 50, 100
    google = pd.DataFrame({"isin": metrics["isin"], "google_pe": None, "google_eps": eps})
    # EPS a year and a half earlier: company A grew 21% a year (1.21 ** 1.5 ≈ 1.331).
    history = pd.DataFrame({"eps_then": [10.0 / 1.331, 5.0, 5.0, 2.5, 2.0, 1.0],
                            "eps_then_date": pd.Timestamp("2025-04-29")}, index=metrics["isin"])
    industries = pd.DataFrame({"isin": metrics["isin"], "industry": "IT Consulting & Software"})
    r = compute(metrics, None, google, None, history, None, industries).set_index("nse_symbol")
    assert r.loc["A", "industry"] == "IT - Software" and r.loc["A", "sector"] == "Information Technology"
    assert r.loc["A", "industry_pe"] == pytest.approx(32.5)   # median of PEs 10, 20, 25, 40, 50, 100
    assert r.loc["A", "eps_growth_pct"] == pytest.approx(21, abs=0.5)
    assert r.loc["A", "peg"] == pytest.approx(10 / 21, abs=0.02)
    assert pd.isna(r.loc["C", "peg"])                          # EPS fell, so no PEG


def test_annual_report_fills_missing_fundamentals():
    metrics = pd.DataFrame({
        "isin": ["INE000A01011", "INE000B01011"], "name": ["Maker", "Lender"], "nse_symbol": ["MKR", "LND"],
        "bse_code": [None, None], "industry": [None, "Financial Services"], "close": [100.0, 50.0],
        "market_cap_cr": [1000.0, 500.0], "shares": [1e8, 1e8],
    })
    annual = pd.DataFrame({
        "isin": ["INE000A01011", "INE000B01011"], "industry": ["Auto Parts & Accessories", "Non-Banking Financial Company (NBFC)"],
        "fy_end": pd.Timestamp("2026-03-31"),
        "equity_cr": [500.0, 400.0], "equity_prev_cr": [400.0, 400.0], "debt_cr": [100.0, 2000.0], "cash_cr": [50.0, 10.0],
        "revenue_cr": [800.0, 300.0], "operating_profit_cr": [150.0, 250.0], "interest_cr": [10.0, 200.0],
        "pbt_cr": [110.0, 60.0], "net_profit_cr": [90.0, 45.0],
    })
    r = compute(metrics, None, None, None, None, annual).set_index("nse_symbol")
    m = r.loc["MKR"]
    assert m["sub_industry"] == "Auto Parts & Accessories" and m["industry"] == "Auto Components"
    assert m["sector"] == "Automobile and Auto Components"
    assert m["pb"] == pytest.approx(100 / (500e7 / 1e8))           # 2.0
    assert m["debt_to_equity"] == pytest.approx(0.2)
    assert m["roe_pct"] == pytest.approx(90 / 450 * 100)            # average equity
    assert m["roce_pct"] == pytest.approx(120 / 600 * 100)          # (PBT + interest) / (equity + debt)
    assert m["ev_ebitda"] == pytest.approx((1000 + 100 - 50) / 150)
    assert m["fundamentals_source"] == "annual report"
    lender = r.loc["LND"]
    assert pd.isna(lender["roce_pct"]) and pd.isna(lender["ev_ebitda"]) and pd.isna(lender["debt_to_equity"])
    assert lender["roe_pct"] == pytest.approx(45 / 400 * 100)


def test_google_shares_fill_market_cap_for_bse_only():
    metrics = pd.DataFrame({
        "isin": ["INE000A01011", "INE000B01011"], "name": ["Nse", "BseOnly"], "nse_symbol": ["NSEC", None],
        "bse_code": ["500001", "500002"], "industry": [None, None], "close": [100.0, 50.0],
        "market_cap_cr": [1000.0, None], "shares": [1e8, None],
    })
    google = pd.DataFrame({"isin": metrics["isin"], "google_eps": [5.0, 2.0], "google_price": [101.0, 51.0],
                           "google_shares": [2e8, 4e7]})
    r = compute(metrics, None, google).set_index("name")
    assert r.loc["Nse", "market_cap_cr"] == 1000.0           # NSE's own count wins
    assert r.loc["BseOnly", "market_cap_cr"] == pytest.approx(50 * 4e7 / 1e7)
    assert r.loc["BseOnly", "pe"] == pytest.approx(25)
