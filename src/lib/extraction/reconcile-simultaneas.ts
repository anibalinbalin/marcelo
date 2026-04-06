import type {
  Simultanea,
  CashMovement,
  LarrainVialExtraction,
} from "@/lib/pdf/extract-larrainvial";

export type TerminationType = "precancelacion" | "vencimiento";

export interface TerminatedSimultanea {
  simultanea: Simultanea;              // from day A (the terminated position)
  cashSettlement: CashMovement | null; // matching settlement cash entry from day B
  interestTotal: number;               // settlement cargo - original principal (total over life of loan)
  type: TerminationType;               // "precancelacion" = early, "vencimiento" = on original date
}

export interface CreatedSimultanea {
  simultanea: Simultanea;            // from day B (the new position)
  cashCreation: CashMovement | null; // matching "Factura venta RV (simultanea)" from day B
  commission: number;                // principal - abono (can be zero or near-zero)
}

export interface PersistentSimultanea {
  dayA: Simultanea;
  dayB: Simultanea;
  dailyAccrual: number;              // compromiso_B - compromiso_A
}

export interface ReconciliationResult {
  dateA: string;                     // ISO date from PDF, e.g. "2026-03-25"
  dateB: string;
  terminated: TerminatedSimultanea[];
  created: CreatedSimultanea[];
  persistent: PersistentSimultanea[];
  unmatched: CashMovement[];         // simultanea-related entries that couldn't be joined
  summary: {
    totalInterestPaid: number;
    totalCommissionPaid: number;
    netFinancingChange: number;       // totalFinanciamiento_B - totalFinanciamiento_A
    simultaneasTerminated: number;
    simultaneasCreated: number;
    simultaneasPersistent: number;
  };
}

// Cash movement description patterns (all in lowercase for matching)
// Early cancellation (precancelación total): "N.credito compra tp" — no ticker info
const SETTLEMENT_PATTERN = "n.credito compra tp";
// Maturity on original date (vencimiento): "Liquidacion compra tp [TICKER]" — includes ticker
const MATURITY_PATTERN = "liquidacion compra tp";
const CREATION_PATTERN = "factura venta rv (simultanea)";

/**
 * Amount-based matching tolerance in CLP.
 * Settlement amounts are within ~500 CLP of the previous day's Compromiso.
 * Creation amounts (Abono) match Principal exactly or within ~50 CLP.
 */
const AMOUNT_TOLERANCE = 5000;

/**
 * Find the best-matching cash movement for a given target amount.
 * Returns the entry with the smallest absolute difference, if within tolerance.
 */
function findByAmount(
  candidates: CashMovement[],
  targetAmount: number,
  tolerance: number = AMOUNT_TOLERANCE
): CashMovement | null {
  let best: CashMovement | null = null;
  let bestDiff = Infinity;

  for (const entry of candidates) {
    const amount = entry.cargo ?? entry.abono;
    if (amount == null) continue;
    const diff = Math.abs(amount - targetAmount);
    if (diff <= tolerance && diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }

  return best;
}

/**
 * Reconcile simultáneas between two consecutive daily LarrainVial extracts.
 *
 * Known simultánea lifecycle variants:
 * 1. Creación         → cash: "Factura venta RV (simultanea)" Abono ≈ Principal
 * 2. Precancelación   → cash: "N.credito compra tp" Cargo ≈ Compromiso (no ticker)
 * 3. Vencimiento      → cash: "Liquidacion compra tp [TICKER]" Cargo (ticker embedded)
 * 4. Precancelación parcial → NOT YET SEEN (pending future sample)
 *
 * Matching strategy:
 * - Terminated: match by ticker for maturities, by amount (±5k CLP) for early cancellations
 * - Created: "Factura venta RV (simultanea)" Abono ≈ Principal (±50k CLP)
 * - Settlement references bear no relation to folios — amount/ticker is the key
 */
export function reconcileSimultaneas(
  extractA: LarrainVialExtraction,
  extractB: LarrainVialExtraction
): ReconciliationResult {
  // Ensure A is the earlier date
  if (extractA.date > extractB.date) {
    return reconcileSimultaneas(extractB, extractA);
  }

  const dateA = extractA.date;
  const dateB = extractB.date;

  // Index by folio
  const foliosA = new Map(extractA.financiamiento.map((s) => [s.folio, s]));
  const foliosB = new Map(extractB.financiamiento.map((s) => [s.folio, s]));

  // Categorize positions
  const terminatedFolios = [...foliosA.keys()].filter((f) => !foliosB.has(f));
  const createdFolios = [...foliosB.keys()].filter((f) => !foliosA.has(f));
  const persistentFolios = [...foliosA.keys()].filter((f) => foliosB.has(f));

  // Extract simultanea-related cash movements from day B
  const transitionDate = dateB.split("-").reverse().join("/"); // YYYY-MM-DD -> DD/MM/YYYY
  const dayBMovements = extractB.movCajaPesos.filter(
    (m) => m.fecha === transitionDate
  );

  // Settlements: early cancellations ("N.credito compra tp") + maturities ("Liquidacion compra tp [TICKER]")
  const settlements = dayBMovements.filter((m) => {
    const desc = m.descripcion.toLowerCase();
    return desc.includes(SETTLEMENT_PATTERN) || desc.includes(MATURITY_PATTERN);
  });
  const creations = dayBMovements.filter((m) =>
    m.descripcion.toLowerCase().includes(CREATION_PATTERN)
  );

  const usedSettlements = new Set<CashMovement>();
  const usedCreations = new Set<CashMovement>();

  // Match terminated → settlement entries (precancelación or vencimiento)
  // Maturity entries include the ticker ("Liquidacion compra tp ANDINA-B"),
  // so prefer ticker match when available, then fall back to amount match.
  const terminated: TerminatedSimultanea[] = terminatedFolios.map((folio) => {
    const simultanea = foliosA.get(folio)!;
    const unusedSettlements = settlements.filter((s) => !usedSettlements.has(s));

    // Try ticker match first (maturity entries embed the nemo)
    const tickerMatch = unusedSettlements.find((s) => {
      const desc = s.descripcion.toLowerCase();
      return (
        desc.includes(MATURITY_PATTERN) &&
        desc.includes(simultanea.nemo.toLowerCase())
      );
    });
    const match = tickerMatch ?? findByAmount(unusedSettlements, simultanea.compromiso);
    if (match) usedSettlements.add(match);

    const settlementAmount = match?.cargo ?? null;
    const interestTotal =
      settlementAmount != null
        ? settlementAmount - simultanea.principal
        : 0;

    // Determine termination type: maturity if settled via "Liquidacion compra tp"
    const isMaturity = match
      ? match.descripcion.toLowerCase().includes(MATURITY_PATTERN)
      : false;
    const type: TerminationType = isMaturity ? "vencimiento" : "precancelacion";

    return { simultanea, cashSettlement: match, interestTotal, type };
  });

  // Match created → Factura venta RV (simultanea) entries
  const created: CreatedSimultanea[] = createdFolios.map((folio) => {
    const simultanea = foliosB.get(folio)!;
    const unusedCreations = creations.filter((c) => !usedCreations.has(c));
    const match = findByAmount(unusedCreations, simultanea.principal, 50000);
    if (match) usedCreations.add(match);

    const creationAmount = match?.abono ?? null;
    const commission =
      creationAmount != null ? simultanea.principal - creationAmount : 0;

    return { simultanea, cashCreation: match, commission };
  });

  // Persistent positions: daily interest accrual
  const persistent: PersistentSimultanea[] = persistentFolios.map((folio) => {
    const dayA = foliosA.get(folio)!;
    const dayB = foliosB.get(folio)!;
    return { dayA, dayB, dailyAccrual: dayB.compromiso - dayA.compromiso };
  });

  // Unmatched simultanea-related entries on transition date
  const unmatched = [
    ...settlements.filter((s) => !usedSettlements.has(s)),
    ...creations.filter((c) => !usedCreations.has(c)),
  ];

  // Summary
  const totalInterestPaid = terminated.reduce(
    (sum, t) => sum + Math.max(0, t.interestTotal),
    0
  );
  const totalCommissionPaid = created.reduce(
    (sum, c) => sum + Math.max(0, c.commission),
    0
  );
  const netFinancingChange =
    (extractB.totalFinanciamiento ?? 0) - (extractA.totalFinanciamiento ?? 0);

  return {
    dateA,
    dateB,
    terminated,
    created,
    persistent,
    unmatched,
    summary: {
      totalInterestPaid,
      totalCommissionPaid,
      netFinancingChange,
      simultaneasTerminated: terminated.length,
      simultaneasCreated: created.length,
      simultaneasPersistent: persistent.length,
    },
  };
}
