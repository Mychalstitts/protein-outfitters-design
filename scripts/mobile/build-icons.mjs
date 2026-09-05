#!/usr/bin/env node
/**
 * Thin wrapper — real script is mobile/scripts/build-icons.mjs.
 * Prefer: npm run mobile:build-icons
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const nested = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'mobile',
  'scripts',
  'build-icons.mjs',
);
const result = spawnSync(process.execPath, [nested, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
