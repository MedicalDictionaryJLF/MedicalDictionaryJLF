# Cleanup Report

## Cleanup Decisions

This cleanup pass documented the repository structure first, then deleted only safe generated/dependency or unused placeholder files.

## Deleted

Deleted in this pass:

- `node_modules/`: dependency output restored by `npm.cmd install`.
- `data/app_language/anamnesis_psychiatry_translated.csv`: exactly 0 bytes, and `rg` found no code reference to `anamnesis_psychiatry_translated.csv`.

Pre-existing deletion not performed by this cleanup pass:

- `MedicalDictionaryJLF.rar`: already deleted in the working tree before cleanup started.

## Intentionally Not Deleted

- `api/`
- `src/`
- `assets/`
- `data/` datasets except the confirmed empty unused placeholder listed above
- `anamnesis/`
- `anamnesis-training/`
- root page folders
- ECG files
- `patient-avatar.svg`
- `package-lock.json`
- README and license files

## Later Reorganization

- Keep root page folders in place until route-loader paths, relative fetches, and direct static URLs are migrated and tested.
- Keep `api/` at root unless Vercel configuration is changed.
- Keep `anamnesis-training/` self-contained until the app has a broader module layout.

## Suspicious But Preserved

- Similar logo/image files under `assets/` were preserved because duplicate cleanup requires hash comparison, reference checks, and one canonical retained asset.
- Large medical datasets were preserved because they are app data, not generated output.
- Historical terminology source files under `data/terminology/` were preserved as source data/documentation.
