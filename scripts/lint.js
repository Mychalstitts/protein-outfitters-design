// scripts/lint.js — single command that runs every static check we trust.
//
// Wired into:
//   • npm run lint                        — manual / pre-push
//   • .github/workflows/validate-schema.yml — CI on every PR + push
//
// Currently runs:
//   1. node --check on every deploy/**/*.js  (catches parse errors)
//   2. scripts/check-no-dupe-decls.js        (catches the merge-concat
//                                             helper SyntaxError pattern)
//
// Add new checks here as we identify them. Exit 1 on any failure so CI
// turns red. No deps beyond Node — keeps the install-time tiny.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'deploy', 'api'),
  path.join(ROOT, 'deploy', 'lib'),
  path.join(ROOT, 'deploy', 'po-api.js'),
  path.join(ROOT, 'deploy', 'po-shell.js'),
  path.join(ROOT, 'deploy', 'sw.js'),
  path.join(ROOT, 'scripts'),
];

function walk(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const stat = fs.statSync(p);
  if (stat.isFile()) {
    if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
    return out;
  }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    walk(path.join(p, e.name), out);
  }
  return out;
}

const files = TARGETS.flatMap(t => walk(t));
console.log(`lint: checking ${files.length} JS files`);

let failed = 0;

// 1. Parse check via node --check.
for (const f of files) {
  const r = cp.spawnSync('node', ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    const rel = path.relative(ROOT, f);
    console.error(`✗ parse error: ${rel}`);
    if (r.stderr) console.error(r.stderr.trim().split('\n').slice(0, 3).join('\n'));
  }
}

// 2. Duplicate top-level declaration scan.
const dupeCheck = cp.spawnSync('node', [path.join(ROOT, 'scripts', 'check-no-dupe-decls.js')], { encoding: 'utf8' });
if (dupeCheck.status !== 0) {
  failed++;
  console.error('✗ duplicate-declaration scan failed');
  if (dupeCheck.stdout) console.error(dupeCheck.stdout.trim());
  if (dupeCheck.stderr) console.error(dupeCheck.stderr.trim());
} else {
  console.log(`✓ no duplicate top-level declarations`);
}

if (failed) {
  console.error(`\nlint: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('lint: all clean ✓');
