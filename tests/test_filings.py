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
    r = compute(metrics, None, google, None, history).set_index("nse_symbol")
    assert r.loc["A", "industry_pe"] == pytest.approx(32.5)   # median of PEs 10, 20, 25, 40, 50, 100
    assert r.loc["A", "eps_growth_pct"] == pytest.approx(21, abs=0.5)
    assert r.loc["A", "peg"] == pytest.approx(10 / 21, abs=0.02)
    assert pd.isna(r.loc["C", "peg"])                          # EPS fell, so no PEG
