"""One-time (or occasional) import of annual-report figures from Rediff Money.

Rediff publishes standalone balance sheets, profit and loss and cash flow
statements for ~5,500 listed companies and lists every page in sitemaps
for crawlers (money.rediff.com/robots.txt). This fills book value, debt,
cash and profit for companies whose results we haven't collected from NSE
yet. Each company's page also shows its BSE code and NSE symbol, which is
how rows are matched to ours.

Figures are the latest financial year (e.g. FY ending March 2026), standalone,
in ₹ crore.
"""
import html
import io
import re
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from .fetch import get

SITEMAP = "https://money.rediff.com/moneysitemaps/company-sitemap.xml"
WORKERS = 10  # companies read at once; each makes 4 requests in turn

_INDUSTRY = re.compile(r"NEWS FOR ([^<]+)</h2>")
_CODES = re.compile(r"(\d{6})\s*(?:&nbsp;\s*)+([A-Z0-9&\-]*)\s*(?:&nbsp;\s*)+Group", re.I)


def company_urls():
    xml = get(SITEMAP).decode("utf-8", "replace")
    urls = re.findall(r"<loc>([^<]+)</loc>", xml)
    return [u.rstrip("/") for u in urls if re.search(r"/companies/[^/]+/\d+/?$", u)]


def _table(raw):
    """First statement table as {label: [latest, previous, ...]} plus year ends."""
    tables = pd.read_html(io.StringIO(raw.decode("utf-8", "replace")))
    t = next((t for t in tables if t.shape[1] >= 3 and str(t.columns[1])[:3] in ("Mar", "Jun", "Sep", "Dec")), None)
    if t is None:
        return {}, []
    years = [str(c) for c in t.columns[1:]]
    rows = {}
    for _, r in t.iterrows():
        label = str(r.iloc[0]).strip().lower()
        # "-" is Rediff's zero; "####" means the number didn't fit and is unknown.
        vals = [0.0 if str(v).strip() == "-" else pd.to_numeric(str(v).replace(",", ""), errors="coerce") for v in r.iloc[1:]]
        rows.setdefault(label, vals)
    return rows, years


def _year_end(label):
    """"Mar ' 26" -> 2026-03-31."""
    m = re.match(r"([A-Za-z]{3})\s*'\s*(\d{2})", label)
    if not m:
        return None
    return pd.Timestamp(f"20{m.group(2)}-{m.group(1)}-01") + pd.offsets.MonthEnd(0)


def _v(rows, label, i=0):
    vals = rows.get(label)
    return None if not vals or i >= len(vals) or pd.isna(vals[i]) else float(vals[i])


def _norm(s):
    return re.sub(r"(limited|ltd)$", "", re.sub(r"[^a-z0-9]+", "", s.lower()))


def fetch_main(url):
    """BSE code, NSE symbol and industry from a company's main page."""
    main = get(url, html=True)
    if not main:
        return None
    page = main.decode("utf-8", "replace")
    codes = _CODES.search(page)
    # "NEWS FOR …" headings: the company's own news (larger companies only),
    # then its industry's. Take the last one that isn't the company's name.
    slug = _norm(url.rstrip("/").split("/")[-2].replace("-", " "))
    headings = [h for h in (html.unescape(x).strip() for x in _INDUSTRY.findall(page)) if _norm(h) != slug]
    return {
        "rediff_url": url,
        "bse_code": codes.group(1) if codes else None,
        "nse_symbol": (codes.group(2) or None) if codes else None,
        "industry": headings[-1] if headings else None,
    }


def fetch_company(url):
    """Latest annual figures for one company, or None if pages are missing."""
    main = fetch_main(url)
    if not main:
        return None
    bse, nse, industry = main["bse_code"], main["nse_symbol"], main["industry"]
    pages = {k: get(f"{url}/{k}", html=True) for k in ("balance-sheet", "profit-and-loss", "cash-flow")}
    if not pages["balance-sheet"] or not pages["profit-and-loss"]:
        return None
    bs, years = _table(pages["balance-sheet"])
    pl, _ = _table(pages["profit-and-loss"])
    cf, _ = _table(pages["cash-flow"]) if pages["cash-flow"] else ({}, [])
    if not years:
        return None

    def equity(i):
        parts = [_v(bs, "equity share capital", i), _v(bs, "preference share capital", i), _v(bs, "reserves & surplus", i)]
        return None if parts[0] is None and parts[2] is None else sum(p or 0 for p in parts)

    def debt(i):
        s, u = _v(bs, "secured loans", i), _v(bs, "unsecured loans", i)
        return None if s is None and u is None else (s or 0) + (u or 0)

    return {
        "rediff_url": url, "bse_code": bse, "nse_symbol": nse,
        "industry": industry,
        "fy_end": _year_end(years[0]),
        "equity_cr": equity(0), "equity_prev_cr": equity(1), "debt_cr": debt(0),
        "investments_cr": _v(bs, "investments"),
        "cash_cr": _v(cf, "cash and equivalnt end of year"),
        "revenue_cr": _v(pl, "operating income"), "revenue_prev_cr": _v(pl, "operating income", 1),
        "operating_profit_cr": _v(pl, "operating profit"),
        "other_income_cr": _v(pl, "other recurring income"),
        "interest_cr": _v(pl, "financial expenses"),
        "depreciation_cr": _v(pl, "depreciation"),
        "pbt_cr": _v(pl, "adjusted pbt"),
        "net_profit_cr": _v(pl, "reported net profit"), "net_profit_prev_cr": _v(pl, "reported net profit", 1),
        "cash_from_operations_cr": _v(cf, "net cashflow-operating activity"),
    }


def _safe(url, fn=None):
    try:
        return (fn or fetch_company)(url)
    except Exception as e:  # one bad page must not stop the import
        return {"rediff_url": url, "error": repr(e)[:200]}


def import_industries(urls=None, workers=WORKERS, done=None, save=None, every=500):
    """Industry and codes only: one page per company instead of four."""
    return import_all(urls, workers, done, save, every, fn=fetch_main)


def import_all(urls=None, workers=WORKERS, done=None, save=None, every=200, fn=None):
    """Read every company; skip URLs in `done`; call save(rows) every so often."""
    urls = urls if urls is not None else company_urls()
    todo = [u for u in urls if u not in (done or set())]
    print(f"{len(urls)} companies listed, {len(todo)} to read")
    rows = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, row in enumerate(pool.map(lambda u: _safe(u, fn), todo), 1):
            if row:
                rows.append(row)
            if i % every == 0:
                print(f"{i}/{len(todo)} read", flush=True)
                if save:
                    save(pd.DataFrame(rows))
                    rows = []
    if save and rows:
        save(pd.DataFrame(rows))
    return pd.DataFrame(rows)


def match_isins(df, universe):
    """Attach ISINs: NSE symbol first, then BSE code."""
    by_nse = universe.dropna(subset=["nse_symbol"]).drop_duplicates("nse_symbol").set_index("nse_symbol")["isin"]
    by_bse = universe.dropna(subset=["bse_code"]).drop_duplicates("bse_code").set_index("bse_code")["isin"]
    isin = df["nse_symbol"].map(by_nse)
    return df.assign(isin=isin.fillna(df["bse_code"].map(by_bse)))
