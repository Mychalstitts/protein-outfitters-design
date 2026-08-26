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
//   3. parse-check inline <script> in deploy/**/*.html
//      (list-animal Continue was dead because a duplicate `const birth`
//       threw before any click handlers attached; npm run lint missed it)
//
// Add new checks here as we identify them. Exit 1 on any failure so CI
// turns red. No deps beyond Node — keeps the install-time tiny.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'deploy', 'api'),
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

function walkHtml(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const stat = fs.statSync(p);
  if (stat.isFile()) {
    if (p.endsWith('.html')) out.push(p);
    return out;
  }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    walkHtml(path.join(p, e.name), out);
  }
  return out;
}

function extractInlineScripts(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["'][^"']*(json|ld\+json|template)["']/i.test(attrs)) continue;
    const code = (m[2] || '').trim();
    if (!code) continue;
    blocks.push(code);
  }
  return blocks;
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

// 3. Parse-check inline <script> blocks in HTML (src= and JSON-LD skipped).
const htmlFiles = walkHtml(path.join(ROOT, 'deploy'));
let htmlScripts = 0;
for (const f of htmlFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const blocks = extractInlineScripts(src);
  htmlScripts += blocks.length;
  blocks.forEach((code, i) => {
    try {
      // new Function parses classic scripts; type=module is rare in this tree.
      new vm.Script(code, { filename: `${path.relative(ROOT, f)}#script${i + 1}` });
    } catch (err) {
      failed++;
      console.error(`✗ parse error: ${path.relative(ROOT, f)} inline script #${i + 1}`);
      console.error(String(err.message || err).split('\n').slice(0, 3).join('\n'));
    }
  });
}
console.log(`lint: checked ${htmlScripts} inline scripts in ${htmlFiles.length} HTML files`);

if (failed) {
  console.error(`\nlint: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('lint: all clean ✓');
