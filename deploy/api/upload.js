// /api/upload — multipart/form-data with field "file"
// Stores image in Vercel Blob, returns public URL. Auth required.
// Requires BLOB_READ_WRITE_TOKEN env var (set automatically when Vercel Blob is enabled).
import { put } from '@vercel/blob';
import { currentUser, err, json } from './_lib/db.js';

// Edge runtime — req.formData() + @vercel/blob put() are both Web-Standard.
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'POST only');
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  let form;
  try { form = await req.formData(); } catch { return err(400, 'Expected multipart/form-data'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return err(400, 'No file uploaded');

  // Light validation
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) return err(400, 'Only JPEG/PNG/WebP/GIF images allowed');
  if (file.size > 8 * 1024 * 1024) return err(400, 'Max 8 MB per image');

  // Slug-safe filename: userid/timestamp-name.ext
  const ext = (file.name || '').split('.').pop().slice(0, 5).replace(/[^a-z0-9]/gi, '') || 'jpg';
  const filename = `${user.id}/${Date.now()}.${ext.toLowerCase()}`;

  try {
    const blob = await put(filename, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type
    });
    return json({ ok: true, url: blob.url, pathname: blob.pathname });
  } catch (e) {
    if (String(e).includes('BLOB_READ_WRITE_TOKEN')) {
      return err(500, 'Vercel Blob is not enabled. Enable it in your Vercel project Storage tab.');
    }
    return err(500, String(e).slice(0, 300));
  }
}
