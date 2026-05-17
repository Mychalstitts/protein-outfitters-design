// /api/upload — multipart/form-data with field "file"
// Stores in Vercel Blob, returns public URL. Auth required.
// Requires BLOB_READ_WRITE_TOKEN env var (set automatically when Vercel Blob is enabled).
//
// `@vercel/blob` is lazy-imported inside the handler — top-level import
// was hanging the cold start past Vercel's 10-12s cap on this project
// (every probe of /api/upload returned 000 timeout, even GET which only
// needs to reach the 405 branch). Same pattern donate-to-fund uses for
// Stripe. Module-level imports stay tiny so the function boots fast.
import { currentUser, err, json } from './_lib/db.js';

// Stays on nodejs — @vercel/blob's put() failed the edge build on this
// project specifically (bisect 2026-05-17, works on the secondary). Lazy
// import buys us a fast boot without flipping the runtime.
export const config = { runtime: 'nodejs' };

// PDFs added so /credentials can upload cert documents alongside images.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'POST only');
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  let form;
  try { form = await req.formData(); } catch { return err(400, 'Expected multipart/form-data'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return err(400, 'No file uploaded');

  if (!ALLOWED_TYPES.includes(file.type)) return err(400, 'Only JPEG/PNG/WebP/GIF images or PDFs allowed');
  if (file.size > 8 * 1024 * 1024) return err(400, 'Max 8 MB per file');

  // Slug-safe filename: userid/timestamp.ext
  const ext = (file.name || '').split('.').pop().slice(0, 5).replace(/[^a-z0-9]/gi, '')
            || (file.type === 'application/pdf' ? 'pdf' : 'jpg');
  const filename = `${user.id}/${Date.now()}.${ext.toLowerCase()}`;

  try {
    const { put } = await import('@vercel/blob');
    const blob = await put(filename, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type,
    });
    return json({ ok: true, url: blob.url, pathname: blob.pathname });
  } catch (e) {
    if (String(e).includes('BLOB_READ_WRITE_TOKEN')) {
      return err(500, 'Vercel Blob is not enabled. Enable it in your Vercel project Storage tab.');
    }
    return err(500, String(e).slice(0, 300));
  }
}
