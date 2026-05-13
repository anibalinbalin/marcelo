export const SOURCE_GUARD_FAILED = "source_guard_failed";

export interface SourceGuardValue {
  id: number;
  sourceLabel: string;
  sourceSection: string | null;
  extractedValue: string | null;
}

export interface SourceGuardFailure {
  valueId: number | null;
  sourceLabel: string;
  message: string;
}

const BIMBO_COMPANY_ID = 1;
const BIMBO_PRESS_RELEASE_METRICS = [
  "Ventas Netas",
  "Utilidad Bruta",
  "Utilidad de Operación",
  "UAFIDA Ajustada",
];
const BIMBO_PRESS_RELEASE_REGIONS = [
  "Norteamérica",
  "México",
  "EAA",
  "Latinoamérica",
];

function parseValue(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

export function runSourceGuards(
  companyId: number,
  values: SourceGuardValue[],
): SourceGuardFailure[] {
  if (companyId !== BIMBO_COMPANY_ID) return [];

  const pressValues = values.filter((value) => value.sourceSection === "press_release");
  const byLabel = new Map(pressValues.map((value) => [value.sourceLabel, value]));
  const failures: SourceGuardFailure[] = [];

  for (const metric of BIMBO_PRESS_RELEASE_METRICS) {
    for (const region of BIMBO_PRESS_RELEASE_REGIONS) {
      const sourceLabel = `${metric}|${region}`;
      if (!byLabel.has(sourceLabel)) {
        failures.push({
          valueId: null,
          sourceLabel,
          message: `Source guard failed: missing required BIMBO press-release value "${sourceLabel}"`,
        });
      }
    }
  }

  for (const region of BIMBO_PRESS_RELEASE_REGIONS) {
    const gross = byLabel.get(`Utilidad Bruta|${region}`);
    const operating = byLabel.get(`Utilidad de Operación|${region}`);
    if (!gross || !operating) continue;

    const grossValue = parseValue(gross.extractedValue);
    const operatingValue = parseValue(operating.extractedValue);
    if (grossValue === null || operatingValue === null) continue;

    if (closeEnough(grossValue, operatingValue)) {
      failures.push({
        valueId: gross.id,
        sourceLabel: gross.sourceLabel,
        message:
          `Source guard failed: ${gross.sourceLabel} equals ` +
          `${operating.sourceLabel} (${grossValue}). This usually means the ` +
          "press-release parser crossed into the operating-profit table.",
      });
    }
  }

  return failures;
}

