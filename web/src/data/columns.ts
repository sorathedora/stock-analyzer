export type Format = "price" | "pct" | "signed" | "ratio" | "crore" | "int" | "date" | "text" | "bool";

export interface ColumnDef {
  key: string;
  label: string;
  short?: string;
  group: string;
  format: Format;
  /** Higher values are better (true), worse (false) or neither (undefined). */
  better?: boolean;
  /** Other names accepted in the query bar. */
  aliases?: string[];
  help: string;
}

export const COLUMNS: ColumnDef[] = [
  // Classification
  { key: "sector", label: "Sector", group: "Price", format: "text", help: "One of 22 broad sectors in the NSE/BSE/AMFI classification, e.g. Capital Goods." },
  { key: "sub_industry", label: "Sub-industry", group: "Price", format: "text", help: "Rediff Money's finer industry, e.g. Auto Ancl - Gears & Drive. Industry PE and peers use the broader Industry." },
  // Price
  { key: "close", label: "CMP", group: "Price", format: "price", aliases: ["price", "cmp", "close"], help: "Current market price: the official closing price on NSE (BSE for BSE-only companies), updated after every trading day." },
  { key: "change_pct", label: "Day change", short: "Day", group: "Price", format: "signed", better: true, aliases: ["day", "change"], help: "Change from the previous close." },
  { key: "market_cap_cr", label: "Market cap", short: "Mkt cap", group: "Price", format: "crore", aliases: ["mcap", "market_cap"], help: "Close × shares outstanding (NSE's daily share count). ₹ crore." },
  { key: "high_52w", label: "52-week high", group: "Price", format: "price", help: "Highest price in the last year, adjusted for splits and bonuses." },
  { key: "low_52w", label: "52-week low", group: "Price", format: "price", help: "Lowest price in the last year, adjusted for splits and bonuses." },
  { key: "pct_from_52w_high", label: "From 52W high", group: "Technicals", format: "signed", aliases: ["from_high"], help: "How far the price is below its 52-week high." },
  { key: "pct_from_52w_low", label: "From 52W low", group: "Technicals", format: "signed", aliases: ["from_low"], help: "How far the price is above its 52-week low." },
  // Returns
  { key: "ret_1w", label: "1W return", short: "1W", group: "Returns", format: "signed", better: true, help: "Price return over 1 week, adjusted for splits and bonuses." },
  { key: "ret_1m", label: "1M return", short: "1M", group: "Returns", format: "signed", better: true, help: "Price return over 1 month." },
  { key: "ret_3m", label: "3M return", short: "3M", group: "Returns", format: "signed", better: true, help: "Price return over 3 months." },
  { key: "ret_6m", label: "6M return", short: "6M", group: "Returns", format: "signed", better: true, help: "Price return over 6 months." },
  { key: "ret_1y", label: "1Y return", short: "1Y", group: "Returns", format: "signed", better: true, help: "Price return over 1 year." },
  { key: "ret_3y", label: "3Y return", short: "3Y", group: "Returns", format: "signed", better: true, help: "Price return over 3 years (total, not yearly)." },
  { key: "ret_5y", label: "5Y return", short: "5Y", group: "Returns", format: "signed", better: true, help: "Price return over 5 years (total, not yearly)." },
  // Valuation
  { key: "pe", label: "PE", group: "Valuation", format: "ratio", better: false, aliases: ["p_e", "stock_pe"], help: "Price ÷ earnings per share. Uses the company's own last-four-quarter EPS when available, else Google Finance. Blank for loss-makers." },
  { key: "industry_pe", label: "Industry PE", short: "Ind. PE", group: "Valuation", format: "ratio", aliases: ["ind_pe", "sector_pe"], help: "Median PE of actively traded companies in the same industry (needs 5 or more with a PE). Compare with the company's own PE." },
  { key: "peg", label: "PEG", group: "Valuation", format: "ratio", better: false, aliases: ["peg_ratio"], help: "PE ÷ yearly EPS growth (%). Below 1 is often read as cheap for its growth. Growth is today's EPS vs EPS in March 2025 (implied by NSE's published PE), until a year of the company's own results is on file. Blank when EPS fell." },
  { key: "eps_growth_pct", label: "EPS growth (yearly)", short: "EPS growth", group: "Valuation", format: "signed", better: true, aliases: ["eps_growth"], help: "Yearly growth rate of EPS used for PEG: today's EPS vs March 2025." },
  { key: "pb", label: "Price to book", short: "PB", group: "Valuation", format: "ratio", better: false, aliases: ["p_b"], help: "Price ÷ book value per share, from the latest balance sheet filed." },
  { key: "earnings_yield_pct", label: "Earnings yield", group: "Valuation", format: "pct", better: true, aliases: ["ey"], help: "Earnings ÷ price, i.e. 100 ÷ PE." },
  { key: "dividend_yield_pct", label: "Dividend yield", short: "Div yield", group: "Valuation", format: "pct", better: true, aliases: ["dy", "dividend_yield"], help: "Dividends with ex-dates in the last year ÷ price." },
  { key: "dividend_ttm", label: "Dividend (1Y)", group: "Valuation", format: "price", help: "Dividends per share with ex-dates in the last year, adjusted for later splits." },
  { key: "eps", label: "EPS", group: "Valuation", format: "price", better: true, help: "Earnings per share over the last year: the company's own last four quarters when on file, else its last full year, else Google Finance." },
  { key: "eps_ttm", label: "EPS (own filings)", group: "Valuation", format: "price", better: true, aliases: ["eps_ttm"], help: "Earnings per share over the last four quarters, from the company's own filings." },
  { key: "eps_google", label: "EPS (Google)", group: "Valuation", format: "price", help: "Earnings per share reported by Google Finance, used to cross-check PE." },
  { key: "ev_ebitda", label: "EV / EBITDA", short: "EV/EBITDA", group: "Valuation", format: "ratio", better: false, aliases: ["ev_ebitda", "ev_by_ebitda"], help: "Enterprise value ÷ a year of EBITDA. Not shown for banks and NBFCs, or when EBITDA is negative." },
  { key: "ev_cr", label: "Enterprise value", short: "EV", group: "Valuation", format: "crore", help: "Market cap + debt − cash. ₹ crore." },
  // Quality
  { key: "roe_pct", label: "ROE", group: "Quality", format: "pct", better: true, aliases: ["roe"], help: "Profit ÷ shareholders' equity. Annualised from the year to date until four quarters are on file." },
  { key: "roce_pct", label: "ROCE", group: "Quality", format: "pct", better: true, aliases: ["roce"], help: "Operating profit before interest and tax ÷ (equity + debt). Last four quarters when on file, else year to date annualised. Not shown for banks and NBFCs." },
  { key: "ebitda_margin_q_pct", label: "EBITDA margin", short: "EBITDA %", group: "Quality", format: "pct", better: true, aliases: ["opm", "ebitda_margin"], help: "Operating profit before depreciation ÷ revenue, latest quarter." },
  { key: "net_margin_q_pct", label: "Net margin", group: "Quality", format: "pct", better: true, aliases: ["npm", "net_margin"], help: "Net profit ÷ revenue, latest quarter." },
  { key: "debt_to_equity", label: "Debt to equity", short: "D/E", group: "Quality", format: "ratio", better: false, aliases: ["de", "d_e"], help: "Borrowings ÷ shareholders' equity, latest balance sheet." },
  { key: "current_ratio", label: "Current ratio", group: "Quality", format: "ratio", better: true, help: "Current assets ÷ current liabilities." },
  { key: "free_cash_flow_ytd_cr", label: "Free cash flow (YTD)", short: "FCF YTD", group: "Quality", format: "crore", better: true, aliases: ["fcf"], help: "Operating cash flow − capex, financial year to date. ₹ crore." },
  // Size and results
  { key: "revenue_q_cr", label: "Revenue (qtr)", group: "Results", format: "crore", aliases: ["sales", "revenue"], help: "Revenue from operations, latest quarter. ₹ crore." },
  { key: "net_profit_q_cr", label: "Net profit (qtr)", group: "Results", format: "crore", better: true, aliases: ["profit", "pat"], help: "Profit attributable to shareholders, latest quarter. ₹ crore." },
  { key: "book_value_cr", label: "Book value", group: "Results", format: "crore", help: "Shareholders' equity, latest balance sheet. ₹ crore." },
  { key: "debt_cr", label: "Debt", group: "Results", format: "crore", help: "Total borrowings, latest balance sheet. ₹ crore." },
  { key: "cash_cr", label: "Cash", group: "Results", format: "crore", help: "Cash, bank balances and current investments. ₹ crore." },
  { key: "latest_quarter", label: "Latest quarter", group: "Results", format: "date", help: "Period end of the latest quarterly results on file." },
  // Ownership
  { key: "promoter_pct", label: "Promoter holding", short: "Promoter", group: "Ownership", format: "pct", aliases: ["promoter"], help: "Promoter and promoter group holding, latest shareholding filing." },
  { key: "promoter_pct_change", label: "Promoter change", group: "Ownership", format: "signed", help: "Change in promoter holding since the previous filing (percentage points)." },
  { key: "fii_pct", label: "FII holding", short: "FII", group: "Ownership", format: "pct", aliases: ["fii"], help: "Foreign institutional holding." },
  { key: "fii_pct_change", label: "FII change", group: "Ownership", format: "signed", help: "Change in FII holding since the previous filing (percentage points)." },
  { key: "dii_pct", label: "DII holding", short: "DII", group: "Ownership", format: "pct", aliases: ["dii"], help: "Domestic institutional holding (mutual funds, insurers, banks)." },
  { key: "mutual_fund_pct", label: "Mutual fund holding", short: "MF", group: "Ownership", format: "pct", aliases: ["mf"], help: "Held by mutual funds (part of DII)." },
  { key: "mutual_fund_pct_change", label: "MF change", group: "Ownership", format: "signed", help: "Change in mutual fund holding since the previous filing (percentage points)." },
  { key: "retail_pct", label: "Retail holding", short: "Retail", group: "Ownership", format: "pct", aliases: ["retail"], help: "Held by individuals with up to ₹2 lakh of share capital each." },
  { key: "retail_pct_change", label: "Retail change", group: "Ownership", format: "signed", help: "Change in retail holding since the previous filing (percentage points)." },
  { key: "public_pct", label: "Non-institutional holding", short: "Non-inst.", group: "Ownership", format: "pct", aliases: ["public", "non_institutional"], help: "Held by the public outside institutions: individuals, corporates, NRIs, trusts and others." },
  { key: "promoter_pledged_pct", label: "Promoter pledged", short: "Pledged", group: "Ownership", format: "pct", better: false, aliases: ["pledged"], help: "Share of promoter holding that is pledged." },
  // Technicals
  { key: "dma_50", label: "50-day average", short: "50 DMA", group: "Technicals", format: "price", help: "Average adjusted close over the last 50 trading days." },
  { key: "dma_200", label: "200-day average", short: "200 DMA", group: "Technicals", format: "price", help: "Average adjusted close over the last 200 trading days." },
  { key: "above_dma_50", label: "Above 50 DMA", group: "Technicals", format: "bool", help: "Close is above its 50-day average." },
  { key: "above_dma_200", label: "Above 200 DMA", group: "Technicals", format: "bool", help: "Close is above its 200-day average." },
  { key: "avg_value_20d_cr", label: "Avg traded value", short: "Traded/day", group: "Technicals", format: "crore", aliases: ["liquidity"], help: "Average daily traded value over 20 days. ₹ crore." },
  { key: "avg_volume_20d", label: "Avg volume", group: "Technicals", format: "int", help: "Average daily traded shares over 20 days." },
];

export const BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));

/** Special visual columns rendered by the table, not numeric metrics. */
export const VISUAL = { spark: "1 year", range: "52-week range" } as const;

export const PRESETS: Record<string, string[]> = {
  Overview: ["close", "range", "market_cap_cr", "pe", "dividend_yield_pct", "industry_pe", "peg", "pb", "debt_to_equity", "roce_pct", "roe_pct", "ev_ebitda"],
  Snapshot: ["close", "change_pct", "spark", "ret_1y", "range", "market_cap_cr", "pe", "dividend_yield_pct", "ret_1m"],
  Valuation: ["close", "market_cap_cr", "pe", "pb", "earnings_yield_pct", "dividend_yield_pct", "ev_cr", "eps"],
  Quality: ["close", "market_cap_cr", "roe_pct", "ebitda_margin_q_pct", "net_margin_q_pct", "debt_to_equity", "current_ratio", "free_cash_flow_ytd_cr"],
  Results: ["close", "latest_quarter", "revenue_q_cr", "net_profit_q_cr", "book_value_cr", "debt_cr", "cash_cr", "pe"],
  Ownership: ["close", "market_cap_cr", "promoter_pct", "promoter_pct_change", "fii_pct", "fii_pct_change", "dii_pct", "mutual_fund_pct", "retail_pct", "retail_pct_change", "promoter_pledged_pct"],
  Technicals: ["close", "spark", "range", "pct_from_52w_high", "ret_1w", "ret_1m", "ret_3m", "ret_6m", "dma_50", "dma_200", "avg_value_20d_cr"],
  Returns: ["close", "spark", "ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y", "ret_5y"],
};
