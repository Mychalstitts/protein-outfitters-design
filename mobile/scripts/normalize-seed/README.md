# Seed normalization

Cleans raw scraped processor / supplier records into the canonical
`Processor` shape from `@protein-outfitters/shared` and emits a fresh
bundled JSON for both apps.

This is an **offline batch** — it does not run in the web or mobile
runtime. It exists so we can re-run the cleanup whenever the scrapes
get a new round of data, and the result is a checked-in static file
that ships with the apps for offline first-launch.

## What it does

1. Reads raw rows from `app/scripts/normalize-seed/input/*.json`
   (drop scrapes here — gitignored except for a `.gitkeep`).
2. POSTs each row to a local LLM endpoint (default
   `http://localhost:8080/v1/chat/completions`, OpenAI-compatible —
   works with llama.cpp server, Ollama, LM Studio, vLLM, etc.).
3. Validates the LLM output against `targetSchema.mjs`.
4. Drops invalid rows with a console warning.
5. Writes the cleaned set to:
   - `app/apps/mobile/src/data/processors.bundled.json`
   - `app/apps/web/public/processors.bundled.json`

## Running it

From the repo root:

```bash
LLM_URL=http://localhost:8080/v1/chat/completions \
LLM_MODEL=qwen3-27b \
node app/scripts/normalize-seed/normalize.mjs
```

Env vars (all optional):

- `LLM_URL` — OpenAI-compatible chat completions endpoint
- `LLM_MODEL` — model name to pass through
- `LLM_API_KEY` — if your local server requires one (most don't)
- `DRY_RUN=1` — validate inputs and print the diff without writing

## Why not call this from the app?

Running inference at request time costs latency, money, and
introduces a runtime dependency we don't need. The cleaned dataset
changes when scrapes change — once a quarter, not once a request.
A checked-in JSON also means PR review can spot bad rows before they
ship to App Store + Play Store builds.

## Pairing with the existing bundler

This script writes to the same destination as `app/scripts/bundle-data.mjs`.
Run normalize first, then `npm run bundle:data` if the existing
bundler has additional shaping work to do.
