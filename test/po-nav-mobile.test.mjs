import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'deploy/po-shell.css'), 'utf8');
const js = readFileSync(join(root, 'deploy/po-shell.js'), 'utf8');
const admin = readFileSync(join(root, 'deploy/admin-overview.html'), 'utf8');
const plant = readFileSync(join(root, 'deploy/plant-desk.html'), 'utf8');

function cssBlock(selectorStart) {
  const i = css.indexOf(selectorStart);
  assert.ok(i >= 0, `missing ${selectorStart}`);
  return css.slice(i, i + 800);
}

test('admin and plant-desk still use the shared po-nav header', () => {
  for (const html of [admin, plant]) {
    assert.match(html, /class="po-nav-wrap"/);
    assert.match(html, /class="po-nav-links"/);
    assert.match(html, /class="po-nav-actions"/);
    assert.match(html, /po-shell\.js/);
    assert.match(html, /po-shell\.css/);
  }
  assert.match(admin, /href="\/admin-overview"/);
  assert.match(plant, /href="\/plant-desk"/);
});

test('role hubs no longer skip the hamburger', () => {
  assert.match(js, /function enhanceMarketplaceNav/);
  assert.doesNotMatch(
    js,
    /if \(isRoleHub\) return;/,
    'isRoleHub early-return would hide the burger on /admin* /processor* /plant-desk'
  );
  assert.match(js, /plant-desk/);
  assert.match(js, /need a drawer/);
});

test('header stays inside the viewport so the burger is not clipped off-screen', () => {
  assert.match(css, /\.po-nav \{[^}]*max-width:\s*min\(1320px,\s*100%\)/);
  assert.match(css, /\.po-nav-wrap \{[^}]*max-width:\s*100%/);
  assert.match(css, /\.po-nav-burger[\s\S]*flex-shrink:\s*0/);
  assert.match(css, /\.po-nav-burger[\s\S]*min-width:\s*44px/);
  assert.match(css, /\.po-nav-burger[\s\S]*min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.po-user-chip-name/);
});

test('drawer sits above the sticky wrap and is not a horizontal scroller', () => {
  const drawer = cssBlock('.po-nav-drawer {');
  const z = /z-index:\s*(\d+)/.exec(drawer);
  assert.ok(z, 'drawer needs a z-index');
  assert.ok(Number(z[1]) > 80, `drawer z-index ${z[1]} must beat .po-nav-wrap (80)`);
  assert.match(drawer, /max-width:\s*100vw/);
  assert.match(drawer, /overflow-x:\s*hidden/);
  assert.match(js, /document\.body\.appendChild\(drawer\)/);
  assert.doesNotMatch(css, /\.po-nav-links\s*\{[^}]*overflow-x:\s*auto/);
});

test('opening the burger closes the profile menu', () => {
  assert.match(js, /closeAccountChrome/);
  assert.match(js, /\.po-user-menu\.open/);
  assert.match(js, /closeAccountChrome\(\)/);
});

test('profile chip collapses to avatar at 640px', () => {
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.po-user-chip-name/);
  assert.match(js, /@media \(max-width: 640px\)/);
  assert.match(js, /po-user-chip-name/);
  assert.match(js, /aria-label="Account menu"/);
  assert.match(js, /<a href="\/account">My account<\/a>/);
  assert.match(js, /id="poSignout"/);
});
