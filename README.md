# stock-analyzer

Personal stock analysis tool for NSE and BSE listed companies: watchlists,
ratios (PE first), industry/peer comparison and company charts, built only
on free public data.

## Data pipeline

`python -m pipeline` builds the data in `data/`:

| File | Contents |
|---|---|
| `universe.parquet` | Every equity share traded on NSE or BSE, keyed by ISIN, with NSE symbol, BSE code and industry (NSE index lists, ~750 companies) |
| `prices_YYYY.parquet` | Daily OHLC, volume and (NSE, 2024 onward) shares outstanding; one row per company per day, NSE preferred |
| `corporate_actions.parquet` | NSE bonuses, splits, dividends with ex-dates |
| `nse_pe.parquet` | NSE's own daily PE, available early 2024 to mid 2025 |
| `price_metrics.parquet` / `.csv` | Latest close, market cap, 52-week high/low, 1W–5Y returns, 50/200 DMA, volume, dividend yield |
| `adjustments.csv` | Every split/bonus applied or rejected, for review |

Prices are adjusted for splits and bonuses using NSE's corporate actions,
applied only when the price moved accordingly on the ex-date. A split gives
a share a new ISIN; the old history is linked through the unchanged symbol.
Companies traded only on BSE have no action data, so a jump beyond normal
daily price limits that matches a common split/bonus ratio is treated as one.

Sources: NSE/BSE daily bhavcopy files and NSE's daily archive zip
(`PR{ddmmyy}.zip`), all public downloads.

## GitHub workflows

- **Daily data** runs at 20:00 and 23:00 IST on weekdays, adds new trading
  days and rebuilds the metrics.
- **Backfill data** (run manually) fetches a date range.
- **Tests** runs the unit tests on every push.
- **Check data sources** downloads one file from each source.

Output is stored as assets of the `data` release (`scripts/data_release.sh`).

## Local use

```bash
uv venv -p 3.13 .venv && uv pip install -p .venv -r requirements.txt
.venv/bin/python -m pipeline backfill 2024-09-02 2024-11-29
.venv/bin/python -m pytest -q tests
```
