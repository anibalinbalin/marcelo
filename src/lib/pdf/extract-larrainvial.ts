import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export interface Simultanea {
  folio: string;
  nemo: string;
  fechaInicial: string;
  fechaFinal: string;
  cantidad: number;
  precioInicial: number;
  principal: number;
  tasa: number;
  dias: number;
  compromiso: number;
}

export interface CashMovement {
  fecha: string;           // DD/MM/YYYY
  referencia: string;
  descripcion: string;
  cargo: number | null;    // debit (outflow), null if not a debit
  abono: number | null;    // credit (inflow), null if not a credit
  saldo: number | null;    // running balance
}

export interface TituloSimultanea {
  fecha: string;       // DD/MM/YYYY
  referencia: string;  // reference number (links to cash or financing folio)
  descripcion: string; // "Venta RV (simultanea)" | "Compra tp (simultanea)" | "Liquidacion compra tp"
  nemo: string;        // ticker symbol
  precio: number;      // trade price
  cantidad: number;    // share quantity
}

export interface LarrainVialExtraction {
  date: string;            // YYYY-MM-DD extracted from PDF (last cash movement date)
  fundName: string | null;
  financiamiento: Simultanea[];
  movCajaPesos: CashMovement[];
  movTitulosPesos: TituloSimultanea[];
  totalFinanciamiento: number | null;
}

/**
 * Extract FINANCIAMIENTO and MOVIMIENTOS DE CAJA EN PESOS from a LarrainVial
 * "Informe Provisorio Patrimonial" PDF.
 *
 * Python-only (pdfplumber). No fallback — throws if Python/pdfplumber unavailable.
 * This is an internal tool that runs locally; fail loudly rather than silently corrupt.
 */
export async function extractLarrainVial(
  pdfBuffer: Buffer
): Promise<LarrainVialExtraction> {
  const tmpPath = join(tmpdir(), `larrainvial-${randomUUID()}.pdf`);
  await writeFile(tmpPath, pdfBuffer);

  try {
    const scriptPath = join(process.cwd(), "src/lib/pdf/extract-larrainvial.py");

    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn("python3", [scriptPath, tmpPath]);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          reject(
            new Error(
              `LarrainVial extraction failed (exit ${code}): ${stderr}`
            )
          );
        } else {
          resolve(stdout);
        }
      });
      proc.on("error", (err: Error) => {
        reject(
          new Error(
            `Failed to spawn python3 for LarrainVial extraction: ${err.message}. ` +
              `Ensure pdfplumber is installed: pip3 install pdfplumber`
          )
        );
      });
    });

    return JSON.parse(result) as LarrainVialExtraction;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
