import pandas as pd
import pytest

from pipeline.archive import parse_purpose
from pipeline.bhavcopy import combine, is_equity_share
from pipeline.prices import add_adjustment, link_isins, metrics

ISIN = "INE000A01011"


def rows(closes, start="2025-01-01", exchange="NSE", isin=ISIN):
    return pd.DataFrame({
        "date": pd.bdate_range(start, periods=len(closes)), "exchange": exchange,
        "isin": isin, "symbol": "ABC", "close": closes, "high": closes, "low": closes,
        "prev_close": [None] + closes[:-1], "volume": 100, "value": 1e6,
    })


def action(ex_date, purpose, isin=ISIN):
    return pd.DataFrame([(isin, "ABC", pd.Timestamp(ex_date), purpose, kind, value)
                         for kind, value in parse_purpose(purpose)],
                        columns=["isin", "symbol", "ex_date", "purpose", "kind", "value"])


def test_equity_share_filter():
    assert is_equity_share("INE002A01018")       # Reliance shares
    assert not is_equity_share("INF204KB14I2")   # ETF
    assert not is_equity_share("INE002A07018")   # debenture
    assert not is_equity_share("IN9002A01018")   # partly paid
    assert not is_equity_share(None)


def test_combine_prefers_nse_row():
    nse = rows([100.0])
    bse = pd.concat([rows([101.0], exchange="BSE"), rows([50.0], exchange="BSE", isin="INE000B01011")])
    out = combine(nse, bse)
    assert sorted(out["isin"]) == [ISIN, "INE000B01011"]
    assert out.set_index("isin").loc[ISIN, "exchange"] == "NSE"
    assert combine(None, None) is None


@pytest.mark.parametrize("purpose,expected", [
    ("BONUS 1:1", [("bonus", 0.5)]),
    ("BONUS 3:2", [("bonus", 0.4)]),
    ("FV SPLT FRM RS 5 TO RE 1", [("split", 0.2)]),
    ("FACE VALUE SPLIT (SUB-DIVISION) - FROM RS 10/- PER SHARE TO RE 1/- PER SHARE", [("split", 0.1)]),
    ("CONSOLIDATION FROM RE 1 TO RS 10", [("split", 10.0)]),
    ("AGM/DIV-RS 2.50 PER SH", [("dividend", 2.5)]),
    ("FINAL DIVIDEND - RS 2 PER SHARE/SPECIAL DIVIDEND - RS 3 PER SHARE", [("dividend", 2.0), ("dividend", 3.0)]),
    ("DEMERGER", [("other", None)]),
])
def test_parse_purpose(purpose, expected):
    assert parse_purpose(purpose) == expected


def test_archive_dates_in_both_formats():
    from pipeline.archive import parse_date
    got = parse_date(pd.Series(["28/10/2024", "2026-10-29", " "]))
    assert got.tolist()[:2] == [pd.Timestamp("2024-10-28"), pd.Timestamp("2026-10-29")]
    assert pd.isna(got.tolist()[2])


def test_bonus_from_exchange_halves_earlier_prices():
    p = add_adjustment(rows([200.0, 202.0, 101.0, 103.0]), action("2025-01-03", "BONUS 1:1"))
    assert list(p["adj_source"].fillna("")) == ["", "", "exchange", ""]
    assert list((p["close"] * p["adj"]).round(2)) == [100.0, 101.0, 101.0, 103.0]


def test_split_with_new_isin_is_linked_and_adjusted():
    new_isin = "INE000A01029"
    before = rows([500.0, 505.0], start="2025-01-01")
    after = rows([101.0, 102.0], start="2025-01-03", isin=new_isin)
    acts = action("2025-01-03", "FV SPLT FRM RS 10 TO RS 2")
    p, acts, links = link_isins(pd.concat([before, after], ignore_index=True), acts)
    assert links == {ISIN: new_isin}
    p = add_adjustment(p, acts)
    assert set(p["isin"]) == {new_isin}
    assert p["adj_source"].tolist()[2] == "exchange"
    assert list((p["close"] * p["adj"]).round(2)) == [100.0, 101.0, 101.0, 102.0]


def test_action_without_matching_price_move_is_not_applied():
    p = add_adjustment(rows([200.0, 202.0, 201.0]), action("2025-01-02", "BONUS 1:1"))
    assert (p["factor"] == 1.0).all()
    assert p["adj_source"].tolist()[1] == "unconfirmed"


def test_bse_only_split_is_guessed_but_crashes_are_not():
    split = add_adjustment(rows([500.0, 505.0, 101.0], exchange="BSE"))
    assert split["factor"].tolist()[2] == pytest.approx(0.2)
    crash = add_adjustment(rows([100.0, 90.0, 55.0], exchange="BSE"))
    assert (crash["factor"] == 1.0).all()
    nse_jump = add_adjustment(rows([500.0, 505.0, 101.0]))
    assert (nse_jump["factor"] == 1.0).all()


def test_metrics_across_bonus_and_dividend_yield():
    closes = [200.0] * 300 + [100.0] * 5
    p = rows(closes, start="2024-01-01")
    bonus_day, dividend_day = p["date"][300], p["date"][290]
    acts = pd.concat([action(bonus_day, "BONUS 1:1"), action(dividend_day, "DIV - RS 4 PER SH")])
    m = metrics(p, acts).iloc[0]
    assert m["ret_1y"] == pytest.approx(0.0)
    assert m["high_52w"] == pytest.approx(100.0)
    assert m["dma_200"] == pytest.approx(100.0)
    assert m["dividend_ttm"] == pytest.approx(2.0)  # Rs 4 before a 1:1 bonus
    assert m["dividend_yield_pct"] == pytest.approx(2.0)
