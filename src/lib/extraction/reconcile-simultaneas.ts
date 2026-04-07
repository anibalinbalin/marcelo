import type {
  Simultanea,
  CashMovement,
  TituloSimultanea,
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

// Titulos description patterns
const VENTA_SIMULTANEA = "venta rv (simultanea)";
const COMPRA_SIMULTANEA = "compra tp (simultanea)";
const LIQUIDACION = "liquidacion compra tp";

// Cash movement description patterns
const CASH_SETTLEMENT_PATTERN = "liquidacion compra tp";
const CASH_PRECANCELACION_PATTERN = "n.credito compra tp";
const CASH_CREATION_PATTERN = "factura venta rv (simultanea)";

/**
 * Find Titulos entries matching a description pattern.
 */
function filterTitulos(
  titulos: TituloSimultanea[],
  pattern: string
): TituloSimultanea[] {
  return titulos.filter((t) =>
    t.descripcion.toLowerCase().includes(pattern)
  );
}

/**
 * Find the paired "Venta RV (simultanea)" entry for a given "Compra tp (simultanea)" entry.
 * Pair link: same fecha + same nemo + same cantidad.
 */
function findVentaPair(
  ventas: TituloSimultanea[],
  compra: TituloSimultanea
): TituloSimultanea | null {
  return (
    ventas.find(
      (v) =>
        v.fecha === compra.fecha &&
        v.nemo === compra.nemo &&
        v.cantidad === compra.cantidad
    ) ?? null
  );
}

/**
 * Find a cash movement by its reference number.
 */
function findCashByRef(
  movements: CashMovement[],
  ref: string
): CashMovement | null {
  return movements.find((m) => m.referencia === ref) ?? null;
}

/**
 * Reconcile simultaneas between two consecutive daily LarrainVial extracts.
 *
 * Uses the Titulos section as a deterministic join table:
 * - "Compra tp (simultanea)" ref = financing folio
 * - Its paired "Venta RV (simultanea)" ref = cash movement referencia (abono)
 * - "Liquidacion compra tp" ref = cash movement referencia (cargo)
 *
 * No amount-based tolerance matching. Reference chains only.
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

  // Use Titulos from the report that contains the transition events (day B)
  const titulosB = extractB.movTitulosPesos ?? [];
  const ventasB = filterTitulos(titulosB, VENTA_SIMULTANEA);
  const comprasB = filterTitulos(titulosB, COMPRA_SIMULTANEA);
  const liquidacionesB = filterTitulos(titulosB, LIQUIDACION);

  // Also check Titulos from day A (the later-emitted report may have more entries)
  const titulosA = extractA.movTitulosPesos ?? [];
  const ventasA = filterTitulos(titulosA, VENTA_SIMULTANEA);
  const comprasA = filterTitulos(titulosA, COMPRA_SIMULTANEA);
  const liquidacionesA = filterTitulos(titulosA, LIQUIDACION);

  // Merge: use all available Titulos from both reports (dedup by referencia)
  const allVentas = dedup([...ventasB, ...ventasA]);
  const allCompras = dedup([...comprasB, ...comprasA]);
  const allLiquidaciones = dedup([...liquidacionesB, ...liquidacionesA]);

  // Cash movements from both reports (for matching)
  const allCashB = extractB.movCajaPesos;
  const allCashA = extractA.movCajaPesos;

  const usedCashRefs = new Set<string>();

  // --- Match created positions via reference chain ---
  const created: CreatedSimultanea[] = createdFolios.map((folio) => {
    const simultanea = foliosB.get(folio)!;

    // Step 1: folio = "Compra tp (simultanea)" ref in Titulos
    const compra = allCompras.find((c) => c.referencia === folio);

    // Step 2: find paired "Venta RV (simultanea)" (same date + ticker + qty)
    const venta = compra ? findVentaPair(allVentas, compra) : null;

    // Step 3: Venta ref -> cash movement referencia (abono)
    let cashCreation: CashMovement | null = null;
    if (venta) {
      cashCreation =
        findCashByRef(allCashB, venta.referencia) ??
        findCashByRef(allCashA, venta.referencia);
      if (cashCreation) usedCashRefs.add(venta.referencia);
    }

    const creationAmount = cashCreation?.abono ?? null;
    const commission =
      creationAmount != null ? simultanea.principal - creationAmount : 0;

    return { simultanea, cashCreation, commission };
  });

  // --- Match terminated positions via reference chain ---
  const terminated: TerminatedSimultanea[] = terminatedFolios.map((folio) => {
    const simultanea = foliosA.get(folio)!;

    // Find "Liquidacion compra tp" in Titulos matching the terminated position's ticker
    // For liquidations, the folio itself may be the Titulos ref (if it was the original compra)
    let liquidacion = allLiquidaciones.find((l) => l.referencia === folio);

    // If not found by folio, match by ticker + quantity
    if (!liquidacion) {
      liquidacion = allLiquidaciones.find(
        (l) =>
          l.nemo === simultanea.nemo &&
          l.cantidad === simultanea.cantidad &&
          !usedCashRefs.has(l.referencia)
      ) ?? undefined;
    }

    // Also check for precancelacion: "N.credito compra tp" in cash (no Titulos entry)
    let cashSettlement: CashMovement | null = null;
    let type: TerminationType = "precancelacion";

    if (liquidacion) {
      // Vencimiento: Liquidacion ref -> cash cargo
      cashSettlement =
        findCashByRef(allCashB, liquidacion.referencia) ??
        findCashByRef(allCashA, liquidacion.referencia);
      if (cashSettlement) usedCashRefs.add(liquidacion.referencia);
      type = "vencimiento";
    } else {
      // Precancelacion: look for "N.credito compra tp" in cash by ticker/amount
      // This is the one case without a Titulos entry - fall back to description match
      const precancelaciones = [
        ...allCashB.filter(
          (m) =>
            m.descripcion.toLowerCase().includes(CASH_PRECANCELACION_PATTERN) &&
            !usedCashRefs.has(m.referencia)
        ),
        ...allCashA.filter(
          (m) =>
            m.descripcion.toLowerCase().includes(CASH_PRECANCELACION_PATTERN) &&
            !usedCashRefs.has(m.referencia)
        ),
      ];
      // Match by closest amount to compromiso (precancelaciones don't have ticker in description)
      if (precancelaciones.length > 0) {
        let bestMatch: CashMovement | null = null;
        let bestDiff = Infinity;
        for (const entry of precancelaciones) {
          const amount = entry.cargo ?? 0;
          const diff = Math.abs(amount - simultanea.compromiso);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestMatch = entry;
          }
        }
        if (bestMatch) {
          cashSettlement = bestMatch;
          usedCashRefs.add(bestMatch.referencia);
          type = "precancelacion";
        }
      }
    }

    const settlementAmount = cashSettlement?.cargo ?? null;
    const interestTotal =
      settlementAmount != null
        ? settlementAmount - simultanea.principal
        : 0;

    return { simultanea, cashSettlement, interestTotal, type };
  });

  // Persistent positions: daily interest accrual
  const persistent: PersistentSimultanea[] = persistentFolios.map((folio) => {
    const dayA = foliosA.get(folio)!;
    const dayB = foliosB.get(folio)!;
    return { dayA, dayB, dailyAccrual: dayB.compromiso - dayA.compromiso };
  });

  // Unmatched: simultanea-related cash entries not joined via reference chain
  const simultaneaPatterns = [
    CASH_SETTLEMENT_PATTERN,
    CASH_PRECANCELACION_PATTERN,
    CASH_CREATION_PATTERN,
  ];
  const allSimultaneaCash = [
    ...allCashB.filter((m) => {
      const desc = m.descripcion.toLowerCase();
      return simultaneaPatterns.some((p) => desc.includes(p));
    }),
    ...allCashA.filter((m) => {
      const desc = m.descripcion.toLowerCase();
      return simultaneaPatterns.some((p) => desc.includes(p));
    }),
  ];
  const unmatched = dedup(
    allSimultaneaCash.filter((m) => !usedCashRefs.has(m.referencia))
  );

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

/**
 * Deduplicate entries by referencia field.
 */
function dedup<T extends { referencia: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.referencia)) return false;
    seen.add(item.referencia);
    return true;
  });
}
