#!/usr/bin/env python3
"""diagnose.py — Diagnostic script to understand GLM-OCR extraction failures.

Imports functions from eval.py and prints exactly what each row returns vs. what's expected.
"""
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import prompt_config as cfg
from eval import (
    find_section_pages, render_page, call_glmocr, parse_html_table,
    normalize, find_best_match, apply_transform, read_excel_truth, KNOWN_MAPPINGS
)

def main():
    base_dir = Path(__file__).parent
    key = os.environ.get("MAPPINGS_KEY", "bimbo")
    company = KNOWN_MAPPINGS[key]
    mappings = company["mappings"]
    pdf_path   = (base_dir / company["pdf"]).resolve()
    excel_path = (base_dir / company["excel"]).resolve()
    target_codes = list({m["section"] for m in mappings})

    print(f"PDF: {pdf_path}")
    print(f"Excel: {excel_path}")
    print(f"Sections: {target_codes}")
    print(f"Config: DPI={cfg.DPI}, NUM_CTX={cfg.NUM_CTX}, VALUE_COL_INDEX={cfg.VALUE_COL_INDEX}, NORMALIZE_ACCENTS={cfg.NORMALIZE_ACCENTS}")
    print()

    section_pages = find_section_pages(pdf_path, target_codes)
    print("=== PAGES FOUND ===")
    for code, pages in section_pages.items():
        print(f"  {code}: pages {pages}")
    print()

    all_rows = {}
    for code, pages in section_pages.items():
        all_rows[code] = []
        print(f"=== GLM-OCR OUTPUT FOR {code} ===")
        for pnum in pages:
            img = render_page(pdf_path, pnum, cfg.DPI)
            if not img:
                print(f"  [page {pnum}] NO IMAGE")
                continue
            html = call_glmocr(img)
            rows = parse_html_table(html)
            all_rows[code].extend(rows)
            print(f"  [page {pnum}] {len(rows)} rows extracted:")
            for r in rows:
                print(f"    label={repr(r['label'][:60])}  values={r['values'][:5]}")
        print()

    truth = read_excel_truth(excel_path, company["sheet"], company["col"], mappings)

    print("=== MATCH ANALYSIS ===")
    matched = 0
    for m in mappings:
        rows = all_rows.get(m["section"], [])
        best, score = find_best_match(m["label"], rows)
        idx = cfg.VALUE_COL_INDEX
        raw = best["values"][idx] if best and len(best["values"]) > idx else (
              best["values"][0]   if best and best["values"] else None)
        transformed = apply_transform(raw, m["transform"])
        excel_val = truth.get(m["row"])
        ok = (transformed is not None and excel_val is not None and transformed == excel_val)
        if ok:
            matched += 1

        t_norm = normalize(m["label"])
        b_label = normalize(best["label"]) if best else "(no match)"
        b_raw_label = best["label"] if best else "(no match)"

        status = "OK" if ok else "FAIL"
        print(f"[{status}] {m['section']} row={m['row']}")
        print(f"  target:  {repr(m['label'])}")
        print(f"  t_norm:  {repr(t_norm)}")
        print(f"  matched: {repr(b_raw_label[:60])} (score={score})")
        print(f"  m_norm:  {repr(b_label[:60])}")
        if best:
            print(f"  values:  {best['values'][:5]}  -> idx={idx} raw={raw}")
        print(f"  transformed={transformed}  excel_truth={excel_val}")
        print()

    print(f"TOTAL: {matched}/{len(mappings)} = {matched/len(mappings):.4f}")

if __name__ == "__main__":
    main()
