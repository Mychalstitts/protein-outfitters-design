// Fails if any deploy/api/**/*.js file declares the same top-level identifier
// twice. ESM strict mode rejects duplicate const/let/class — and audit-bot
// merges have shipped that pattern twice now (UUID_RE in _lib/db.js, then
// fetchWithTimeout in discover-nearby.js) because branch A added the helper
// near the top and branch B added the same helper near the bottom, so git's
// auto-merge concatenated both with no conflict. Both broke Vercel builds.
//
// Regex matches only line-anchored top-level declarations (no leading
// whitespace) — declarations inside functions/blocks don't shadow at the
// module level so don't trigger ESM strict-mode SyntaxErrors.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'deploy', 'api');
const DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

let failed = 0;
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const seen = new Map();
  let m;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(src))) {
    const name = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    if (seen.has(name)) {
      console.error(`${file}: duplicate top-level "${name}" at line ${line} (also line ${seen.get(name)})`);
      failed++;
    } else {
      seen.set(name, line);
    }
  }
}

if (failed) {
  console.error(`\n${failed} duplicate declaration(s) found. ESM strict mode will reject these at build time.`);
  process.exit(1);
}
console.log(`OK — no duplicate top-level declarations in ${ROOT}`);
