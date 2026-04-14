# validation_sign worklist — 2026-04-14

After populating the 16 safe-positive CENT balance-sheet / gross-revenue rows,
30 mappings across 7 companies still have `validation_sign = NULL`. These are
all **signed or ambiguous** by design — net income can be negative in loss
years, financial results swing both ways, derivative mark-to-market is truly
signed. They need analyst judgment, not automation.

This doc is a worklist. When Camila (or the next analyst) has time, go
through each row, decide if there's a constraint ("this row must be X"),
and populate `validation_sign` via:

```sql
UPDATE field_mappings SET validation_sign = 'positive'|'negative'
WHERE id = <row_id>;
```

Each line below has `id / label / recommendation / note`.

---

## Banregio Grupo Financiero (1)

- **97** · `Instrumentos Financieros Derivados` · **leave signed** · Mark-to-market value, can be net asset or net liability.

## Enel Chile (5)

- **56** · `Resultado por unidades de reajuste` · **leave signed** · Inflation indexation gain/loss.
- **57** · `Ganancias (pérdidas) de cambio en moneda extranjera` · **leave signed** · FX gain/loss.
- **59** · `Ingreso (gasto) por impuestos a las ganancias` · **leave signed** · Tax can be expense (negative) or income (deferred tax recovery).
- **60** · `Ganancia (pérdida) atribuible a participaciones no controladoras` · **leave signed** · Minority interest share of net income; can be loss.
- **168** · `Ganancia del periodo` · **leave signed** · Net income for period; can be loss.

## Grupo Bimbo (4)

- **8** · `Utilidad (pérdida) antes de impuestos` · **leave signed** · Pre-tax income; can be loss.
- **10** · `Utilidad (pérdida) neta` · **leave signed** · Net income; can be loss.
- **11** · `Utilidad (pérdida) atribuible a la participación no controladora` · **leave signed** · Minority interest; can be loss.
- **65** · `Participación en la utilidad (pérdida) de asociadas y negocios conjuntos` · **leave signed** · Equity method income; can be loss.

## Grupo SBF / Centauro (10)

- **135** · `Other operating income, net (ex-IFRS16)` · **leave signed** · Net of income and expense lines; ambiguous.
- **136** · `Income before financial result (ex-IFRS16)` · **leave signed** · Operating income; can be loss.
- **137** · `Financial result (ex-IFRS16)` · **leave signed** · Financial income minus financial expenses; usually negative for CENT but not by contract.
- **138** · `Financial Income (Expenses), net` · **leave signed** · Same as above, alt label.
- **140** · `Income before income taxes (ex-IFRS16)` · **leave signed** · Pre-tax income; can be loss.
- **141** · `Income tax and social contribution (ex-IFRS16)` · **leave signed** · Tax; sign depends on company storage convention (BRL companies often store as negative).
- **142** · `Net income for period (ex-IFRS16)` · **leave signed** · Can be loss.
- **149** · `Deferred income and social contribution` · **leave signed** · DTA/DTL, can be either side of balance sheet.
- **150** · `Investments` · **leave null (not "positive")** · Legitimately 0 for CENT. If marked positive, the basic validator's zero-value warning would fire on clean runs (undoes the e696394 fix).
- **161** · `Shareholders' equity` · **leave signed** · Technically can be negative for insolvent companies. CENT is healthy, so effectively positive, but safer to leave null.

## Kimberly-Clark de México (2)

- **70** · `Otros ingresos` · **leave signed** · "Other income" is often net of income and expense lines.
- **74** · `Utilidad (pérdida) atribuible a la participación no controladora` · **leave signed** · Minority interest; can be loss.

## Lojas Renner (3)

- **108** · `Other Operating Income` · **leave signed** · Often net of income/expense, and Brazilian GAAP companies sometimes store this with inverted sign.
- **203** · `Equity Pick-ups` · **leave signed** · Equity method income; can be loss.
- **204** · `Equity Pick-ups` · **leave signed** · Duplicate mapping for another target cell; same logic.

## Natura &Co (5)

- **120** · `Other expenses  revenues` · **leave signed** · Net of expenses and revenues, stored as signed.
- **121** · `Net financials` · **leave signed** · Net financial result.
- **125** · `Tax expenses` · **leave signed** · Sign depends on storage convention.
- **126** · `Discontinued operations` · **leave signed** · Discontinued ops P&L contribution; can be either.
- **127** · `Net income` · **leave signed** · Can be loss.

---

## Summary

- **30 mappings remain null by design.** They are either truly signed
  (financial results, net of income/expense) or can swing sign in loss
  years (net income, operating income, income before tax, minority
  interest).

- **The right fix for signed rows is not validation_sign.** It's either:
  1. Adding a constraint that enforces the arithmetic relationship
     (e.g., `Net income = Operating income - Tax - Interest`), which
     catches sign flips via violation rather than sign check.
  2. Adding a company-aware sign heuristic that knows CENT has been
     profitable for N years and therefore a negative net income
     warrants review. Bigger scope.

- **No more blanket sign updates are safe without per-row analyst
  review.** Further `validation_sign` population should come from
  Camila confirming each row one at a time in the review UI.

## What was populated in 2026-04-14

Script: `scripts/seed-validation-sign-cent.ts`

16 CENT rows set to `validation_sign = 'positive'`:

| id | label |
|---|---|
| 128 | Gross revenue |
| 143 | Cash and cash equivalents |
| 144 | Contas a receber |
| 145 | Inventory |
| 146 | Recoverable taxes |
| 148 | Long-term receivables |
| 151 | Property and equipment |
| 152 | Intangible |
| 153 | Total assets |
| 154 | Suppliers |
| 156 | Tax liabilities |
| 157 | Tax installment payment |
| 158 | Dividends payable |
| 159 | Tax installment |
| 160 | Provisions |
| 162 | Total liabilities and shareholders' equity |

And 1 row populated earlier in the same session (`fix-cent-net-revenue-sign.ts`):

| 129 | Net revenue |

Total sign-seeded: 17 CENT rows. Remaining null across corpus: 30.
