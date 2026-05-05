#!/usr/bin/env python3
"""Extract tables from BIVA quarterly PDF filings.

Usage: python3 extract.py <pdf_path> [section_codes...]
Output: JSON to stdout

If no section codes given, extracts all known financial sections.
"""
import pdfplumber
import json
import sys

KNOWN_SECTIONS = ["[210000]", "[310000]", "[410000]", "[520000]", "[610000]", "[700000]", "[700002]", "[800001]", "[800005]", "[800100]", "[800200]"]

def find_sections(pdf):
    """Find which pages contain each section code, including continuation pages.

    BIVA sections can span multiple pages (e.g., balance sheet assets on page 13,
    liabilities/equity on page 14). Continuation pages have a table with the same
    column count but don't repeat the section code. We include them by scanning
    forward from each tagged page until we hit another section code or a page
    with no matching table.
    """
    # First pass: find pages that explicitly contain section codes
    page_sections = {}  # page_idx -> set of codes on that page
    all_tagged_pages = set()
    for i, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        for code in KNOWN_SECTIONS:
            if code in text:
                page_sections.setdefault(i, set()).add(code)
                all_tagged_pages.add(i)

    # Second pass: for each section, scan forward to find continuation pages
    section_pages = {}
    for page_idx, codes in sorted(page_sections.items()):
        for code in codes:
            if code not in section_pages:
                section_pages[code] = []
            if page_idx not in section_pages[code]:
                section_pages[code].append(page_idx)

            # Get column count from the tagged page's table
            tables = pdf.pages[page_idx].extract_tables()
            if not tables:
                continue
            ref_col_count = len(max(tables, key=lambda t: len(t))[0]) if tables else 0

            # Scan forward for continuation pages
            for next_idx in range(page_idx + 1, len(pdf.pages)):
                if next_idx in all_tagged_pages:
                    break  # hit another section's page
                if next_idx in section_pages.get(code, []):
                    break  # already included

                next_tables = pdf.pages[next_idx].extract_tables()
                if not next_tables:
                    break  # no table = end of section

                next_col_count = len(max(next_tables, key=lambda t: len(t))[0])
                if next_col_count != ref_col_count:
                    break  # different table structure = different section

                # This is a continuation page
                section_pages[code].append(next_idx)

    return section_pages

def parse_number(s):
    """Parse a number string, handling commas, parenthetical negatives, etc."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None

    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative = True
        s = s[1:-1]
    if s.startswith("-"):
        negative = True
        s = s[1:]

    s = s.replace(",", "").replace(" ", "")

    try:
        val = float(s)
        return -val if negative else val
    except ValueError:
        return None

def extract_table_from_page(page):
    """Extract the main table from a page."""
    tables = page.extract_tables()
    if not tables:
        return None

    # Use the largest table on the page
    table = max(tables, key=lambda t: len(t))

    rows = []
    for row in table:
        if not row or not any(row):
            continue

        label = str(row[0]).strip() if row[0] else ""
        # Skip header/synopsis rows
        if not label or "[sinopsis]" in label.lower() or label.startswith("Concepto"):
            continue

        values = []
        for cell in row[1:]:
            values.append(parse_number(str(cell) if cell else ""))

        if label and any(v is not None for v in values):
            rows.append({"label": label, "values": values})

    return rows

def extract_sections(pdf_path, section_codes=None):
    """Main extraction function."""
    with pdfplumber.open(pdf_path) as pdf:
        section_pages = find_sections(pdf)

        if section_codes:
            section_pages = {k: v for k, v in section_pages.items() if k in section_codes}

        results = []
        for code, pages in section_pages.items():
            section_data = {
                "code": code,
                "pages": [p + 1 for p in pages],  # 1-indexed
                "tables": []
            }

            for page_idx in pages:
                # Skip page 0 (table of contents usually)
                if page_idx == 0:
                    continue

                page = pdf.pages[page_idx]

                # Get column headers from the table
                tables = page.extract_tables()
                headers = []
                if tables:
                    largest = max(tables, key=lambda t: len(t))
                    if largest and largest[0]:
                        headers = [str(h).strip() if h else "" for h in largest[0]]

                rows = extract_table_from_page(page)
                if rows:
                    section_data["tables"].append({
                        "page": page_idx + 1,
                        "headers": headers,
                        "rows": rows
                    })

            results.append(section_data)

        return results

PRESS_RELEASE_TABLES = {
    "Ventas Netas": ["Ventas Netas"],
    "Utilidad Bruta": ["Utilidad Bruta"],
    "Utilidad de Operación": ["Utilidad de Operación", "Utilidad de Operacion"],
    "UAFIDA Ajustada": ["UAFIDA Ajustada", "UAFIDA Aj"],
}

PRESS_RELEASE_REGIONS = ["Norteamérica", "México", "EAA", "Latinoamérica", "Grupo Bimbo"]

def extract_press_release(pdf_path):
    """Extract regional breakdown tables from BIVA press release section [105000].

    Returns a PdfSection-compatible structure with code "press_release" where each
    row label is "TableName|Region" (e.g., "Ventas Netas|México") and values[0]
    is the quarterly value (already in millions MXN).

    Tables have two header formats:
      - ['Ventas Netas', '4T25', ...] — title in cell[0], data rows from index 1
      - ['', 'Utilidad Bruta', None, ...] then ['', '4T25', ...] — title row + header
        row, data rows from index 2
    """
    with pdfplumber.open(pdf_path) as pdf:
        rows = []
        found_tables = set()

        for page in pdf.pages[:30]:
            tables = page.extract_tables()
            for table in tables:
                if not table or len(table) < 3:
                    continue

                # Check first two rows for table title (any cell)
                header_text = " ".join(str(c or "") for c in table[0]).strip()

                matched_table = None
                for canonical, aliases in PRESS_RELEASE_TABLES.items():
                    if canonical in found_tables:
                        continue
                    for alias in aliases:
                        if alias.lower() in header_text.lower():
                            matched_table = canonical
                            break
                    if matched_table:
                        break

                if not matched_table:
                    continue

                found_tables.add(matched_table)

                # Determine where data rows start: skip title row + optional
                # column-header row (contains "4T25" / "1T26" patterns)
                data_start = 1
                if len(table) > 1:
                    row1_text = " ".join(str(c or "") for c in table[1])
                    if any(p in row1_text for p in ["T2", "Q2", "Cambio", "cambio"]):
                        data_start = 2

                for data_row in table[data_start:]:
                    if not data_row or not data_row[0]:
                        continue

                    region_raw = str(data_row[0]).strip()
                    region = None
                    for r in PRESS_RELEASE_REGIONS:
                        if r.lower() == region_raw.lower():
                            region = r
                            break
                    if not region:
                        continue

                    qtr_value = parse_number(str(data_row[1]) if len(data_row) > 1 and data_row[1] else "")
                    if qtr_value is None:
                        continue

                    label = f"{matched_table}|{region}"
                    rows.append({"label": label, "values": [qtr_value]})

        return {
            "code": "press_release",
            "pages": [],
            "tables": [{"page": 0, "headers": ["Region", "Quarter"], "rows": rows}] if rows else []
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 extract.py <pdf_path> [section_codes...]", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    section_codes = sys.argv[2:] if len(sys.argv) > 2 else None

    include_press_release = False
    if section_codes and "press_release" in section_codes:
        include_press_release = True
        section_codes = [c for c in section_codes if c != "press_release"]
        if not section_codes:
            section_codes = None

    try:
        results = extract_sections(pdf_path, section_codes)
        if include_press_release:
            results.append(extract_press_release(pdf_path))
        print(json.dumps(results, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
