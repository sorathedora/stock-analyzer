"""Checks that each free data source can be downloaded from this machine.
Run in GitHub Actions to confirm cloud access works."""
import datetime as dt, sys, urllib.request

UA = {"User-Agent": "Mozilla/5.0"}


def last_weekday():
    d = dt.date.today() - dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


d = last_weekday()
ymd = d.strftime("%Y%m%d")
SOURCES = {
    "NSE daily prices": f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{ymd}_F_0000.csv.zip",
    "BSE daily prices": f"https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{ymd}_F_0000.CSV",
    "NSE price history (2021)": "https://nsearchives.nseindia.com/content/historical/EQUITIES/2021/NOV/cm01NOV2021bhav.csv.zip",
    "NSE company list": "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
    "NSE results feed": "https://nsearchives.nseindia.com/content/RSS/Integrated_Filing_Financials.xml",
    "NSE shareholding feed": "https://nsearchives.nseindia.com/content/RSS/Shareholding_Pattern.xml",
    "NSE corporate actions feed": "https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml",
    "NSE index industry list": "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv",
}

failed = 0
for name, url in SOURCES.items():
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            size = len(r.read())
        print(f"OK    {name}: {size:,} bytes")
    except Exception as e:
        failed += 1
        print(f"FAIL  {name}: {e}")
sys.exit(1 if failed else 0)
