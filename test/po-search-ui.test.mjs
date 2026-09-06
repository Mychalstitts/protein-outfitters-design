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
const hotspots = readFileSync(join(root, 'deploy/admin-hotspots.html'), 'utf8');

test('shared search is a single rounded field with a left icon', () => {
  assert.match(css, /\.po-search \{/);
  assert.match(css, /\.po-search \{[^}]*border-radius:\s*999px/);
  assert.match(css, /\.po-search \{[^}]*flex-wrap:\s*nowrap !important/);
  assert.match(css, /\.po-search \{[^}]*flex-direction:\s*row !important/);
  assert.match(css, /\.po-search-icon \{/);
  assert.match(css, /\.po-search-icon \{[^}]*flex-shrink:\s*0/);
  assert.match(css, /\.po-search input\[type="search"\][\s\S]*?flex:\s*1 1 0% !important/);
  assert.match(css, /min-width:\s*0 !important/);
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
  assert.match(map, /placeholder="ZIP or city"/);

  assert.match(processor, /class="pr-claim-search"/);
  assert.match(processor, /class="po-search"/);
  assert.match(processor, /placeholder="Search plant name"/);

  assert.match(hotspots, /class="po-search po-search--map hs-zip-search"/);
  assert.match(hotspots, /id="hsZipGo"/);
  assert.match(hotspots, /placeholder="ZIP"/);
});

test('maps use keyless Esri tiles — no Carto API-key watermark', () => {
  const tiles = readFileSync(join(root, 'deploy/po-basemap.js'), 'utf8');
  assert.match(tiles, /World_Dark_Gray_Base/);
  assert.match(tiles, /World_Light_Gray_Base/);
  assert.match(tiles, /tile\.openstreetmap\.org/);
  assert.doesNotMatch(tiles, /basemaps\.cartocdn\.com|api\.mapbox\.com|pk\.eyJ/);
  for (const html of [hotspots, map, discover]) {
    assert.doesNotMatch(html, /basemaps\.cartocdn\.com/);
    assert.doesNotMatch(html, /carto\.com\/basemap/);
    assert.match(html, /po-basemap\.js/);
    assert.match(html, /PO_addBasemap/);
  }
  assert.match(hotspots, /Opportunity Radar \(\/admin-hotspots\)/);
  assert.match(hotspots, /tile\.openstreetmap\.org/);
});

test('admin-hotspots chrome collapses on portrait so the heat map shows', () => {
  assert.match(hotspots, /id="hsChromeToggle"/);
  assert.match(hotspots, /id="hsRailToggle"/);
  assert.match(hotspots, /class="hs-chrome-toggle"/);
  assert.match(hotspots, /class="hs-rail-handle"/);
  assert.match(hotspots, /\.hs-controls \{ display: none/);
  assert.match(hotspots, /\.hs-rail:not\(\.is-open\) \.hs-rail-head/);
  assert.match(hotspots, /\.hs-rail\.is-open \{ height: 42vh/);
  assert.match(hotspots, /\.hs-legend \{ display: none/);
  assert.match(hotspots, /min-height: 44px/);
  assert.match(map, /id="mapSideToggle"/);
  assert.match(map, /\.map-side:not\(\.is-open\) \.map-side-head/);
  const zipAt = hotspots.indexOf('id="hsZipForm"');
  const controlsAt = hotspots.indexOf('id="hsControls"');
  assert.ok(zipAt > 0 && zipAt < controlsAt, 'ZIP search stays visible outside collapsed Layers');
});

test('homepage does not wrap or hide the search icon on phones', () => {
  const mobile = /@media \(max-width: 720px\)\{[\s\S]*?\.hero-search\{[\s\S]*?\}/.exec(home);
  if (mobile) {
    assert.doesNotMatch(mobile[0], /flex-wrap:\s*wrap/);
    assert.doesNotMatch(mobile[0], /display:\s*none/);
  }
  assert.match(home, /@media \(max-width: 720px\)\{[\s\S]*\.hero \{[^}]*overflow:\s*visible/);
  assert.match(home, /@media \(max-width: 720px\)\{[\s\S]*\.hero-scroll \{ display: none/);
  assert.match(home, /\.hero-search\.po-search \{[\s\S]*flex-wrap:\s*nowrap !important/);
});

test('role-hub drawers omit the marketplace tagline', () => {
  assert.match(js, /const drawerMeta = isRoleHub/);
  assert.match(js, /A whole animal, in three taps/);
  assert.match(js, /drawerMeta/);
});
