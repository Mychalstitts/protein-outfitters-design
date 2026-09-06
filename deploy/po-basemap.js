/* Keyless basemap helper.
   Live Carto dark_all / light_all burn in “API KEY REQUIRED”.
   This repo has no tile-provider secrets — do not invent one.
   Esri World Gray is used first; OSM is the fallback if Esri 404s. */
(function (w) {
  'use strict';

  function banner(map, text) {
    const host = (map && map.getContainer() && map.getContainer().parentElement) || document.body;
    if (!host || host.querySelector('.po-basemap-banner')) return;
    const el = document.createElement('div');
    el.className = 'po-basemap-banner';
    el.setAttribute('role', 'status');
    el.textContent = text;
    host.appendChild(el);
  }

  w.PO_addBasemap = function PO_addBasemap(map, opts) {
    if (!w.L || !map) return;
    const theme = (opts && opts.theme) || 'dark';
    const esriBase = theme === 'light'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    const esriRef = theme === 'dark'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
      : '';

    const base = L.tileLayer(esriBase, {
      attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, FAO, NOAA, USGS',
      maxZoom: 16,
    }).addTo(map);

    if (esriRef) {
      L.tileLayer(esriRef, { attribution: '', maxZoom: 16 }).addTo(map);
    }

    let errors = 0;
    let fellBack = false;
    base.on('tileerror', function () {
      errors += 1;
      if (fellBack || errors < 6) return;
      fellBack = true;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        subdomains: 'abc',
        maxZoom: 19,
      }).addTo(map);
      banner(map, 'Esri tiles failed; using OpenStreetMap. No tile API key is configured in this app — none to renew.');
    });
  };
})(window);
