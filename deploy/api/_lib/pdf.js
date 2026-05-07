// Shared helpers for generating PDFs server-side via pdfkit.
//
// Why pdfkit, not Puppeteer:
//   - No Chromium dependency = small cold starts
//   - Pure Node, runs anywhere a Node serverless runtime runs
//   - Streams the PDF directly to the response body (no tempfile dance)
//
// All exports return a Node Readable stream you can pipe to a Response body
// or convert to a Buffer for attaching to an email.
//
// NOTE: pdfkit is loaded *lazily* inside pdfToBuffer because a top-level
// `import PDFDocument from 'pdfkit'` was crashing the function with
// FUNCTION_INVOCATION_FAILED in production whenever Vercel's nft tracer
// didn't bundle pdfkit's Helvetica.afm font. Dynamic import gives us a
// real, catchable error instead of a generic invocation failure.

// Brand constants — match the rest of the site.
const BRAND = {
  ink: '#061b0e',
  ink2: '#1a2118',
  ink3: '#5a6359',
  brand: '#7da05d',
  surface: '#fbf9f5',
};

// US Letter is 612 x 792 pt; we keep generous margins for legibility.
const PAGE = { size: 'LETTER', margin: 64 };

// Convenience: build a PDF and resolve to a Buffer (used when emailing).
export async function pdfToBuffer(buildFn) {
  // Lazy-load pdfkit so a missing-font / require-resolution failure surfaces
  // as a normal thrown error instead of a top-level module-init crash.
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(PAGE);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      buildFn(doc);
      doc.end();
    } catch (e) { reject(e); }
  });
}

// Build a Response object that streams a PDF.
export function pdfResponse(buildFn, filename = 'document.pdf', { disposition = 'inline' } = {}) {
  // We buffer because Vercel's edge/node response models prefer a body that's
  // either a string, ArrayBuffer, ReadableStream, or Buffer. Buffer is simplest.
  return pdfToBuffer(buildFn).then((buf) => {
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(buf.length),
        'Content-Disposition': `${disposition}; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}

// ─── Reusable building blocks ─────────────────────────────────────────

export function header(doc, { title, subtitle }) {
  // Wordmark
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND.brand).text('PROTEIN OUTFITTERS', { characterSpacing: 1.2 });
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(BRAND.ink).text(title);
  if (subtitle) {
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(11).fillColor(BRAND.ink3).text(subtitle);
  }
  doc.moveDown(1);
  // Hairline
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.strokeColor(BRAND.ink).lineWidth(0.5).moveTo(x, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
  doc.moveDown(1);
}

export function footer(doc, { footnote }) {
  // Pin to bottom of page
  const bottomY = doc.page.height - doc.page.margins.bottom + 14;
  doc.strokeColor(BRAND.ink3).lineWidth(0.4).moveTo(doc.page.margins.left, bottomY).lineTo(doc.page.width - doc.page.margins.right, bottomY).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(BRAND.ink3)
     .text(
       footnote || 'Protein Outfitters · Bemidji, MN · hello@proteinoutfitters.com · proteinoutfitters.com',
       doc.page.margins.left, bottomY + 6,
       { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' }
     );
}

export function paragraph(doc, text, opts = {}) {
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(opts.size || 11)
     .fillColor(opts.color || BRAND.ink2)
     .text(text, { lineGap: 3, ...opts });
  doc.moveDown(0.6);
}

export function fieldGrid(doc, rows) {
  // rows is [[label, value], ...]
  const labelWidth = 160;
  const lineHeight = 18;
  const startY = doc.y;
  const startX = doc.page.margins.left;
  rows.forEach(([label, value], i) => {
    const y = startY + i * lineHeight;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.ink3).text(label, startX, y, { width: labelWidth });
    doc.font('Helvetica').fontSize(10).fillColor(BRAND.ink).text(String(value || '—'), startX + labelWidth, y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - labelWidth });
  });
  doc.y = startY + rows.length * lineHeight + 8;
}

export function signatureBlock(doc, { lines = ['Signature', 'Date'] }) {
  doc.moveDown(2);
  const x = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const colWidth = (right - x - 24) / 2;
  const y = doc.y;
  lines.forEach((label, i) => {
    const cx = x + i * (colWidth + 24);
    doc.strokeColor(BRAND.ink).lineWidth(0.5).moveTo(cx, y + 22).lineTo(cx + colWidth, y + 22).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.ink3).text(label, cx, y + 26, { width: colWidth });
  });
  doc.y = y + 50;
}

export { BRAND, PAGE };
