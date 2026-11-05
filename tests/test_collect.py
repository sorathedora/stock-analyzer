import pandas as pd

from pipeline import collect


def test_lost_table_is_rebuilt_from_index(tmp_path, monkeypatch):
    results, holdings = tmp_path / "results.parquet", tmp_path / "shareholding.parquet"
    results.write_bytes(b"")  # results still stored; shareholding was lost
    monkeypatch.setattr(collect, "TABLES", {"results": results, "shareholding": holdings})
    index = pd.DataFrame({
        "kind": ["results", "shareholding", "shareholding"],
        "link": ["r1", "s1", "s2"], "company": "X", "description": "", "published": pd.Timestamp("2026-11-01"),
        "status": ["parsed", "parsed", "missing"],
    })
    redo = collect.lost(index)
    assert redo["link"].tolist() == ["s1"]   # only parsed filings of the lost table


def test_nothing_redone_when_tables_exist(tmp_path, monkeypatch):
    for name in ("results", "shareholding"):
        (tmp_path / f"{name}.parquet").write_bytes(b"")
    monkeypatch.setattr(collect, "TABLES", {k: tmp_path / f"{k}.parquet" for k in ("results", "shareholding")})
    index = pd.DataFrame({"kind": ["shareholding"], "link": ["s1"], "company": "X", "description": "",
                          "published": pd.Timestamp("2026-11-01"), "status": ["parsed"]})
    assert collect.lost(index).empty
