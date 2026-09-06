import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'deploy/po-shell.css'), 'utf8');
const js = readFileSync(join(root, 'deploy/po-shell.js'), 'utf8');
const home = readFileSync(join(root, 'deploy/index.html'), 'utf8');
const discover = readFileSync(join(root, 'deploy/discover.html'), 'utf8');
const map = readFileSync(join(root, 'deploy/map.html'), 'utf8');
const processor = readFileSync(join(root, 'deploy/processor.html'), 'utf8');

test('shared search is a single rounded field with a left icon', () => {
  assert.match(css, /\.po-search \{/);
  assert.match(css, /\.po-search \{[^}]*border-radius:\s*999px/);
  assert.match(css, /\.po-search \{[^}]*flex-wrap:\s*nowrap/);
  assert.match(css, /\.po-search-icon \{/);
  assert.match(css, /\.po-search-icon \{[^}]*flex-shrink:\s*0/);
  assert.doesNotMatch(css, /\.hero-search-icon\{\s*display:\s*none/);
});

test('home, discover, map, and plant-claim use the shared search', () => {
  assert.match(home, /class="po-search hero-search"/);
  assert.match(home, /class="po-search-icon"/);
  assert.match(home, /placeholder="Search animals, farms, or ZIP"/);
  assert.doesNotMatch(home, /hero-search-ai|Try: "grass-fed/);

  assert.match(discover, /class="po-search"/);
  assert.match(discover, /class="po-search-icon"/);
  assert.match(discover, /placeholder="Search animals, farms, or ZIP"/);
  assert.doesNotMatch(discover, /ds-input-wrap|ds-ai-badge|Try: "grass-fed/);

  assert.match(map, /po-search po-search--map/);
  assert.match(map, /class="po-search-icon"/);
  assert.match(map, /placeholder="Search ZIP, city, or state"/);

  assert.match(processor, /class="pr-claim-search"/);
  assert.match(processor, /class="po-search"/);
  assert.match(processor, /placeholder="Search plant name"/);
});

test('homepage does not wrap or hide the search icon on phones', () => {
  const mobile = /@media \(max-width: 720px\)\{[\s\S]*?\.hero-search\{[\s\S]*?\}/.exec(home);
  if (mobile) {
    assert.doesNotMatch(mobile[0], /flex-wrap:\s*wrap/);
    assert.doesNotMatch(mobile[0], /display:\s*none/);
  }
  assert.match(home, /@media \(max-width: 720px\)\{[\s\S]*\.hero \{[^}]*overflow:\s*visible/);
  assert.match(home, /@media \(max-width: 720px\)\{[\s\S]*\.hero-scroll \{ display: none/);
});

test('role-hub drawers omit the marketplace tagline', () => {
  assert.match(js, /const drawerMeta = isRoleHub/);
  assert.match(js, /A whole animal, in three taps/);
  assert.match(js, /drawerMeta/);
});
