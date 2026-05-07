export type WorkbookFontColor = {
  argb?: string | null;
  rgb?: string | null;
  theme?: number | null;
  tint?: number | null;
};

export function isFormulaLikeCellValue(
  value: unknown,
): value is { formula?: string; sharedFormula?: string } {
  return typeof value === "object" && value !== null &&
    ("formula" in value || "sharedFormula" in value);
}

export function isBlackFormulaFontColor(color: WorkbookFontColor | undefined): boolean {
  if (!color) return false;
  if (color.theme !== undefined && color.theme !== null) {
    return color.theme === 0 && (color.tint === undefined || color.tint === null || color.tint === 0);
  }
  const rgb = color.argb ?? color.rgb ?? null;
  if (!rgb) return false;
  const normalized = rgb.toUpperCase();
  return normalized === "FF000000" || normalized === "000000" || normalized === "FF000001";
}
