# Quarterly Report Auto-Populator — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js web app that extracts data from quarterly financial reports (PDF + Excel) and populates analyst Excel models automatically, with visual validation and approval.

**Architecture:** Deterministic mapping engine with thin AI layer. Source files (PDF/Excel) → extraction → per-company field mappings → validation (DuckDB) → analyst approval UI → Excel writeback (exceljs). No auth for v1 (single-tenant, trusted internal tool).

**Tech Stack:** Next.js 16, shadcn/ui, Geist, exceljs, pdfplumber (Python API), AI SDK v6, DuckDB, Neon Postgres, Vercel Blob, Vercel deployment.

**Design doc:** `~/.gstack/projects/marcelo/anibalin-unknown-design-20260324-143343.md`

**Prerequisite results (validated):**
- exceljs: PASS — reads blue cells, writes values, preserves 7,208 formulas
- pdfplumber: PASS — clean table extraction, 67% field match (matching issue, not extraction)

---

## Chunk 1: Project Scaffold + Database

### Task 1: Initialize Next.js 16 project

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: Create Next.js app with shadcn/ui**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack
```

Note: run from `/Users/anibalin/Sites/2026/marcelo`. Since files exist already (`data/`, `package.json`), move data folder aside first, scaffold, then move back.

- [ ] **Step 2: Initialize shadcn/ui**

```bash
npx shadcn@latest init
```
Choose: New York style, Zinc base color, CSS variables.

- [ ] **Step 3: Install core dependencies**

```bash
npm install exceljs duckdb-async ai @ai-sdk/react @neondatabase/serverless drizzle-orm zod
npm install -D drizzle-kit dotenv-cli @types/node
```

- [ ] **Step 4: Install shadcn components needed for v1**

```bash
npx shadcn@latest add button card table tabs badge input label select dialog dropdown-menu toast separator progress
```

- [ ] **Step 5: Set up Geist font in layout**

Edit `src/app/layout.tsx`: import `geistSans` and `geistMono` from `next/font/local`, apply to body.

- [ ] **Step 6: Commit**

```bash
git init && git add -A && git commit -m "feat: scaffold Next.js 16 + shadcn/ui + core deps"
```

---

### Task 2: Database schema with Drizzle ORM

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create Drizzle schema**

File: `src/db/schema.ts`

Define 4 tables matching the design doc SQL schema:
- `companies` — id, name, ticker, sourceType, modelTemplateBlobUrl, createdAt
- `fieldMappings` — id, companyId, colMode, sourceSection, sourceLabel, sourceRow, sourceCol, targetSheet, targetRow, targetColBase, targetColStep, baseQuarter, expectedCurrency, valueTransform, validationSign, isActive, updatedAt, createdAt
- `extractionRuns` — id, companyId, quarter, sourceFileUrl, status, extractedAt, approvedBy, approvedAt, outputFileUrl, createdAt
- `extractedValues` — id, runId, mappingId, extractedValue, confidence, validationStatus, validationMessage, analystOverride, createdAt

Use `drizzle-orm/pg-core` types: `serial`, `text`, `integer`, `boolean`, `real`, `numeric`, `timestamp`.

- [ ] **Step 2: Create DB connection with lazy init**

File: `src/db/index.ts`

Use the lazy initialization pattern from the Vercel storage skill (NOT a Proxy wrapper):
```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

function createDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql, { schema });
}

let _db: ReturnType<typeof createDb> | null = null;
export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}
```

- [ ] **Step 3: Create Drizzle config**

File: `drizzle.config.ts`
```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Set up Vercel project + Neon database**

```bash
vercel link
vercel integration add neon
vercel env pull .env.local
```

- [ ] **Step 5: Push schema to database**

```bash
npx dotenv -e .env.local -- npx drizzle-kit push
```

- [ ] **Step 6: Verify with a test query**

Create a temporary test script to verify the connection works, then remove it.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: database schema with Drizzle + Neon Postgres"
```

---

### Task 3: Seed initial company data

**Files:**
- Create: `src/db/seed.ts`

- [ ] **Step 1: Create seed script**

Insert BIMBO and CENT companies:
```ts
await db.insert(companies).values([
  { name: 'Grupo Bimbo', ticker: 'BIMBOA', sourceType: 'pdf' },
  { name: 'Grupo SBF / Centauro', ticker: 'CENT', sourceType: 'excel' },
]);
```

- [ ] **Step 2: Run seed**

```bash
npx dotenv -e .env.local -- npx tsx src/db/seed.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: seed BIMBO + CENT company data"
```

---

## Chunk 2: Core Utilities — Excel + Quarter Logic

### Task 4: Excel reading utilities (exceljs wrapper)

**Files:**
- Create: `src/lib/excel/reader.ts`
- Create: `src/lib/excel/types.ts`
- Create: `src/lib/excel/__tests__/reader.test.ts`

- [ ] **Step 1: Define types**

File: `src/lib/excel/types.ts`

```ts
export interface BlueCellInfo {
  sheet: string;
  row: number;
  col: number;
  colLetter: string;
  value: number | string | null;
  fontColor: string; // hex like "#0000FF"
}

export interface ExtractedField {
  sourceLabel: string;
  sectionCode: string | null;
  value: number | null;
  period: string; // "4Q25"
  currency: string | null;
  unit: string | null;
}

export interface FontColorInfo {
  hex: string;
  count: number;
  sampleCells: string[]; // e.g. ["PROJ!A5", "FAT!B10"]
}
```

- [ ] **Step 2: Implement reader**

File: `src/lib/excel/reader.ts`

Functions:
- `extractFontColors(buffer: Buffer): Promise<FontColorInfo[]>` — scan all cells, return distinct font colors with counts
- `extractBlueCells(buffer: Buffer, blueColorHexes: string[]): Promise<BlueCellInfo[]>` — return all cells matching the given font colors
- `readCellValue(buffer: Buffer, sheet: string, row: number, col: number): Promise<number | string | null>` — read a single cell
- `extractSourceFields(buffer: Buffer, mappings: {sheet: string, row: number, col: string}[]): Promise<ExtractedField[]>` — batch read cells by coordinates

Helper: `colLetterToNumber(letter: string): number` and `colNumberToLetter(num: number): string`

- [ ] **Step 3: Write test with real BIMBO file**

Use `data/BIMBOA 4Q25.xlsx` as test fixture. Test that:
- `extractFontColors` finds the `FF0000FF` color with 352+ cells in PROJ
- `extractBlueCells` with `['#0000FF']` returns cells with numeric values
- `colLetterToNumber('AQ')` returns 43
- `colNumberToLetter(43)` returns `'AQ'`

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/lib/excel/__tests__/reader.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Excel reader utilities with blue cell detection"
```

---

### Task 5: Quarter & column offset logic

**Files:**
- Create: `src/lib/quarter.ts`
- Create: `src/lib/quarter.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `parseQuarter("4Q25")` → `{ quarter: 4, year: 2025 }`
- `quarterToColOffset("4Q25", "1Q15")` → 43 (distance in quarters)
- `getTargetCol("B", 1, 43)` → `"AS"` (base col B = col 2, + 43 = col 45 = "AS")
- `getTargetCol("B", 1, 0)` → `"B"` (first quarter = base col)
- `formatQuarter(4, 2025)` → `"4Q25"`

- [ ] **Step 2: Implement quarter utilities**

```ts
export function parseQuarter(q: string): { quarter: number; year: number }
export function quarterToColOffset(targetQ: string, baseQ: string): number
export function getTargetCol(baseCol: string, step: number, offset: number): string
export function formatQuarter(q: number, year: number): string
```

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: quarter parsing + column offset logic"
```

---

### Task 6: Excel writer utility

**Files:**
- Create: `src/lib/excel/writer.ts`
- Create: `src/lib/excel/__tests__/writer.test.ts`

- [ ] **Step 1: Write failing test**

Test: open BIMBO model, write value 999999 to PROJ!AS5, save to buffer, re-read, verify:
- Value at AS5 = 999999
- Sheet count unchanged (10)
- Formula count in PROJ unchanged (7208)

- [ ] **Step 2: Implement writer**

```ts
export async function writeBlueValues(
  templateBuffer: Buffer,
  valuesToWrite: { sheet: string; row: number; col: number; value: number }[]
): Promise<{ buffer: Buffer; integrityReport: IntegrityReport }>
```

`IntegrityReport` includes: sheetCountMatch, formulaCountMatch (per sheet), writtenCellsVerified.

- [ ] **Step 3: Run test, verify pass**

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: Excel writer with post-write integrity check"
```

---

## Chunk 3: PDF Extraction + Source Ingestion

### Task 7: PDF table extraction via pdfplumber API route

**Files:**
- Create: `src/lib/pdf/extract.py` (Python script)
- Create: `src/lib/pdf/extract.ts` (Node.js wrapper)
- Create: `src/app/api/extract-pdf/route.ts`

- [ ] **Step 1: Create Python extraction script**

File: `src/lib/pdf/extract.py`

Accepts a PDF path and section codes via argv, outputs JSON with extracted tables:
```python
import pdfplumber, json, sys
# Find sections by page, extract tables, output normalized JSON
# { sections: [{ code: "[310000]", page: 15, rows: [{ label, values: [num...] }] }] }
```

- [ ] **Step 2: Create Node.js wrapper**

File: `src/lib/pdf/extract.ts`

```ts
export async function extractPdfTables(
  pdfBuffer: Buffer,
  sectionCodes: string[]
): Promise<PdfSection[]>
```

Writes buffer to temp file, spawns `python3 src/lib/pdf/extract.py`, parses JSON output.

- [ ] **Step 3: Create API route for PDF extraction**

File: `src/app/api/extract-pdf/route.ts`

POST route that accepts FormData with PDF file, returns extracted sections as JSON.

- [ ] **Step 4: Test with BIMBO PDF**

Verify section [310000] returns Income Statement with "Ingresos" = 426,951,694,000 (annual) and 108,688,058,000 (Q4).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: PDF extraction via pdfplumber with section detection"
```

---

### Task 8: Source extraction pipeline (orchestrator)

**Files:**
- Create: `src/lib/extraction/pipeline.ts`
- Create: `src/lib/extraction/normalize.ts`

- [ ] **Step 1: Create normalizer**

File: `src/lib/extraction/normalize.ts`

Converts raw extracted data (from PDF or Excel) into the common `ExtractedField[]` format. Handles:
- Number parsing: strip commas, handle parenthetical negatives like `(2,252,000)`
- Unit detection: values > 1B → likely in units, values < 1M → likely in thousands/millions
- Period detection: map column headers to quarter strings

- [ ] **Step 2: Create extraction pipeline**

File: `src/lib/extraction/pipeline.ts`

```ts
export async function runExtraction(
  sourceBuffer: Buffer,
  sourceType: 'pdf' | 'excel',
  company: Company,
  mappings: FieldMapping[],
  quarter: string
): Promise<ExtractedValue[]>
```

For Excel: use `exceljs` reader to extract values at mapped coordinates.
For PDF: use pdfplumber extraction, then match labels to mappings.

Both paths: apply `value_transform` (negate, divide_1000, etc.), compute confidence scores.

- [ ] **Step 3: Test with CENT Excel (deterministic path)**

Extract "Receita Líquida" from Planilha Interativa and match to CENT model's PROJ sheet.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: extraction pipeline with normalizer for PDF + Excel sources"
```

---

## Chunk 4: Server Actions + Upload Flow

### Task 9: Server Actions for CRUD operations

**Files:**
- Create: `src/app/actions/companies.ts`
- Create: `src/app/actions/mappings.ts`
- Create: `src/app/actions/runs.ts`

- [ ] **Step 1: Company actions**

```ts
'use server';
export async function getCompanies()
export async function getCompany(id: number)
export async function createCompany(data: NewCompany)
```

- [ ] **Step 2: Mapping actions**

```ts
'use server';
export async function getMappings(companyId: number)
export async function createMapping(data: NewMapping)
export async function createMappingsBulk(mappings: NewMapping[])
export async function updateMapping(id: number, data: Partial<FieldMapping>)
export async function deleteMapping(id: number)
```

- [ ] **Step 3: Run actions**

```ts
'use server';
export async function getRuns(companyId: number)
export async function createRun(companyId: number, quarter: string, sourceFileUrl: string)
export async function updateRunStatus(runId: number, status: string)
export async function getExtractedValues(runId: number)
export async function approveValues(runId: number, approvedBy: string, overrides?: {id: number, value: number}[])
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: server actions for companies, mappings, and runs"
```

---

### Task 10: File upload with Vercel Blob

**Files:**
- Create: `src/app/api/upload/route.ts`
- Create: `src/lib/upload.ts`

- [ ] **Step 1: Install Vercel Blob**

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Create upload API route**

POST handler that accepts FormData with file, uploads to Vercel Blob, returns URL.

- [ ] **Step 3: Create upload + extract action**

Combines: upload file → create extraction run → run extraction pipeline → save extracted values to DB → update run status.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: file upload to Vercel Blob + extraction trigger"
```

---

## Chunk 5: Validation Layer

### Task 11: DuckDB validation engine

**Files:**
- Create: `src/lib/validation/engine.ts`
- Create: `src/lib/validation/rules.ts`
- Create: `src/lib/validation/__tests__/engine.test.ts`

- [ ] **Step 1: Define validation rules**

File: `src/lib/validation/rules.ts`

```ts
export type ValidationResult = { status: 'pass' | 'warning' | 'fail'; message: string };

export function validateSign(value: number, expectedSign: 'positive' | 'negative' | null): ValidationResult
export function validateConfidence(confidence: number): ValidationResult
```

- [ ] **Step 2: Implement DuckDB validation engine**

File: `src/lib/validation/engine.ts`

```ts
export async function runValidation(
  extractedValues: ExtractedValue[],
  mappings: FieldMapping[]
): Promise<ExtractedValue[]>
```

Loads values into in-memory DuckDB, runs:
1. Sign checks per mapping's `validationSign`
2. Confidence threshold (flag < 0.8)
3. Totals-match queries (sum of children vs parent, where known)

Returns values with `validationStatus` and `validationMessage` populated.

- [ ] **Step 3: Write test**

Test with sample data: Revenue = 100, COGS = -60, Gross = 40 → totals match passes.
Test: Revenue = 100 but sign check expects negative → fails.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: DuckDB validation engine with sign checks + totals match"
```

---

## Chunk 6: UI — Dashboard + Upload + Review

### Task 12: Dashboard page

**Files:**
- Create: `src/app/page.tsx` (replace default)
- Create: `src/app/companies/[id]/page.tsx`
- Create: `src/components/company-card.tsx`

- [ ] **Step 1: Build dashboard**

Server Component that fetches companies + latest runs. Shows:
- Company cards with name, ticker, source type
- Latest run status badge (pending/extracted/validated/approved/written)
- "New Quarter" button per company
- Dark mode, zinc palette, Geist font

- [ ] **Step 2: Build company detail page**

Shows: company info, list of all runs (quarter, status, date), "Upload New" button.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: dashboard + company detail pages"
```

---

### Task 13: Upload flow UI

**Files:**
- Create: `src/app/companies/[id]/upload/page.tsx`
- Create: `src/components/file-dropzone.tsx`
- Create: `src/components/quarter-selector.tsx`

- [ ] **Step 1: Build file dropzone component**

Client Component with drag-and-drop. Accepts `.xlsx` and `.pdf`. Shows file name + size after drop.

- [ ] **Step 2: Build quarter selector**

Dropdown with recent quarters (4Q25, 3Q25, 2Q25, etc.) Auto-suggests the next expected quarter.

- [ ] **Step 3: Build upload page**

Combines dropzone + quarter selector + "Extract" button. On submit: calls upload action → shows progress → redirects to review page.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: upload flow with dropzone + quarter selector"
```

---

### Task 14: Extraction review / approval UI

**Files:**
- Create: `src/app/companies/[id]/runs/[runId]/page.tsx`
- Create: `src/components/review-table.tsx`
- Create: `src/components/value-cell.tsx`
- Create: `src/components/approval-bar.tsx`

- [ ] **Step 1: Build review table component**

Table with columns: Field Name, Source Section, Extracted Value, Confidence, Validation, Action.
- Rows color-coded: green/yellow/red based on validation status
- Inline edit for values (click to edit, enter to save)
- Checkbox per row for selective approval

- [ ] **Step 2: Build approval bar**

Sticky bottom bar with:
- "Approve All Passing" button (approves all green items)
- Count of pending / approved / flagged items
- "Download Excel" button (enabled only after approval)

- [ ] **Step 3: Build review page**

Tabs for each target sheet (PROJ, FAT, RESUMO, etc.)
Default view: flagged items only. Toggle: "Show all".
Server Component fetches run + extracted values + mappings. Client components handle interactions.

- [ ] **Step 4: Wire up approval action**

On "Approve": calls `approveValues` server action → updates run status → enables download.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: extraction review + approval UI with sheet tabs"
```

---

## Chunk 7: Excel Writeback + Download

### Task 15: Writeback pipeline + download route

**Files:**
- Create: `src/app/api/download/[runId]/route.ts`
- Create: `src/lib/writeback.ts`

- [ ] **Step 1: Implement writeback orchestrator**

File: `src/lib/writeback.ts`

```ts
export async function generatePopulatedExcel(
  runId: number
): Promise<{ buffer: Buffer; filename: string; integrityReport: IntegrityReport }>
```

1. Fetch run + company + approved values + mappings from DB
2. Download model template from Vercel Blob
3. For each approved value: compute target column using `getTargetCol()` + `quarterToColOffset()`
4. Call `writeBlueValues()` with all values
5. Verify integrity report — abort if checks fail
6. Upload output to Vercel Blob, update run with `outputFileUrl`
7. Return buffer for immediate download

- [ ] **Step 2: Create download API route**

GET route that fetches the output file from Vercel Blob and streams it as a download with correct filename and content-type headers.

- [ ] **Step 3: Test end-to-end with BIMBO**

Manual test: seed a few mappings for BIMBO PROJ rows 5, 7, 9 (Revenue, COGS, Gross). Upload the BIVA PDF. Verify extracted values appear in review UI. Approve. Download. Open in Excel and verify the values are in the correct cells.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: Excel writeback + download with integrity check"
```

---

## Chunk 8: Mapping Editor

### Task 16: Bulk CSV mapping import

**Files:**
- Create: `src/app/companies/[id]/mappings/page.tsx`
- Create: `src/app/companies/[id]/mappings/import/page.tsx`
- Create: `src/lib/mappings/csv-parser.ts`

- [ ] **Step 1: Create CSV parser**

Parses CSV with headers: `source_section, source_label, target_sheet, target_row, target_col_base, base_quarter, col_mode, value_transform, validation_sign, expected_currency`

Returns `NewMapping[]` array ready for bulk insert.

- [ ] **Step 2: Build import page**

Upload CSV → preview parsed mappings in a table → "Import All" button → calls `createMappingsBulk`.

- [ ] **Step 3: Build mappings list page**

Table of all mappings for a company. Columns: source label, target sheet, target row, target col, transform, status. Edit/delete per row.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: mapping editor with bulk CSV import"
```

---

### Task 17: Auto-suggest mappings

**Files:**
- Create: `src/lib/mappings/auto-suggest.ts`
- Create: `src/app/companies/[id]/mappings/auto-suggest/page.tsx`

- [ ] **Step 1: Implement fuzzy matching**

```ts
export function suggestMappings(
  sourceFields: { label: string; section: string }[],
  blueCells: { sheet: string; row: number; rowLabel: string }[]
): SuggestedMapping[]
```

Uses normalized string comparison (lowercase, strip accents, strip parentheses) to match source labels to blue cell row labels. Returns matches with confidence score.

- [ ] **Step 2: Build auto-suggest page**

Upload both source file + model template. System extracts source fields and blue cells. Shows suggested mappings in a table. Analyst confirms/rejects each with one click. "Accept All" button for high-confidence matches.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: auto-suggest mappings via fuzzy label matching"
```

---

## Chunk 9: Color Confirmation + Model Template Upload

### Task 18: Model template upload with color picker

**Files:**
- Create: `src/app/companies/[id]/template/page.tsx`
- Create: `src/components/color-picker.tsx`

- [ ] **Step 1: Build color picker component**

Shows color swatches found in the uploaded Excel with cell counts. Analyst clicks to toggle which colors = "manual input." Selected colors are saved to the company record.

- [ ] **Step 2: Build template upload page**

1. Upload Excel model template → save to Vercel Blob
2. Scan font colors → show color picker
3. Analyst selects blue color(s) → system identifies all blue cells
4. Show summary: "Found 2,400 manual input cells across 6 sheets"
5. Save template URL + selected colors to company record

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: model template upload with font color picker"
```

---

## Chunk 10: Polish + Deploy

### Task 19: Error handling + edge cases

**Files:**
- Modify: Various files for error states

- [ ] **Step 1: Add error boundaries**

Add `error.tsx` and `loading.tsx` to key route segments.

- [ ] **Step 2: Handle extraction errors**

If extraction fails: set run status to 'error', show error message in UI, offer re-upload.

- [ ] **Step 3: Handle partial extraction**

Show missing fields as "not extracted" in review UI. Allow manual value entry.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: error handling + loading states"
```

---

### Task 20: Deploy to Vercel

**Files:**
- Create: `.env.example`
- Create: `.gitignore` updates

- [ ] **Step 1: Ensure .env.local is gitignored**

- [ ] **Step 2: Create .env.example**

```
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
```

- [ ] **Step 3: Deploy**

```bash
vercel deploy
```

Verify: dashboard loads, can upload a file, extraction runs, review works, download produces valid Excel.

- [ ] **Step 4: Deploy to production**

```bash
vercel --prod
```

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A && git commit -m "feat: production deployment"
```

---

## Execution Order Summary

| Chunk | Tasks | What it produces |
|-------|-------|-----------------|
| 1: Scaffold + DB | 1-3 | Working Next.js app with database |
| 2: Core Utils | 4-6 | Excel R/W + quarter logic (tested) |
| 3: Extraction | 7-8 | PDF + Excel extraction pipeline |
| 4: Server Actions + Upload | 9-10 | API layer + file upload flow |
| 5: Validation | 11 | DuckDB validation engine |
| 6: UI | 12-14 | Dashboard + upload + review/approval |
| 7: Writeback | 15 | Excel output + download |
| 8: Mapping Editor | 16-17 | CSV import + auto-suggest |
| 9: Color Picker | 18 | Template upload + blue cell detection |
| 10: Polish + Deploy | 19-20 | Error handling + production deploy |

**Estimated time with Claude Code: ~4-6 hours total.**
