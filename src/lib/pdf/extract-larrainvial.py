#!/usr/bin/env python3
"""Extract FINANCIAMIENTO and MOVIMIENTOS DE CAJA EN PESOS from LarrainVial brokerage PDFs.

Usage: python3 extract-larrainvial.py <pdf_path>
Output: JSON to stdout

Designed for LarrainVial "Informe Provisorio Patrimonial" — digitally generated PDFs
with embedded text. No OCR needed. No fallback — fails loudly if pdfplumber unavailable.

Number format: Chilean (dots = thousands, commas = decimals): 1.234.567,89 -> 1234567.89
"""
import pdfplumber
import json
import sys
import re


def parse_chilean_number(s):
    """Parse Chilean number format: dots as thousands sep, comma as decimal sep.

    Examples:
      '1.234.567'      -> 1234567
      '1.234.567,89'   -> 1234567.89
      '-5.683.298.038' -> -5683298038
      '0,52'           -> 0.52
      ''               -> None
    """
    if not s or not s.strip():
        return None
    s = s.strip()
    negative = s.startswith('-')
    if negative:
        s = s[1:]
    # Remove thousands dots, replace decimal comma with dot
    # Check if last segment after comma has exactly 2 chars (decimal part)
    if ',' in s:
        parts = s.split(',')
        integer_part = parts[0].replace('.', '')
        decimal_part = parts[1]
        result = float(f"{integer_part}.{decimal_part}")
    else:
        result = float(s.replace('.', ''))
    return -result if negative else result


def extract_date(pdf):
    """Extract statement date from first page header."""
    text = pdf.pages[0].extract_text() or ''
    # Look for "Periodo: Marzo 2026" or similar
    m = re.search(r'Periodo:\s+(\w+)\s+(\d{4})', text)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    # Look for date in format DD/MM/YYYY or DD-MM-YYYY anywhere
    m = re.search(r'(\d{2})[/-](\d{2})[/-](\d{4})', text)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def extract_fund_name(pdf):
    """Extract fund name from first page."""
    # Check pages 1-2 for fund name
    for i in range(min(2, len(pdf.pages))):
        text = pdf.pages[i].extract_text() or ''
        m = re.search(r'(FUNDAMENTA\s+\S+(?:\s+\S+)*(?:LLC|FUND|SA|SPA))', text)
        if m:
            return m.group(1)
    return None


def parse_financiamiento_line(line):
    """Parse a FINANCIAMIENTO data line into a Simultanea dict.

    Line format (space-separated with Chilean numbers):
    5709684 ITAUCL Simultanea CLP 77.897,0000 19.503,00 1.519.225.222 20-03-2026 21-04-2026 0,52 26 1.520.805.216

    Columns: Folio Nemo Tipo Moneda Cantidad PrecioInicial Principal FechaInicial FechaFinal Tasa Dias Compromiso
    """
    # Must start with a numeric folio
    if not re.match(r'^\d{7,}', line.strip()):
        return None

    tokens = line.strip().split()
    if len(tokens) < 12:
        return None

    try:
        folio = tokens[0]
        nemo = tokens[1]
        # tipo = tokens[2]  # always "Simultanea"
        # moneda = tokens[3]  # always "CLP"
        cantidad = parse_chilean_number(tokens[4])
        precio_inicial = parse_chilean_number(tokens[5])
        principal = parse_chilean_number(tokens[6])
        fecha_inicial = tokens[7]
        fecha_final = tokens[8]
        tasa = parse_chilean_number(tokens[9])
        dias = int(tokens[10])
        compromiso = parse_chilean_number(tokens[11])

        return {
            'folio': folio,
            'nemo': nemo,
            'fechaInicial': fecha_inicial,
            'fechaFinal': fecha_final,
            'cantidad': cantidad,
            'precioInicial': precio_inicial,
            'principal': principal,
            'tasa': tasa,
            'dias': dias,
            'compromiso': compromiso,
        }
    except (IndexError, ValueError):
        return None


def parse_caja_line(line, current_saldo=None):
    """Parse a MOVIMIENTOS DE CAJA EN PESOS data line.

    Line format examples:
    '02/03/2026 5658862Factura venta RV (simultanea) 2.606.704.177 6.960.338.124'
    '26/03/2026 823150N.credito compra tp 2.617.104.565 4.473.962.408'
    '01/03/2026 Saldo inicial 4.366.046.786'

    The reference and description are concatenated without space in the PDF text.
    We split on the first numeric sequence after the date.
    """
    # Must start with a date
    if not re.match(r'^\d{2}/\d{2}/\d{4}', line.strip()):
        return None

    line = line.strip()

    # Parse date
    date_match = re.match(r'^(\d{2}/\d{2}/\d{4})\s+', line)
    if not date_match:
        return None
    fecha = date_match.group(1)
    rest = line[date_match.end():]

    # Split reference (numeric prefix) from description
    ref_match = re.match(r'^(\d+)(.+)', rest)
    if ref_match:
        referencia = ref_match.group(1)
        desc_and_amounts = ref_match.group(2).strip()
    else:
        # Saldo inicial or similar (no reference number)
        referencia = ''
        desc_and_amounts = rest.strip()

    # Extract trailing numbers (amounts + saldo) from the end
    # Numbers are Chilean format: digits with dots, optional comma+2digits
    # Work backwards to find description vs amounts
    trailing_nums = []
    parts = desc_and_amounts.split()
    i = len(parts) - 1
    while i >= 0:
        part = parts[i]
        # A number part: contains digits and possibly dots/commas
        if re.match(r'^-?[\d.]+(?:,\d+)?$', part):
            trailing_nums.insert(0, part)
            i -= 1
        else:
            break
    desc_end_idx = len(parts) - len(trailing_nums)
    descripcion = ' '.join(parts[:desc_end_idx]).strip()

    cargo = None
    abono = None
    saldo = None

    if len(trailing_nums) >= 2:
        # Last is saldo, second-to-last is the amount (cargo or abono)
        saldo = parse_chilean_number(trailing_nums[-1])
        amount = parse_chilean_number(trailing_nums[-2])

        # Determine cargo vs abono based on description keywords and saldo direction
        desc_lower = descripcion.lower()
        is_credit = any(k in desc_lower for k in [
            'venta rv', 'venta (simultanea)', 'venta rv (simultanea)',
            'abono', 'dividendo', 'interes',
        ])
        is_debit = any(k in desc_lower for k in [
            'compra', 'cargo', 'n.credito compra', 'retiro',
        ])

        # Use saldo direction to determine: if saldo increased, it's abono
        if current_saldo is not None and saldo is not None:
            if saldo > current_saldo:
                abono = amount
            else:
                cargo = amount
        elif is_credit:
            abono = amount
        elif is_debit:
            cargo = amount
        else:
            # Default: use saldo change
            abono = amount

    elif len(trailing_nums) == 1:
        # Only saldo (e.g., "Saldo inicial")
        saldo = parse_chilean_number(trailing_nums[0])

    if saldo is None and current_saldo is not None:
        saldo = current_saldo

    return {
        'fecha': fecha,
        'referencia': referencia,
        'descripcion': descripcion,
        'cargo': cargo,
        'abono': abono,
        'saldo': saldo,
    }


def extract_larrainvial(pdf_path):
    """Extract FINANCIAMIENTO and MOVIMIENTOS DE CAJA EN PESOS from a LarrainVial PDF."""
    try:
        pdf = pdfplumber.open(pdf_path)
    except Exception as e:
        print(f"ERROR: Cannot open PDF: {e}", file=sys.stderr)
        sys.exit(1)

    with pdf:
        date = extract_date(pdf)
        fund_name = extract_fund_name(pdf)

        # Detect dates from cash movements last page instead
        # (more reliable than header period)
        last_date_seen = None

        financiamiento = []
        mov_caja = []

        in_fin = False
        in_caja = False
        done_caja = False
        total_fin = None
        current_saldo = None

        for page in pdf.pages:
            text = page.extract_text() or ''
            lines = text.split('\n')

            # Section detection based on page text
            if 'FINANCIAMIENTO' in text and not in_caja and not done_caja:
                in_fin = True
            if 'MOVIMIENTOS DE CAJA EN PESOS' in text:
                in_fin = False
                if not done_caja:
                    in_caja = True
            if in_caja and any(h in text for h in [
                'MOVIMIENTOS DE TITULOS EN PESOS',
                'MOVIMIENTOS DE CAJA EN DOLAR',
            ]):
                done_caja = True
                in_caja = False

            for line in lines:
                line = line.strip()
                if not line:
                    continue

                if in_fin:
                    # Skip header lines
                    if any(h in line for h in ['Folio', 'FINANCIAMIENTO', 'PATRIMONIO', 'Fecha', 'Inicial', 'R.U.T.', 'Periodo', 'Cuenta', 'www.', 'Pagina', 'Valores']):
                        continue
                    if 'Total financiamiento' in line:
                        m = re.search(r'([\d.]+)$', line.strip())
                        if m:
                            total_fin = parse_chilean_number(m.group(1))
                        continue
                    sim = parse_financiamiento_line(line)
                    if sim:
                        financiamiento.append(sim)

                elif in_caja and not done_caja:
                    # Skip header/footer lines
                    if any(h in line for h in ['Fecha', 'MOVIMIENTOS', 'PATRIMONIO', 'R.U.T.', 'Periodo', 'Cuenta', 'www.', 'Pagina', 'Valores', 'Referencia']):
                        continue
                    if line.startswith('Saldo final'):
                        # Extract final saldo
                        m = re.search(r'([\d.]+(?:,\d+)?)$', line)
                        if m:
                            current_saldo = parse_chilean_number(m.group(1))
                        continue
                    mov = parse_caja_line(line, current_saldo)
                    if mov:
                        # Update running saldo
                        if mov['saldo'] is not None:
                            current_saldo = mov['saldo']
                        # Only keep simultanea-related and saldo-setting entries
                        mov_caja.append(mov)
                        # Track last date for statement date
                        if mov['fecha']:
                            last_date_seen = mov['fecha']

        # Use last cash movement date as statement date (more reliable than header period)
        if last_date_seen:
            parts = last_date_seen.split('/')
            if len(parts) == 3:
                date = f"{parts[2]}-{parts[1]}-{parts[0]}"

    return {
        'date': date,
        'fundName': fund_name,
        'financiamiento': financiamiento,
        'movCajaPesos': mov_caja,
        'totalFinanciamiento': total_fin,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 extract-larrainvial.py <pdf_path>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    result = extract_larrainvial(pdf_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
