"""Collect new results and shareholding filings from NSE's RSS feeds.

The feeds only show the latest ~20 filings, so this runs every few minutes.
Each new filing's XBRL is downloaded once, parsed, and appended to
results.parquet or shareholding.parquet. filings_index.parquet records
every link seen, so re-runs skip what is already stored.
"""
import re

import pandas as pd

from . import filings, store
from .fetch import get

FEEDS = {
    "results": [
        "https://nsearchives.nseindia.com/content/RSS/Integrated_Filing_Financials.xml",
        "https://nsearchives.nseindia.com/content/RSS/Financial_Results.xml",
    ],
    "shareholding": ["https://nsearchives.nseindia.com/content/RSS/Shareholding_Pattern.xml"],
}

_ITEM = re.compile(r"<item>(.*?)</item>", re.S)


def _tag(item, name):
    m = re.search(rf"<{name}>(.*?)</{name}>", item, re.S)
    return m.group(1).strip() if m else None


def feed_items(kind):
    rows = []
    for url in FEEDS[kind]:
        raw = get(url)
        if not raw:
            continue
        for item in _ITEM.findall(raw.decode("utf-8", "replace")):
            link = _tag(item, "link")
            if link and link.lower().endswith(".xml"):
                rows.append({"kind": kind, "link": link.replace("://archives.", "://nsearchives."),
                             "company": _tag(item, "title"), "description": _tag(item, "description"),
                             "published": pd.to_datetime(_tag(item, "pubDate"), format="%d-%b-%Y %H:%M:%S",
                                                         errors="coerce")})
    return pd.DataFrame(rows)


def collect():
    index = pd.read_parquet(store.FILINGS_INDEX) if store.FILINGS_INDEX.exists() else pd.DataFrame(columns=["link"])
    seen = set(index["link"])
    new_index, results, holdings = [], [], []
    for kind in FEEDS:
        items = feed_items(kind)
        if items.empty:
            continue
        for item in items[~items["link"].isin(seen)].to_dict("records"):
            raw = get(item["link"])
            status = "missing"
            if raw:
                try:
                    if kind == "results":
                        df = filings.parse_results(raw)
                        if not df.empty:
                            results.append(df.assign(link=item["link"], published=item["published"]))
                    else:
                        holdings.append({**filings.parse_shareholding(raw), "link": item["link"],
                                         "published": item["published"]})
                    status = "parsed"
                except Exception as e:  # keep going; the index records the failure
                    status = f"error: {e}"[:200]
            new_index.append({**item, "status": status, "collected": pd.Timestamp.now(tz="Asia/Kolkata")})
            seen.add(item["link"])

    if results:
        store.save_results(pd.concat(results, ignore_index=True))
    if holdings:
        store.save_shareholding(pd.DataFrame(holdings))
    if new_index:
        store.save_filings_index(pd.DataFrame(new_index))
    print(f"{len(new_index)} new filings ({sum(len(r) for r in results)} result rows, {len(holdings)} shareholding)")
