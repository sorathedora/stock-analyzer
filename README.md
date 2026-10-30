# stock-analyzer

Personal stock analysis tool for NSE and BSE listed companies: watchlists,
ratios (PE first), industry/peer comparison and company charts, built only
on free public data.

## Data sources (verified in step 0)

- Prices: NSE and BSE daily bhavcopy files (history back to 2021)
- Current PE / EPS / market cap: Google Finance via a published Google Sheet
- Quarterly results, shareholding, corporate actions: NSE RSS feeds linking to XBRL filings
- Industry: NSE index constituent lists (about 1,000 companies)

## Check data sources

`scripts/check_sources.py` downloads one file from each source. Run it from
the Actions tab ("Check data sources" → "Run workflow") to confirm GitHub's
servers can reach them.
