# Extraction Autoresearch

You are running autonomous experiments to optimize VLM-based financial table extraction.
Each experiment takes ~60-120 seconds. Run as many as you can.

## What you are optimizing

A GLM-OCR vision model reads pages from BIVA quarterly PDF filings (Mexican stock exchange)
and extracts financial table values into HTML. We then parse those HTML tables, fuzzy-match
Spanish row labels, apply numeric transforms (divide by 1M, negate), and compare against an
Excel ground truth.

**Metric:** `score = matched / total` (float, 0.0 - 1.0, higher is better)

## What you may edit

**Only `prompt_config.py`.** Do not touch `eval.py`.

The knobs available to you (see prompt_config.py for docs):
- `VLM_PROMPT` — the text prompt sent to GLM-OCR alongside each page image
- `DPI` — render resolution for PDF -> PNG (range: 150-300)
- `NUM_CTX` — model context window (range: 4096-16384)
- `TEMPERATURE` — 0 is always fine; ignore unless you have a reason
- `VALUE_COL_INDEX` — which column index (0-based) holds the target quarter value
- `MATCH_THRESHOLD` — minimum fuzzy match score to accept (0 = accept any best match)
- `NORMALIZE_ACCENTS` — strip accented characters before label matching

## How to run an experiment

```bash
cd scripts/autoresearch
python3 eval.py
```

This outputs one JSON line and appends it to `log.jsonl`.

## Protocol

1. Read `log.jsonl` to understand what has been tried.
2. Form a hypothesis about what to change and why.
3. Edit `prompt_config.py`.
4. Run `python3 eval.py`.
5. Record what happened (score delta, hypothesis, outcome) in your notes.
6. Repeat.

## Company status — all 7 at 1.0

| Company    | Score | Matched | Method           | Notes |
|------------|-------|---------|------------------|-------|
| BIMBO      | 1.0   | 9/9     | GLM-OCR          | BIVA filing, IS only (BS excluded — standalone vs consolidated) |
| KIMBER     | 1.0   | 12/12   | GLM-OCR          | BIVA filing, IS only |
| BANREGIO   | 1.0   | 6/6     | GLM-OCR          | Image-based PDF, explicit pages + crop, IS only |
| ENEL Chile | 1.0   | 10/10   | pdfplumber       | Text-based IFRS PDF, positional extraction, IS only, 1.3s |
| CENT       | 1.0   | 6/6     | Excel-to-Excel   | Planilha Interativa DRE; IFRS16 rows excluded (src=ex-IFRS16, tgt=with-IFRS16) |
| LREN3      | 1.0   | 17/17   | Excel-to-Excel   | IS + BS; 3 rows excluded (label collision in source sheet) |
| NATURA     | 1.0   | 13/13   | Excel-to-Excel   | tolerance=2 for FAT formula rounding; 1 row excluded (aggregated in PROJ) |

## Starting point (BIMBO baseline)

The winning prompt for GLM-OCR companies:
- `VLM_PROMPT = "Table Recognition. Do not abbreviate row labels. Preserve all text exactly as written in the document."`
- `DPI = 150`, `NUM_CTX = 8192`, `TEMPERATURE = 0`, `VALUE_COL_INDEX = 2`

For text-based PDFs (like ENEL), extraction uses pdfplumber positional word detection
instead of GLM-OCR — see `extract_pdfplumber_q3_rows()` in eval.py. This is ~50x faster
and avoids OCR errors entirely.

If you're starting on a new company, you may not have a baseline.
Treat anything above 0.90 as a strong result and keep iterating toward 1.0.

## Hypotheses worth exploring (in rough priority order)

1. **Prompt variants** — Does adding context improve label extraction?
   - `"Extract all financial table rows with their numeric values:"` 
   - `"Financial Statement Table Recognition. Return all rows with Spanish labels and numeric columns."`
   - `"Reconocimiento de tabla financiera:"` (Spanish prompt - the PDF is in Spanish)
2. **DPI** — 300 DPI may recover values from dense tables; 150 DPI is 1.8x faster
3. **NUM_CTX** — If long tables are being truncated, increase to 12288 or 16384
4. **VALUE_COL_INDEX** — Different companies lay out columns differently (some show Q vs annual, some TTM)
5. **MATCH_THRESHOLD = 70** — Discard weak matches to avoid false positives
6. **NORMALIZE_ACCENTS = True** — May help if GLM-OCR strips accents inconsistently

## Rules

- Never claim success without running `eval.py` and reading the JSON output.
- If a change drops the score, revert it before trying the next hypothesis.
- Always keep the previous best config recoverable (either by reverting or noting it in your log).
- If you hit 1.0 on BIMBO, switch to a new company by setting `MAPPINGS_KEY` in your env and adding its mappings to `eval.py`'s KNOWN_MAPPINGS dict.

## Adding a new company

**Step 1: Identify the PDF type.**
- BIVA filings (Mexican exchange): text-embedded, section codes like [310000], [210000].
  Use `find_section_pages()` auto-discovery. No explicit pages needed.
- Image-based PDFs (e.g. BANREGIO): no text layer. Must specify explicit page numbers and
  possibly crop tuples. Use `value_col_index` to select the right quarter column.
- Text-based IFRS PDFs (e.g. ENEL Chile): pdfplumber can extract text directly.
  Set `"use_pdfplumber": True` and `"value_col_index": 0`. Use `extract_pdfplumber_q3_rows()`.
  Verify column x-positions match your PDF by running the pdfplumber header analysis.

**Step 2: Find column in Excel template.**
Open the Excel template, find the target quarter column (col letter → number via openpyxl).

**Step 3: Identify matchable rows.**
Check which PDF labels correspond to which Excel rows. Exclude rows where:
- Excel contains a different aggregation entity than the PDF
- The PDF line is a sub-component of an Excel aggregated line
- The value is 0 for this company (trivial pass, no extraction value)

**Step 4: Add to KNOWN_MAPPINGS and run.**
```bash
MAPPINGS_KEY=newcompany python3 eval.py
```

**Step 5: Iterate** on `prompt_config.py` for GLM-OCR companies, or adjust labels/rows for
pdfplumber companies.

## Compute notes

- GLM-OCR runs via Ollama (OLLAMA_URL env var, default localhost:11434)
- On H100: ~15s per page. On the Proxmox CT (NVIDIA T4): ~30-45s per page
- BIMBO has 4 pages to extract -> ~60-180s per experiment
- Realistic throughput: 20-50 experiments overnight
