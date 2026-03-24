# Report Populator — Handoff for Next Session

## What This Is

A Next.js web app that auto-populates equity research Excel models from quarterly financial reports (BIVA PDFs + company Excels). Built for Marcelo's team.

## Current State: ~80% Complete

### What's DONE and working:

1. **Next.js 16 scaffold** — shadcn/ui (17 components), dark mode, Geist fonts
2. **Neon Postgres** — connected and seeded (2 companies: BIMBO id=1, CENT id=2)
3. **DB schema** — 4 tables via Drizzle ORM: companies, fieldMappings, extractionRuns, extractedValues
4. **Core utilities**:
   - `src/lib/excel/reader.ts` — blue cell detection, font color extraction, cell reading
   - `src/lib/excel/writer.ts` — writes blue cells with post-write integrity check
   - `src/lib/quarter.ts` — quarter parsing, column offset calculation
   - `src/lib/pdf/extract.py` + `extract.ts` — pdfplumber table extraction with section detection
   - `src/lib/validation/engine.ts` — sign checks + confidence thresholds
   - `src/lib/writeback.ts` — full writeback orchestrator (approved values → populated Excel)
5. **Server Actions** — CRUD for companies, mappings, runs (`src/app/actions/`)
6. **UI pages**:
   - Dashboard (`/`) — company cards from DB
   - Company detail (`/companies/[id]`) — run history table
   - Upload (`/companies/[id]/upload`) — file dropzone + quarter selector
   - Review (`/companies/[id]/runs/[runId]`) — sheet tabs, validation, approval bar
7. **API routes**:
   - `POST /api/upload` — uploads to Vercel Blob, creates extraction run
   - `GET /api/download/[runId]` — generates + streams populated Excel
8. **Benchmark**: 100% accuracy — PDF extraction matches analyst's manually-typed values exactly

### What's LEFT (30 min of work):

1. **Seed the field mappings** — run `npx dotenv -e .env.local -- npx tsx src/db/seed-mappings.ts`
2. **Wire extraction into upload flow** — after file upload, trigger the extraction pipeline:
   - In `/api/upload/route.ts`: after creating the run, call the extraction pipeline
   - Pipeline reads source file → extracts via pdfplumber or exceljs → applies mappings → validates → saves to `extracted_values`
   - Update run status to "extracted"
3. **Wire approval → writeback** — after analyst approves, generate the populated Excel and store in Vercel Blob
4. **Deploy to Vercel** — `vercel link` + `vercel --prod`
5. **Optional**: Mapping editor UI, template upload with color picker, CSV mapping import

## Key Architecture Decisions

- **Deterministic mapping engine** with thin AI layer (not an "AI analyst")
- **exceljs** for Excel R/W (Node.js native, preserves formulas — verified with 7,208 formulas)
- **pdfplumber** (Python subprocess) for PDF table extraction
- **Scale conversion**: BIVA PDF values in full units ÷ 1,000,000 = model values in millions
- **Bilingual mapping**: BIVA Spanish labels → model English labels (e.g., "Ingresos" → Revenues row 5)
- **No auth v1** — single-tenant trusted internal tool

## File Structure

```
src/
├── app/
│   ├── page.tsx                          # Dashboard
│   ├── layout.tsx                        # Root layout (dark mode, Geist)
│   ├── actions/
│   │   ├── companies.ts                  # Company CRUD
│   │   ├── mappings.ts                   # Mapping CRUD + bulk insert
│   │   └── runs.ts                       # Run CRUD + approval
│   ├── api/
│   │   ├── upload/route.ts               # File upload to Vercel Blob
│   │   └── download/[runId]/route.ts     # Download populated Excel
│   └── companies/[id]/
│       ├── page.tsx                      # Company detail
│       ├── upload/page.tsx               # Upload flow
│       └── runs/[runId]/
│           ├── page.tsx                  # Review (server)
│           └── review-client.tsx         # Review (client)
├── components/
│   ├── approval-bar.tsx
│   ├── file-dropzone.tsx
│   ├── quarter-selector.tsx
│   ├── review-table.tsx
│   ├── status-badge.tsx
│   └── ui/                              # 17 shadcn components
├── db/
│   ├── schema.ts                        # Drizzle schema (4 tables)
│   ├── index.ts                         # Lazy DB connection
│   ├── seed.ts                          # Company seed (already run)
│   └── seed-mappings.ts                 # BIMBO mapping seed (NOT YET RUN)
└── lib/
    ├── excel/
    │   ├── reader.ts                    # Blue cell detection, cell reading
    │   ├── writer.ts                    # Write values + integrity check
    │   └── types.ts                     # Shared types
    ├── pdf/
    │   ├── extract.py                   # pdfplumber Python script
    │   └── extract.ts                   # Node.js wrapper
    ├── quarter.ts                       # Quarter parsing + column offset
    ├── validation/engine.ts             # Sign checks + confidence
    ├── writeback.ts                     # Writeback orchestrator
    └── utils.ts                         # cn() utility
```

## Environment

- `.env.local` has `DATABASE_URL` for Neon Postgres
- Need `BLOB_READ_WRITE_TOKEN` for Vercel Blob (get via `vercel env pull`)
- Need Vercel project linked for deployment (`vercel link`)

## Test Data

- `data/BIMBOA 4Q25.xlsx` — analyst's filled model (ground truth)
- `data/CENT 4Q25.xlsx` — Centauro model
- `data/Planilha Interativa 4T25.xlsx` — Centauro source (company-published)
- `data/ReporteTrimestral_BIMBO_2025_4_*.pdf` — BIMBO BIVA filing (source)

## Design Doc

`~/.gstack/projects/marcelo/anibalin-unknown-design-20260324-143343.md`
