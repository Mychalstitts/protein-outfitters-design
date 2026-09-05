#!/usr/bin/env node
// Normalize raw scraped processor / supplier rows using a local LLM,
// validate output, and emit the bundled JSON for both apps.
//
// Run: node app/scripts/normalize-seed/normalize.mjs
// Env:
//   LLM_URL=http://localhost:8080/v1/chat/completions  (default)
//   LLM_MODEL=qwen3-27b
//   LLM_API_KEY=...     (optional)
//   DRY_RUN=1           (validate, don't write)
//
// Designed to be runnable with zero npm install — Node 20+ built-ins only.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRow } from './targetSchema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const INPUT_DIR = join(__dirname, 'input');
const MOBILE_OUT = join(REPO_ROOT, 'app/apps/mobile/src/data/processors.bundled.json');
const WEB_OUT = join(REPO_ROOT, 'app/apps/web/public/processors.bundled.json');

const LLM_URL = process.env.LLM_URL || 'http://localhost:8080/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'local';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const DRY_RUN = process.env.DRY_RUN === '1';

const SYSTEM_PROMPT = `You normalize messy scraped meat-processor and pasture-based-farm records into a strict JSON shape.

Rules:
- Output ONLY a single JSON object, no markdown fences, no commentary.
- role: "processor" for meat processors (slaughter, custom cuts, smoking, sausage); "supplier" for pasture-based farms selling direct.
- id: keep the source-prefixed id from the input (e.g. "mamp-564", "eatwild-1287"). If absent, generate "{source}-{slugified-name}".
- slug: kebab-case of the name, ASCII only, no double dashes.
- lat / lng: numeric, US bounds only. If clearly outside the US, set both to null and we'll drop the row.
- address.state: 2-letter uppercase code (WI, IN, IA, PA, ...).
- services: array of trimmed strings. Normalize "USDA insp." / "USDA Inspected" to "USDA Inspected", similar for state inspection. Keep functional services (Custom Cuts, Smoking, Sausage, Game Processing) verbatim if cleaner.
- Strings: trim whitespace; convert empty strings to null on optional fields.
- Do NOT invent data. If a field isn't in the input, output null.

Output shape (TypeScript-ish reference, see Processor in @protein-outfitters/shared):
{
  id, slug, name, role,
  contact_name, phone, email, website,
  address: { street, city, state, zip, full },
  lat, lng, geocode_source,
  services: string[],
  inspection_status, usda_establishment_number,
  source, source_url,
  claim_status: "unclaimed"
}`;

async function callLlm(rawRow) {
  const body = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Normalize this row:\n\n${JSON.stringify(rawRow, null, 2)}` },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  };
  const headers = { 'content-type': 'application/json' };
  if (LLM_API_KEY) headers.authorization = `Bearer ${LLM_API_KEY}`;

  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM response missing message.content');
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`LLM returned non-JSON content: ${content.slice(0, 200)}…`);
  }
}

async function loadInputs() {
  if (!existsSync(INPUT_DIR)) return [];
  const files = (await readdir(INPUT_DIR)).filter((f) => f.endsWith('.json'));
  const rows = [];
  for (const f of files) {
    const raw = await readFile(join(INPUT_DIR, f), 'utf8');
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const r of arr) rows.push({ _sourceFile: f, ...r });
  }
  return rows;
}

async function main() {
  const inputs = await loadInputs();
  if (inputs.length === 0) {
    console.error(
      `No inputs found in ${INPUT_DIR}. Drop scraped *.json files there first.`,
    );
    process.exit(1);
  }
  console.log(`Loaded ${inputs.length} raw rows from ${INPUT_DIR}.`);

  const cleaned = [];
  let dropped = 0;
  let llmFailures = 0;

  for (const [i, raw] of inputs.entries()) {
    process.stdout.write(`  [${i + 1}/${inputs.length}] ${raw._sourceFile} → ...`);
    let out;
    try {
      out = await callLlm(raw);
    } catch (err) {
      console.log(` LLM error: ${err.message}`);
      llmFailures += 1;
      continue;
    }
    const verdict = validateRow(out);
    if (!verdict.ok) {
      console.log(` dropped: ${verdict.reason}`);
      dropped += 1;
      continue;
    }
    cleaned.push(verdict.value);
    console.log(' ok');
  }

  console.log('');
  console.log(`Cleaned: ${cleaned.length}`);
  console.log(`Dropped: ${dropped}`);
  console.log(`LLM failures: ${llmFailures}`);

  if (DRY_RUN) {
    console.log('\nDRY_RUN=1 — not writing output files.');
    return;
  }

  const json = JSON.stringify(cleaned, null, 2) + '\n';
  await writeFile(MOBILE_OUT, json);
  await writeFile(WEB_OUT, json);
  console.log(`\nWrote ${MOBILE_OUT}`);
  console.log(`Wrote ${WEB_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
