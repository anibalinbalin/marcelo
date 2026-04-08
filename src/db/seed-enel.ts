import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { companies, fieldMappings } from "./schema";

const ENEL_MAPPINGS = [
  // Income Statement (PDF labels in Spanish IFRS)
  { sourceLabel: "Ingresos de actividades ordinarias", targetRow: 11, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Costo de actividades ordinarias", targetRow: 15, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceLabel: "Margen de contribución", targetRow: 19, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Gastos de administración", targetRow: 21, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceLabel: "Resultado operacional", targetRow: 22, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Ingresos financieros", targetRow: 24, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Costos financieros", targetRow: 25, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceLabel: "Resultado por unidades de reajuste", targetRow: 26, valueTransform: "divide_1000", validationSign: null },
  { sourceLabel: "Ganancias (pérdidas) de cambio en moneda extranjera", targetRow: 27, valueTransform: "divide_1000", validationSign: null },
  { sourceLabel: "Otras ganancias", targetRow: 29, valueTransform: "divide_1000", validationSign: null },
  { sourceLabel: "Ingreso (gasto) por impuestos a las ganancias", targetRow: 31, valueTransform: "divide_1000", validationSign: null },
  { sourceLabel: "Ganancia del periodo", targetRow: 35, valueTransform: "divide_1000", validationSign: null },
  { sourceLabel: "Ganancia (pérdida) atribuible a participaciones no controladoras", targetRow: 37, valueTransform: "divide_1000", validationSign: null },

  // Balance Sheet
  { sourceLabel: "Efectivo y equivalentes al efectivo", targetRow: 40, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Total de activos corrientes", targetRow: 42, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Total de activos", targetRow: 47, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Total de pasivos corrientes", targetRow: 51, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Total pasivos", targetRow: 56, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Participaciones no controladoras", targetRow: 58, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceLabel: "Total de patrimonio", targetRow: 60, valueTransform: "divide_1000", validationSign: "positive" },

  // Cash Flow
  { sourceLabel: "pasivos por arrendamiento", targetRow: 89, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceLabel: "Dividendos pagados", targetRow: 90, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceLabel: "Intereses pagados", targetRow: 91, valueTransform: "negate_divide_1000", validationSign: "negative" },
];

async function seedEnel() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  console.log("Seeding Enel Chile company...");
  const [company] = await db.insert(companies).values({
    name: "Enel Chile",
    ticker: "ENELCHILE",
    sourceType: "pdf",
  }).returning();
  console.log(`Created company: id=${company.id}, name=${company.name}`);

  console.log("Seeding Enel Chile field mappings...");
  const values = ENEL_MAPPINGS.map((m) => ({
    companyId: company.id,
    colMode: "quarterly_offset" as const,
    sourceSection: "ifrs_text",
    sourceLabel: m.sourceLabel,
    targetSheet: "Consolidado",
    targetRow: m.targetRow,
    targetColBase: "B",
    targetColStep: 1,
    baseQuarter: "1Q17",
    expectedCurrency: "USD",
    valueTransform: m.valueTransform,
    validationSign: m.validationSign,
  }));

  const result = await db.insert(fieldMappings).values(values).returning();
  console.log(`Seeded ${result.length} mappings for Enel Chile (company id: ${company.id})`);
}

seedEnel()
  .then(() => { console.log("Done!"); process.exit(0); })
  .catch((err) => { console.error("Failed:", err); process.exit(1); });
