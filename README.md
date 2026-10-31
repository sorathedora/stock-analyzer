# Parakh

**परख** (*parakh*): to assay, to test something for what it really is, the
way a jeweller rubs gold on a touchstone. Parakh is a personal stock
analysis tool for every company listed on NSE and BSE. It covers
watchlists, screening, industry comparison and company pages, and it's
built only on free, public data, with every number traceable to its source.

Brand colour: **Jamun** `#5B2EE0` (dark theme `#A18BFF`). Both pass WCAG
AA contrast in text and button use. Green and red are kept for gains and
losses only.

---

## How the data flows

```
           NSE / BSE public files                     Google Finance
  ┌───────────────────────────────────────┐        (published Google Sheet)
  │ daily price files (bhavcopy)           │                 │
  │ daily archive zip (corporate actions,  │                 │
  │   share counts, NSE PE)                │                 │
  │ company list, index industry lists     │                 │
  │ RSS feeds → XBRL results/shareholding  │                 │
  └───────────────┬───────────────────────┘                 │
                  │                                          │
        GitHub Actions (free, public repo)                   │
  ┌───────────────▼──────────────────────────────────────────▼──┐
  │ Collect filings   every 10 min   pipeline filings            │
  │ Daily data        20:00 + 23:00 IST, weekdays                │
  │                   pipeline daily → prices, metrics, ratios   │
  │ Backfill data     on demand (history, repairs)               │
  └───────────────┬─────────────────────────────────────────────┘
                  │  parquet files saved as assets of the
                  │  GitHub release "data"
                  ▼
        pipeline export → companies.json, sparks.json,
                           company/{isin}.json
                  │
                  ▼
        Web app (React) loads companies.json once (~0.5 MB
        compressed) and does all search/sort/filter on the device
```

Everything runs on GitHub's free runners. Nothing runs on your computer.

---

## Where each piece of data comes from

| Data | Source (public URL) | How often | Coverage |
|---|---|---|---|
| Daily open/high/low/close, volume, traded value | NSE bhavcopy `nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_…csv.zip` (old format before 8 Jul 2024: `…/content/historical/EQUITIES/{yyyy}/{MON}/cm{dd}{MON}{yyyy}bhav.csv.zip`) | Every trading day | All NSE equity series EQ, BE, BZ, SM, ST, SZ, from Oct 2020 |
| Same, for BSE | BSE bhavcopy `bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_…CSV` (old: `EQ_ISINCODE_{ddmmyy}.zip`) | Every trading day | All BSE equities. Used only for companies **not** on NSE |
| Company list, ISINs, NSE symbols, BSE codes | NSE `EQUITY_L.csv` + the day's NSE and BSE price files | Daily | ~4,900 traded companies, plus any that traded at some point since 2020 |
| Industry | NSE index constituent lists `…/content/indices/ind_nifty500list.csv`, `ind_niftytotalmarket_list.csv`, `ind_niftymicrocap250_list.csv` | Daily | ~750 companies (Nifty Total Market). The rest are "unclassified" for now |
| Corporate actions (bonus, split, consolidation, dividends) | NSE daily archive `nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{ddmmyy}.zip` → `Bc*.csv` | Daily | NSE-listed companies, from 2020 |
| Shares outstanding (for market cap) | Same archive → `MCAP*.csv` (Issue Size) | Daily | NSE-listed companies, from early 2024 |
| NSE's own published PE (history) | Same archive → `PE_*.csv` | Daily, while NSE published it | Early 2024 to mid 2025 only. Kept for cross-checking |
| Quarterly/half-year results (P&L, balance sheet, cash flow, EPS) | NSE RSS `content/RSS/Integrated_Filing_Financials.xml` and `Financial_Results.xml`, which link to each company's XBRL filing | Every 10 minutes | From 30 Oct 2026 onward, as companies file |
| Shareholding pattern (promoter, FII, DII, MF, public, pledged) | NSE RSS `content/RSS/Shareholding_Pattern.xml`, linking to XBRL | Every 10 minutes | From 30 Oct 2026 onward, as companies file |
| Current EPS and PE (cross-check and fallback) | Google Finance `GOOGLEFINANCE(ticker,"eps")` in a Google Sheet published as CSV (repo variable `GOOGLE_SHEET_CSV_URL`) | Daily | ~4,160 of 4,930 companies. NSE SME stocks aren't covered by Google |

**What isn't used, and why.** NSE's and BSE's website APIs (quote pages,
filings search) block automated access. Getting around that would break
their terms and stop working without warning, so Parakh doesn't do it.
Screener, Moneycontrol and Yahoo Finance aren't scraped either. Every
source above is a file the exchange or Google publishes for download.

---

## How the numbers are calculated

### Prices and returns
- **Price**: official close (NSE; BSE for BSE-only companies).
- **Split/bonus adjustment.** Exchanges publish the ex-date and terms in the
  archive's `Bc` file, e.g. `BONUS 1:1` → factor 0.5, `FV SPLT FRM RS 10 TO RS 2`
  → 0.2. A factor is applied **only if the price actually moved that way on
  the ex-date**. Otherwise it's logged as "unconfirmed" in `adjustments.csv`
  and ignored, so a misread action can't distort history.
- **New ISINs after a split.** A face-value split gives the share a new ISIN.
  The old and new histories are joined through the unchanged NSE symbol or
  BSE code.
- **BSE-only companies** have no action data. A one-day jump bigger than
  daily price limits allow (≥30%) that is within 2% of a common factor
  (½, ⅓, ⅔, ⅖, ⅕, ⅒ or their inverses) is treated as a split or bonus and
  marked "guessed".
- **Returns** (1W … 5Y): adjusted close today ÷ adjusted close on or before
  the start date − 1. Left blank if the company wasn't trading yet.
- **52-week high/low**: from adjusted daily highs and lows.
- **50/200-day averages**: of adjusted closes over the last 50/200 trading days.
- **Dividend yield**: dividends with ex-dates in the last 365 days (from `Bc`,
  adjusted to today's share basis) ÷ price.
- **Market cap**: close × NSE's daily share count (NSE companies only).

### PE and EPS: three sources, cross-checked
1. **Own filings, TTM**: sum of the last four consecutive quarterly EPS
   (consolidated if the company files it, else standalone).
2. **Own filings, last full year**, if four quarters aren't on file yet.
3. **Google Finance EPS**, as a fallback.

PE = official close ÷ EPS. Each PE carries a trust dot:

| Dot | Meaning |
|---|---|
| 🟢 verified | own filings and Google agree within 10% |
| 🔴 mismatch | they disagree by more than 10%, or one shows a loss |
| 🟠 single source | only one source has EPS so far |

PE is left blank for loss-makers. PE above 200 is noted as "earnings near zero".

### From results filings (XBRL)
Each filing carries the quarter (context `OneD`), the year to date (`FourD`)
and the balance sheet date (`OneI`). Half-yearly SME filers carry one
six-month period. Field names cover both Ind AS and non-Ind AS filers.

| Metric | Formula |
|---|---|
| EBITDA margin (qtr) | (PBT + finance cost + depreciation − other income) ÷ revenue |
| Net margin (qtr) | net profit ÷ revenue |
| Book value | equity attributable to owners (or share capital + reserves) |
| Price to book | price ÷ (book value ÷ shares) |
| Debt to equity | (long-term + short-term borrowings) ÷ book value |
| ROE | TTM profit ÷ book value. Until four quarters exist, year-to-date profit annualised (labelled) |
| EV | market cap + debt − cash (cash + bank balances + current investments) |
| ROCE | a year of EBIT (PBT + finance cost) ÷ (equity + debt). Not shown for banks/NBFCs |
| EV / EBITDA | EV ÷ a year of EBITDA. Not shown for banks/NBFCs or negative EBITDA |

"A year" means the last four quarters when on file, else the year to date
annualised.

### Industry PE and PEG (no filings needed)
- **Industry PE**: median PE of the actively traded companies in the same
  industry (needs 5 or more with a PE).
- **PEG** = PE ÷ yearly EPS growth (%). Until a year of the company's own
  results is on file, growth compares today's EPS with EPS implied by NSE's
  own published PE on 21 Mar 2025 (split-adjusted close ÷ NSE PE that day).
  Blank when EPS fell.
| Free cash flow (YTD) | cash from operations − capex, financial year to date |
| Current ratio | current assets ÷ current liabilities |

Share counts always come from NSE's daily file, never from filings,
because filings sometimes contain paid-up capital errors.

### Industry comparison
For each metric, the app sorts every active company in the same industry
and shows the company's percentile and the industry median. Industries with
fewer than 5 companies reporting that metric fall back to the whole market,
and the app says so.

---

## Why some columns are empty right now

PB, EV, ROE, margins, debt/equity, book value and shareholding come only
from the companies' own filings. Collection started on **30 Oct 2026**, the
first day the collector ran. They fill in as companies file:

- The September-quarter deadline is **14 Nov 2026**, so most companies will
  file in the next two weeks. Those filings include the half-year balance
  sheet, which fills PB, D/E, ROE, EV and margins.
- Companies that filed **before 30 Oct** (many large caps file in mid-October)
  stay empty until their next filing: December-quarter results in Jan–Feb
  for margins and EPS, and annual results in Apr–May for the balance sheet.
- Year-on-year growth needs the same quarter a year apart, so it appears
  from Oct 2027.

The app shows how many companies have filings on file whenever these
columns are visible.

---

## Storage

All pipeline output is saved as assets of the GitHub release `data`
(`scripts/data_release.sh download|upload`):

| File | Contents |
|---|---|
| `prices_YYYY.parquet` | daily prices per company per year (NSE preferred), with NSE share count |
| `universe.parquet` | company list: ISIN, name, NSE symbol, BSE code, industry, last traded |
| `corporate_actions.parquet` | parsed bonuses, splits, dividends (ex-date, value, original text) |
| `nse_pe.parquet` | NSE's published PE history (2024–25) |
| `price_metrics.parquet/.csv` | latest price metrics per company |
| `adjustments.csv` | every split/bonus applied, guessed or rejected |
| `filings_index.parquet` | every filing link seen, with parse status |
| `results.parquet` | parsed results, one row per company × basis × period |
| `shareholding.parquet` | parsed shareholding, one row per company × date |
| `google_history.parquet` | daily Google EPS/PE snapshots (builds PE history) |
| `ratios.parquet/.csv` | final table: every metric for every company |

## Schedules (GitHub Actions)

| Workflow | When | Does |
|---|---|---|
| Collect filings | every 10 min | reads the RSS feeds, downloads and parses new XBRL filings |
| Daily data | 20:00 and 23:00 IST, Mon–Fri | new trading days → prices, actions, metrics, ratios |
| Backfill data | manual | `backfill START END` for price history, or `archive START END` to re-read corporate actions |
| Tests | every push | pipeline and app tests |
| Check data sources | manual | confirms each public source downloads |

## Known gaps

- **Industry tags**: ~750 companies only. A one-time tagging of the rest is planned.
- **Past results**: not available from any free, legitimate source, so history builds from Oct 2026.
- **Feed completeness**: NSE's RSS shows only the latest ~20 filings, so in
  peak hours a filing could be missed between 10-minute checks.
  `filings_index.parquet` records what was seen, so coverage can be audited.
- **Banks**: their filings use bank-specific fields (interest earned,
  advances, NPAs). These are parsed but not yet verified against a real bank filing.
- **Not adjusted**: demergers and rights issues.
- **BSE-only companies**: no market cap (BSE publishes no share count) and no dividends.

---

## Repository layout

```
pipeline/            Python data pipeline (python -m pipeline …)
  bhavcopy.py        NSE/BSE daily price files, both formats
  archive.py         NSE daily archive: corporate actions, share counts, NSE PE
  universe.py        company list and industry tags
  prices.py          split/bonus adjustment, ISIN linking, price metrics
  filings.py         XBRL parser for results and shareholding
  collect.py         RSS feed collector
  google.py          Google Finance sheet (make + read)
  ratios.py          final ratios and PE cross-check
  export.py          JSON files for the web app
web/                 React app (Vite + TypeScript)
  src/data/          data loading, query language, watchlists, formats
  src/components/    table, charts, quick view, palette, dialogs
  src/pages/         watchlist, all companies, industries, company, compare
design/              design brief and the original clickable mockup
tests/               pipeline tests (pytest) with real XBRL fixtures
.github/workflows/   the schedules above
```

## Commands

```bash
# pipeline (Python 3.13)
uv venv -p 3.13 .venv && uv pip install -p .venv -r requirements.txt
.venv/bin/python -m pipeline backfill 2025-10-01 2026-10-29   # history
.venv/bin/python -m pipeline daily                            # new days
.venv/bin/python -m pipeline filings                          # new filings
.venv/bin/python -m pipeline ratios                           # rebuild ratios
.venv/bin/python -m pipeline export web/public/data           # app data
.venv/bin/python -m pytest -q tests

# web app
cd web && npm install && npm run dev        # http://localhost:5173
npx vitest run
```
