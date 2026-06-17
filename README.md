# Protein Outfitters — Canonical Site

**This is the single source of truth** for [proteinoutfitters.com](https://www.proteinoutfitters.com).

Static HTML/CSS/JS in `deploy/` plus Vercel serverless APIs. Other repos (`protein-outfitters-app`, `protein-outfitters-storefront`, `PO2`) are being merged here — see [`CONSOLIDATION.md`](./CONSOLIDATION.md) for the full map of Vercel projects, feature parity, and merge status.

## Pages

| Path | What it shows |
|---|---|
| `/` | Master responsive marketing site + 3-tap Tesla checkout |
| `/cut-sheet` | Two-tier cut sheet UI with presets, yield meter, animal-aware branching |
| `/reserve-flow` | Reserve & Customize Steps 1, 2, 4 |
| `/processor-ops` | Processor queue + QR check-in + farmer dropoff deposit |
| `/admin` | Disputes triage + processor config dashboard |
| `/processor-saas` | Pricing page + in-app billing dashboard |
| `/donation-flow` | Producer Partnership donation flow + tax letter preview |
| `/hardware` | Friesla MPU storefront + configurator + lead capture |

## Stack

Pure static HTML + CSS. No JS framework, no build step. Deployed via Vercel.

## JSON-LD Structured Data Validation

This repo now includes automated validation for all Schema.org JSON-LD blocks.

### Local Validation

```bash
npm install
npm run validate:jsonld
```

This scans every `.html` file and checks:
- Valid JSON syntax
- Presence of `@context` and `@type`
- Basic required fields for common types (Organization, WebSite, etc.)

### CI / GitHub Actions

Validation runs automatically on every push and pull request via `.github/workflows/validate-schema.yml`.

If any JSON-LD errors are found, the CI will fail.

## Project Status (May 2026)

**Core improvements completed:**

- Schema.org structured data added across all major pages
- Consistent surfacing of future AI-powered features
- All original interactivity preserved
- Automated JSON-LD validation in CI + locally

The prototype is now in a strong state for SEO, maintainability, and future development.

See `IMPLEMENTATION.md` for the full detailed log of changes.
