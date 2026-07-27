// /api/upload — multipart/form-data with field "file"
// Stores the file in Vercel Blob, returns public URL. Auth required.
// Requires BLOB_READ_WRITE_TOKEN env var (set automatically when Vercel Blob is enabled).
//
// Accepts images (JPEG/PNG/WebP/GIF) *and* PDFs — /credentials advertises
// accept="application/pdf,image/*" for inspection certificates, licences and
// insurance docs, so a PDF-only upload path is required there.
import { put } from '@vercel/blob';
import { currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

// mime → canonical extension, used when the browser hands us a file with no
// usable extension in its name (common for scanner/"Share to" uploads). Without
// this a PDF would have been stored as `.jpg` and served as a broken image.
const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'POST only');
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  let form;
  try { form = await req.formData(); } catch { return err(400, 'Expected multipart/form-data'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return err(400, 'No file uploaded');

  // Light validation
  const contentType = (file.type || '').toLowerCase().split(';')[0].trim();
  if (!Object.prototype.hasOwnProperty.call(EXT_BY_MIME, contentType)) {
    return err(400, 'Only JPEG/PNG/WebP/GIF images or PDF documents allowed');
  }
  // 8 MB covers a multi-page scanned certificate comfortably, and Vercel caps a
  // serverless request body at 4.5 MB anyway, so raising it further would only
  // change which error the user sees. Left as-is for both images and PDFs.
  if (file.size > 8 * 1024 * 1024) return err(400, 'Max 8 MB per file');

  // Slug-safe filename: userid/timestamp.ext — fall back to the extension the
  // MIME type implies rather than a hardcoded 'jpg', and never let a .pdf keep
  // an image extension (or vice versa) if the client lied about the name.
  const fallbackExt = EXT_BY_MIME[contentType];
  const nameExt = (file.name || '').includes('.')
    ? (file.name || '').split('.').pop().slice(0, 5).replace(/[^a-z0-9]/gi, '').toLowerCase()
    : '';
  const isPdf = contentType === 'application/pdf';
  const ext = (isPdf ? (nameExt === 'pdf' ? 'pdf' : fallbackExt)
                     : (nameExt && nameExt !== 'pdf' ? nameExt : fallbackExt));
  const filename = `${user.id}/${Date.now()}.${ext}`;

  try {
    // contentType is echoed back on the blob URL, so PDFs are served as
    // application/pdf and render in the browser's viewer instead of downloading
    // as an opaque octet-stream. Nothing downstream inspects image dimensions
    // or generates thumbnails — consumers (credentials.html, avatar/cover
    // fields) just store the returned URL — so no image-only work is skipped.
    const blob = await put(filename, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType
    });
    return json({ ok: true, url: blob.url, pathname: blob.pathname, content_type: contentType, kind: isPdf ? 'pdf' : 'image' });
  } catch (e) {
    if (String(e).includes('BLOB_READ_WRITE_TOKEN')) {
      return err(500, 'Vercel Blob is not enabled. Enable it in your Vercel project Storage tab.');
    }
    return err(500, String(e).slice(0, 300));
  }
}

export default nodejsHandler(handler);
