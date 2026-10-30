# Stock analyzer: UI design brief

Goal: at worst as good as Screener, aim for clearly better and faster.

## What we learned

**Screener (baseline).** One long company page: key ratios, price/PE chart,
auto pros/cons, peers, 10 years of quarters / P&L / balance sheet / cash
flow / ratios, shareholding, documents. Screens via a query language.
Strengths: dense, trusted, query screens. Weaknesses: every click is a page
load, watchlist columns are fixed unless you pay, peers are a static table
with no sense of where a company sits in its industry, no indication of how
reliable a number is, light-mode only, little keyboard support.

**Best-in-class references.** TradingView screener (polished filters, fast
column presets), stockanalysis.com (fastest, least cognitive load), Koyfin
(powerful, dense, steeper), Finviz (dated look), Stripe/Linear (dense tables,
command palette, keyboard-first). Data-table research: sticky first column,
32–36px rows, light row separators instead of zebra, numbers right-aligned
with tabular figures, filter control matched to column type, column presets
so users never have to configure before working, CSV/Excel export that
respects the view, keyboard navigation (j/k, Enter, Space).

**Design system guidance.** ui-craft "dense dashboard" preset
(github.com/educlopez/ui-craft, MIT): Inter + mono for codes, 12–13px table
text, tabular numerals, 4/8 spacing, one accent, semantic colors only on
small marks and text, no pills on deltas, no pie/donut charts, skeleton rows
instead of spinners, motion under 100ms for sort/filter. Charts follow the
dataviz skill: one axis, thin marks, single-hue series, hover tooltips.

## Principles

1. **Instant.** All ~5,000 companies (every ratio) load once (~1 MB
   compressed) and are cached on the device. Search, sort, filter, switch
   watchlists and open a company with no network round-trip.
2. **Context on every number.** Each ratio shows where the company sits in
   its industry (percentile bar with the median marked), not just the value.
3. **Trust is visible.** PE carries a dot: verified against a second source,
   mismatch, or single source. Hover any number for its source and date.
4. **Never configure before working.** Column presets (Overview, Valuation,
   Quality, Growth, Ownership, Technicals) cover common needs; customise later.
5. **Keyboard-first, mouse-friendly.** Cmd/Ctrl+K anywhere; j/k to move,
   Enter to open, w to add to watchlist, c to compare, / to filter.
6. **Calm density.** Dense tables, quiet chrome, one blue accent, green/red
   only for gains/losses (always with a sign), dark mode.

## Screens

1. **Watchlists** (home): left rail with all watchlists and counts; the
   table with column presets, filter chips, a query bar (`pe < 20 and
   roe > 15`) with a live match count, sticky company column, 1-year
   sparkline, 52-week range bar, export. Selecting rows opens a compare tray.
2. **Company quick view**: clicking a row opens a side panel (no page load)
   with price, chart, key ratios vs industry, and peers; "Open full page".
3. **Company page**: header with price, change, market cap, PE + trust dot;
   sections: Overview (chart with range and PE toggle, ratio grid with
   industry percentiles), Peers, Quarterly results, Balance sheet and cash
   flow, Shareholding trend, Corporate actions.
4. **Industry**: every company in an industry, medians, a scatter (e.g. PE
   vs ROE) with the selected company highlighted.
5. **Compare**: up to 6 companies side by side, best value per row marked.
