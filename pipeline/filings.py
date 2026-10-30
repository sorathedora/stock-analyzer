"""Parse NSE XBRL filings: financial results and shareholding patterns.

Results come in two taxonomies with the same element names: 'in-capmkt'
(SEBI integrated filing, 2025 onward) and 'in-bse-fin' (older results).
Each filing has a quarter context, a year-to-date context and a balance
sheet date; only facts without extra dimensions are read.
"""
import xml.etree.ElementTree as ET

import pandas as pd

XBRLI = "{http://www.xbrl.org/2003/instance}"
XBRLDI = "{http://xbrl.org/2006/xbrldi}"

META = {
    "Symbol": "symbol", "ISIN": "isin", "NameOfTheCompany": "company",
    "NatureOfReportStandaloneConsolidated": "basis",
    "WhetherResultsAreAuditedOrUnaudited": "audited",
}

# Duration items: P&L for the period, and cash flow (reported year to date).
PERIOD_ITEMS = {
    "RevenueFromOperations": "revenue",
    "OtherIncome": "other_income",
    "Income": "total_income",
    "Expenses": "total_expenses",
    "CostOfMaterialsConsumed": "material_cost",
    "EmployeeBenefitExpense": "employee_cost",
    "FinanceCosts": "finance_cost",
    "DepreciationDepletionAndAmortisationExpense": "depreciation",
    "ExceptionalItemsBeforeTax": "exceptional_items",
    "ProfitBeforeTax": "profit_before_tax",
    "TaxExpense": "tax",
    "ProfitLossForPeriod": "net_profit",
    "ProfitLossForThePeriod": "net_profit",  # non-Ind AS filers
    "ProfitOrLossAttributableToOwnersOfParent": "net_profit_owners",
    "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations": "eps_basic",
    "DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations": "eps_diluted",
    "PaidUpValueOfEquityShareCapital": "paid_up_capital",
    "FaceValueOfEquityShareCapital": "face_value",
    # Banks
    "InterestEarned": "interest_earned",
    "InterestExpended": "interest_expended",
    "OperatingProfitBeforeProvisionAndContingencies": "operating_profit_before_provisions",
    "ProvisionsOtherThanTaxAndContingencies": "provisions",
    # Cash flow
    "CashFlowsFromUsedInOperatingActivities": "cash_from_operations",
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities": "capex",
    "CashFlowsFromUsedInInvestingActivities": "cash_from_investing",
    "CashFlowsFromUsedInFinancingActivities": "cash_from_financing",
    "DividendsPaidClassifiedAsFinancingActivities": "dividends_paid",
}

# Instant items: balance sheet at period end.
BALANCE_ITEMS = {
    "Equity": "total_equity",
    "EquityAttributableToOwnersOfParent": "equity_owners",
    "NonControllingInterest": "minority_interest",
    "ShareCapital": "share_capital",  # non-Ind AS filers report these two
    "ReservesAndSurplus": "reserves",
    "BorrowingsNoncurrent": "borrowings_noncurrent",
    "BorrowingsCurrent": "borrowings_current",
    "Borrowings": "borrowings",
    "CashAndCashEquivalents": "cash",
    "BankBalanceOtherThanCashAndCashEquivalents": "other_bank_balances",
    "CurrentInvestments": "current_investments",
    "Inventories": "inventories",
    "TradeReceivablesCurrent": "receivables",
    "TradePayablesCurrent": "payables",
    "PropertyPlantAndEquipment": "fixed_assets",
    "CurrentAssets": "current_assets",
    "CurrentLiabilities": "current_liabilities",
    "Assets": "total_assets",
    # Banks
    "Advances": "advances",
    "Deposits": "deposits",
    "GrossNonPerformingAssets": "gross_npa",
    "NonPerformingAssets": "net_npa",
}


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _contexts(root):
    """context id -> (start, end) for durations or (None, date) for instants.
    Contexts with dimensions (segments, line-item breakdowns) are skipped."""
    out = {}
    for c in root.iter(XBRLI + "context"):
        if c.find(f".//{XBRLDI}explicitMember") is not None or c.find(f".//{XBRLDI}typedMember") is not None:
            continue
        p = c.find(XBRLI + "period")
        if p is None:
            continue
        instant = p.findtext(XBRLI + "instant")
        if instant:
            out[c.get("id")] = (None, pd.Timestamp(instant))
        else:
            out[c.get("id")] = (pd.Timestamp(p.findtext(XBRLI + "startDate")),
                                pd.Timestamp(p.findtext(XBRLI + "endDate")))
    return out


def _number(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _financial_year_start(end):
    return pd.Timestamp(end.year if end.month >= 4 else end.year - 1, 4, 1)


def parse_results(content):
    """Two rows: 'quarter' (context OneD) and 'year_to_date' (FourD).

    Some filers give the year-to-date context the quarter's dates, so when
    the two match, the year to date is taken to start on 1 April. Balance
    sheet items (OneI) go on the year-to-date row, as does the cash flow,
    which is only reported year to date.
    """
    root = ET.fromstring(content)
    contexts = _contexts(root)
    meta, periods, balance = {}, {"OneD": {}, "FourD": {}}, {}
    for el in root:
        name, ctx = _local(el.tag), el.get("contextRef")
        if name in META and name not in meta and ctx in contexts:
            meta[META[name]] = (el.text or "").strip()
        elif name in PERIOD_ITEMS and ctx in periods:
            periods[ctx][PERIOD_ITEMS[name]] = _number(el.text)
        elif name in BALANCE_ITEMS and ctx == "OneI":
            balance[BALANCE_ITEMS[name]] = _number(el.text)
    if "total_equity" not in balance and {"share_capital", "reserves"} <= balance.keys():
        balance["total_equity"] = balance["share_capital"] + balance["reserves"]
    if "OneD" not in contexts or not (periods["OneD"] or periods["FourD"]):
        return pd.DataFrame()

    q_start, q_end = contexts["OneD"]
    y_start, y_end = contexts.get("FourD", (q_start, q_end))
    if y_start == q_start and periods["FourD"] and periods["FourD"] != periods["OneD"]:
        y_start = _financial_year_start(y_end)

    if periods["FourD"]:
        reported = [((q_start, q_end), periods["OneD"]), ((y_start, y_end), {**periods["FourD"], **balance})]
    else:
        # Half-yearly filers (SME) report a single six-month period.
        reported = [((q_start, q_end), {**periods["OneD"], **balance})]
    rows = []
    for (start, end), values in reported:
        if values:
            months = round((end - start).days / 30.4)
            rows.append({**meta, "period": "quarter" if months == 3 else "year_to_date",
                         "period_start": start, "period_end": end, "months": months, **values})
    df = pd.DataFrame(rows)
    df["basis"] = df["basis"].str.lower() if "basis" in df else None
    df["is_bank"] = "interest_earned" in df and df["interest_earned"].notna().any()
    return df


SHP_CATEGORIES = {
    "ShareholdingOfPromoterAndPromoterGroup": "promoter_pct",
    "InstitutionsForeign": "fii_pct",
    "InstitutionsDomestic": "dii_pct",
    "MutualFundsOrUTI": "mutual_fund_pct",
    "InsuranceCompanies": "insurance_pct",
    "NonInstitutions": "public_pct",
    "ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakh": "retail_pct",
}


def parse_shareholding(content):
    """Holding percentages by category, plus promoter shares pledged."""
    root = ET.fromstring(content)
    row = {}
    for el in root:
        name, ctx = _local(el.tag), el.get("contextRef") or ""
        if name == "Symbol" and "symbol" not in row:
            row["symbol"] = (el.text or "").strip()
        elif name == "ISIN" and "isin" not in row:
            row["isin"] = (el.text or "").strip()
        elif name == "DateOfReport" and "as_of" not in row:
            row["as_of"] = pd.Timestamp(el.text.strip())
        elif name == "ShareholdingAsAPercentageOfTotalNumberOfShares" and ctx.endswith("_ContextI"):
            category = ctx[: -len("_ContextI")]
            if category in SHP_CATEGORIES:
                row[SHP_CATEGORIES[category]] = _number(el.text) * 100
        elif (name == "EncumberedSharesAsAPercentageOfTotalSharesHeld"
              and ctx == "ShareholdingOfPromoterAndPromoterGroup_ContextI"):
            row["promoter_pledged_pct"] = _number(el.text) * 100
    return row
