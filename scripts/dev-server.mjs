// scripts/dev-server.mjs — local development server for the Protein Outfitters
// site. Mirrors the parts of Vercel's routing the app relies on so the static
// pages AND the serverless functions in deploy/api/*.js run locally with a
// single `node scripts/dev-server.mjs`.
//
// What it emulates from deploy/vercel.json:
//   • Static hosting of deploy/ with `cleanUrls` (/discover → discover.html)
//     and `trailingSlash: false`.
//   • Serverless function dispatch for /api/** → deploy/api/**.js. Each
//     function exports a Node `(req, res)` handler via nodejsHandler().
//   • The two dynamic rewrites: /farm/:slug and /p/:slug.
//
// It is intentionally dependency-free (Node built-ins only) and is NOT used in
// production — Vercel serves the real thing. This only exists to make the repo
// runnable in a local dev / Cloud Agent environment.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STATIC_ROOT = path.join(ROOT, 'deploy');
const API_ROOT = path.join(STATIC_ROOT, 'api');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// db.js does `new URL(process.env.DATABASE_URL)` at import time, so a
// well-formed URL must exist even for endpoints that never touch the DB.
// Defaults to the local dev database provisioned by scripts/dev-db.sh /
// scripts/db-bootstrap.mjs. Override with DATABASE_URL to point elsewhere.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://po:po@127.0.0.1:5432/protein_outfitters';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const _moduleCache = new Map();

async function loadApiHandler(file) {
  if (_moduleCache.has(file)) return _moduleCache.get(file);
  const mod = await import(pathToFileURL(file).href);
  const handler = mod.default;
  if (typeof handler !== 'function') {
    throw new Error(`API module ${file} has no default (req,res) export`);
  }
  _moduleCache.set(file, handler);
  return handler;
}

// Resolve /api/<rest> to a real file inside API_ROOT, guarding against
// path traversal. Returns an absolute path or null.
function resolveApiFile(rest) {
  const clean = rest.replace(/\/+$/, '');
  const candidates = [
    path.join(API_ROOT, clean + '.js'),
    path.join(API_ROOT, clean, 'index.js'),
  ];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (!resolved.startsWith(API_ROOT + path.sep)) continue;
    if (fss.existsSync(resolved) && fss.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

// deploy/vercel.json rewrites (the two dynamic ones the app depends on).
function applyRewrites(pathname, search) {
  let m = pathname.match(/^\/farm\/([^/.]+)$/);
  if (m) return { pathname: '/api/farm-meta', search: mergeQuery(search, 'slug', m[1]) };
  m = pathname.match(/^\/p\/([^/.]+)$/);
  if (m) return { pathname: '/api/processor-meta', search: mergeQuery(search, 'slug', m[1]) };
  return { pathname, search };
}

function mergeQuery(search, key, value) {
  const usp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  usp.set(key, value);
  const s = usp.toString();
  return s ? '?' + s : '';
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  const tryPaths = [];
  const direct = path.resolve(path.join(STATIC_ROOT, rel));
  tryPaths.push(direct);
  // cleanUrls: extension-less path → .html
  if (!path.extname(rel)) {
    tryPaths.push(path.resolve(path.join(STATIC_ROOT, rel + '.html')));
    tryPaths.push(path.resolve(path.join(STATIC_ROOT, rel, 'index.html')));
  }

  for (const p of tryPaths) {
    if (!p.startsWith(STATIC_ROOT)) continue;
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) continue;
      const ext = path.extname(p).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Length', st.size);
      // Shared security headers from vercel.json.
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'HEAD') return res.end();
      return fss.createReadStream(p).pipe(res);
    } catch {
      /* try next candidate */
    }
  }
  return send(res, 404, notFoundHtml(rel), { 'Content-Type': 'text/html; charset=utf-8' });
}

function notFoundHtml(rel) {
  return `<!doctype html><meta charset="utf-8"><title>404</title>` +
    `<body style="font-family:system-ui;padding:3rem"><h1>404 — Not found</h1>` +
    `<p><code>${rel.replace(/</g, '&lt;')}</code> was not found in the local dev server.</p></body>`;
}

const server = http.createServer(async (req, res) => {
  const rawUrl = req.url || '/';
  const qIndex = rawUrl.indexOf('?');
  let pathname = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
  let search = qIndex === -1 ? '' : rawUrl.slice(qIndex);

  // Normalize duplicate slashes.
  pathname = pathname.replace(/\/{2,}/g, '/');

  // Apply the dynamic rewrites first.
  ({ pathname, search } = applyRewrites(pathname, search));

  const started = Date.now();
  const log = (status) =>
    console.log(`${req.method} ${pathname}${search ? search : ''} → ${status} (${Date.now() - started}ms)`);

  try {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const rest = pathname.slice('/api/'.length);
      const file = resolveApiFile(rest);
      if (!file) {
        log(404);
        return send(res, 404, JSON.stringify({ error: `No API route for /api/${rest}` }), {
          'Content-Type': 'application/json',
        });
      }
      // Hand the raw Node req/res to the function. nodejsHandler() reads
      // req.url (path+query), req.method, req.headers and streams the body.
      req.url = pathname + search;
      const handler = await loadApiHandler(file);
      res.on('finish', () => log(res.statusCode));
      return await handler(req, res);
    }

    res.on('finish', () => log(res.statusCode));
    return await serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[dev-server] error:', e);
    if (!res.headersSent) {
      send(res, 500, JSON.stringify({ error: e?.message || String(e) }), {
        'Content-Type': 'application/json',
      });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Protein Outfitters dev server`);
  console.log(`  static root : ${STATIC_ROOT}`);
  console.log(`  api root    : ${API_ROOT}`);
  console.log(`  listening   : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  database    : ${process.env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@')}`);
});
