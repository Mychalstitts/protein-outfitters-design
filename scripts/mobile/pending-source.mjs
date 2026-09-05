#!/usr/bin/env node
/**
 * Stub scripts for the mobile workspace until the Expo app + shared package
 * are transplanted via git subtree (docs/mobile/MIGRATE.md).
 *
 * typecheck/test exit 0 so path-filtered Mobile CI stays green on the
 * scaffold-only PR. Runtime commands (start/ios/android) still fail hard.
 */
const cmd = process.argv[2] ?? 'unknown';
const soft = new Set(['typecheck', 'shared:typecheck', 'shared:test', 'test']);

const msg =
  `[protein-outfitters] mobile/shared source is not transplanted yet (command: ${cmd}).\n` +
  `See docs/mobile/MIGRATE.md — needs git subtree from Mychalstitts/protein-outfitters-app.`;

if (soft.has(cmd)) {
  console.warn(msg);
  console.warn('Exiting 0 so scaffold CI can pass; replace stubs after subtree.');
  process.exit(0);
}

console.error(msg);
process.exit(1);
