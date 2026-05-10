# Company Packs

Company packs turn Camila's manual review into repeatable certification.

Each pack owns one company/quarter and records:

- the accepted source workbook and checksum
- the expectation module used by `fake-camila`
- minimum assertion counts for pre-approval cells, post-recalc cells, and duplicate-label canaries
- the known risks the pack is meant to catch

Run the cheap gate before asking Camila to review:

```bash
npm run verify:company -- LREN3 4Q25
npm run verify:companies
```

Run the full gate before delivery when DB, blob storage, and Excel automation are available:

```bash
npm run certify:company -- LREN3 4Q25
```

If Camila finds a new issue, add the exact cell or invariant to the expectation module first. Then the same issue cannot silently return.
