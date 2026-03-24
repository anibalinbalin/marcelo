import ExcelJS from 'exceljs';

export interface CellWrite {
  sheet: string;
  row: number;
  col: number;
  value: number;
}

export interface IntegrityReport {
  sheetCountMatch: boolean;
  formulaCountMatch: Record<string, { original: number; output: number; match: boolean }>;
  writtenCellsVerified: boolean;
  errors: string[];
}

export async function writeBlueValues(
  templateBuffer: Buffer,
  valuesToWrite: CellWrite[]
): Promise<{ buffer: Buffer; integrityReport: IntegrityReport }> {
  // 1. Read the template workbook
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer as never);

  // 2. Count formulas per sheet BEFORE writing (for integrity check)
  const originalFormulaCounts: Record<string, number> = {};
  const originalSheetCount = wb.worksheets.length;
  for (const ws of wb.worksheets) {
    let count = 0;
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.formula || cell.formulaType) count++;
      });
    });
    originalFormulaCounts[ws.name] = count;
  }

  // 3. Write values to specified cells
  const writeErrors: string[] = [];
  for (const { sheet, row, col, value } of valuesToWrite) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) {
      writeErrors.push(`Sheet "${sheet}" not found`);
      continue;
    }
    const cell = ws.getCell(row, col);
    cell.value = value;
  }

  // 4. Save to buffer
  const outputBuffer = Buffer.from(await wb.xlsx.writeBuffer());

  // 5. Re-read for integrity verification
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(outputBuffer as never);

  const outputSheetCount = wb2.worksheets.length;
  const outputFormulaCounts: Record<string, number> = {};
  for (const ws of wb2.worksheets) {
    let count = 0;
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.formula || cell.formulaType) count++;
      });
    });
    outputFormulaCounts[ws.name] = count;
  }

  // 6. Verify written cells
  let allCellsVerified = true;
  for (const { sheet, row, col, value } of valuesToWrite) {
    const ws = wb2.getWorksheet(sheet);
    if (!ws) continue;
    const cell = ws.getCell(row, col);
    const cellValue = typeof cell.value === 'number' ? cell.value : null;
    if (cellValue !== value) {
      writeErrors.push(`Cell ${sheet}!R${row}C${col}: expected ${value}, got ${cellValue}`);
      allCellsVerified = false;
    }
  }

  // 7. Build integrity report
  const formulaCountMatch: Record<string, { original: number; output: number; match: boolean }> = {};
  for (const sheetName of Object.keys(originalFormulaCounts)) {
    const orig = originalFormulaCounts[sheetName];
    const out = outputFormulaCounts[sheetName] ?? 0;
    formulaCountMatch[sheetName] = { original: orig, output: out, match: orig === out };
    if (orig !== out) {
      writeErrors.push(`Formula count mismatch in "${sheetName}": ${orig} → ${out}`);
    }
  }

  return {
    buffer: outputBuffer,
    integrityReport: {
      sheetCountMatch: originalSheetCount === outputSheetCount,
      formulaCountMatch,
      writtenCellsVerified: allCellsVerified,
      errors: writeErrors,
    },
  };
}
