# Deterministic Simultanea Reconciliation v2

**Date**: 2026-04-07
**Status**: Approved
**Problem**: LarrainVial reconciliation uses amount-based fuzzy matching (tolerances of 5K-50K CLP) to join financing positions to cash movements. This fails when commissions exceed tolerance thresholds and is fundamentally a guessing approach when the PDF already contains deterministic reference chains.

---

## Root Cause

The PDF contains 7+ data sections. We extract 2 (Financiamiento + Caja en Pesos) and ignore the rest. The "Movimientos de Titulos en Pesos" section contains paired entries that deterministically link financing folios to cash movement references - no tolerance needed.

### The Reference Chain (proven from April 2026 data)

**Creation:**
```
Titulos: "Venta RV (simultanea)"   ref=N,   ticker=X, qty=Q  --> Cash: ref=N,   abono
Titulos: "Compra tp (simultanea)"  ref=N+1, ticker=X, qty=Q  --> Financing: folio=N+1
```
Pair link: same date + same ticker + same quantity.

**Termination:**
```
Titulos: "Liquidacion compra tp"   ref=M,   ticker=X, qty=Q  --> Cash: ref=M, cargo
```
Folio M was previously in Financing but has been removed (matured/cancelled).

**Key invariant**: Financing folio IS ALWAYS the "Compra tp (simultanea)" reference. Never the "Venta RV" reference.

---

## Changes

### 1. Python Extractor (`extract-larrainvial.py`)

Add third section extraction: "MOVIMIENTOS DE TITULOS EN PESOS"

- New state machine flag: `in_titulos` (between "MOVIMIENTOS DE TITULOS EN PESOS" header and next section)
- Filter to only simultanea-related entries by matching description:
  - `"Venta RV (simultanea)"`
  - `"Compra tp (simultanea)"`
  - `"Liquidacion compra tp"`
- Skip all regular entries ("Compra RV", etc.) - hundreds of lines we don't need
- Parse columns: fecha, referencia, descripcion, nemo, precio, cantidad
- Output as `movTitulosPesos` array in JSON

Section boundary: Titulos ends at "FORWARD", "DISTRIBUCION DE CUSTODIA", or end of document.

### 2. TypeScript Types (`extract-larrainvial.ts`)

```typescript
export interface TituloSimultanea {
  fecha: string;       // DD/MM/YYYY
  referencia: string;  // reference number (links to cash or financing)
  descripcion: string; // "Venta RV (simultanea)" | "Compra tp (simultanea)" | "Liquidacion compra tp"
  nemo: string;        // ticker symbol
  precio: number;      // trade price
  cantidad: number;    // share quantity
}
```

Add to `LarrainVialExtraction`:
```typescript
movTitulosPesos: TituloSimultanea[];
```

### 3. Reconciliation Engine (`reconcile-simultaneas.ts`)

**Delete:**
- `AMOUNT_TOLERANCE` constant
- `findByAmount()` function
- All amount-based matching logic
- The 50K creation tolerance

**Replace with reference chain joins:**

#### Created positions (folio in B, not in A):
1. `folio` = the financing folio from day B
2. Find Titulos entry in B where `referencia === folio` AND description contains "Compra tp (simultanea)"
3. Find its paired "Venta RV (simultanea)" entry: same `fecha` + same `nemo` + same `cantidad`
4. Use the Venta's `referencia` to find the cash entry: `movCajaPesos.find(m => m.referencia === ventaRef)`
5. Commission = `principal - cashEntry.abono`

#### Terminated positions (folio in A, not in B):
1. Get the terminated simultanea from day A (has `nemo` and `cantidad`)
2. Find Titulos "Liquidacion compra tp" entry in B where `nemo` matches
3. Use that Liquidacion's `referencia` to find the cash entry: `movCajaPesos.find(m => m.referencia === ref)`
4. Interest = `cashEntry.cargo - simultanea.principal`

#### Persistent positions (folio in both): unchanged
- `dailyAccrual = dayB.compromiso - dayA.compromiso`

#### Fallback
If the Titulos section is empty or missing (defensive - shouldn't happen with standard LarrainVial reports), fall back to the current amount-based matching with a warning flag in the result.

### 4. No Changes Required

- `src/app/api/reconcile/route.ts` - pure orchestration, no matching logic
- `src/components/reconcile-panel.tsx` - same `ReconciliationResult` shape
- VLM/GLM-OCR pipeline - LarrainVial PDFs are programmatic, pdfplumber stays

---

## Validation

Test with the two April 2026 PDFs (Cuenta 0 abril 2027.pdf / 2028.pdf):

**Expected results:**
- 0 terminated positions (no folios disappeared between the two)
- 2 created: CCU 5744192 and CCU 5744193
  - 5744192: Venta ref=5744190, cash abono=3,009,256,234, commission=10,743,036
  - 5744193: Venta ref=5744191, cash abono=32,826,121, commission=58,594
- 9 persistent positions with daily accrual
- 0 unmatched entries

**Regression check:**
- Existing cash entries for ANDINA-B liquidation (ref 5592716) and CCU liquidation (ref 5603505) from earlier dates should NOT appear as unmatched (they're not on the transition date)

---

## Files Touched

| File | Change Type |
|---|---|
| `src/lib/pdf/extract-larrainvial.py` | Add Titulos section parsing |
| `src/lib/pdf/extract-larrainvial.ts` | Add TituloSimultanea type + interface field |
| `src/lib/extraction/reconcile-simultaneas.ts` | Replace matching engine |
