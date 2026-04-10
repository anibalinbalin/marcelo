# prompt_config.py — AGENT EDITS THIS FILE
# All tuneable parameters for VLM extraction.
# eval.py imports this fresh on every run — edit and re-run.

# The prompt sent to GLM-OCR for each page image.
# GLM-OCR is a vision model fine-tuned on document tables.
# It returns HTML <table> markup.
VLM_PROMPT = "Table Recognition. Do not abbreviate row labels. Preserve all text exactly as written in the document."

# Render DPI for PDF -> PNG conversion. Higher = more detail, slower.
# Useful range: 150–300. H100 can handle 300 easily.
# Note: DPI > 200 causes Ollama HTTP 500 (image too large). Stick to 150-200.
# DPI=150 gives same score as 200 but runs 36% faster.
DPI = 150

# Model context window (tokens). 8192 handles ~2 dense pages.
# Increase if tables are getting cut off.
NUM_CTX = 8192

# Temperature. 0 = deterministic. Rarely worth changing.
TEMPERATURE = 0

# Which column index (0-based, within numeric values only) is the target quarter.
# BIVA quarterly report columns after label: [AnnualCurrent, AnnualPrior, Q4Current, Q4Prior]
# So Q4 Current = index 2. Change only if the PDF has a different column layout.
# Note: Balance sheet ([210000]) only has 2 columns, so idx=2 falls back to values[0].
VALUE_COL_INDEX = 2

# Fuzzy match minimum score to accept a label match (0–100).
# 0 = accept any best match. 70 = require substring containment.
MATCH_THRESHOLD = 0

# Whether to strip accented characters (á -> a, é -> e, etc.) before matching.
# True improved score from 4/18 to 7/18 by allowing GLM-OCR's accented PDF labels
# to match the unaccented targets in KNOWN_MAPPINGS.
NORMALIZE_ACCENTS = True
