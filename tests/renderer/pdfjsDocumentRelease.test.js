// In pdf.js 6 a document is let go through its loading task: PDFDocumentProxy has no destroy(). The print preview called doc.destroy(), which threw inside
// its close(), so the window could not be closed in the real app (2026-10-25); its tests used no real pdf.js and never saw it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

describe('letting go of a pdf.js document', () => {
  it('the installed pdf.js has no destroy() on a document, only on its loading task', () => {
    const lib = fs.readFileSync(path.join(ROOT, 'node_modules/pdfjs-dist/build/pdf.mjs'), 'utf8');
    const proxy = lib.slice(lib.indexOf('class PDFDocumentProxy'), lib.indexOf('class PDFPageProxy'));
    expect(proxy.length).toBeGreaterThan(1000);
    expect(/\n  (async )?destroy\(/.test(proxy)).toBe(false);
    const task = lib.slice(lib.indexOf('class PDFDocumentLoadingTask'));
    expect(/\n  (async )?destroy\(/.test(task.slice(0, 4000))).toBe(true);
  });

  it('no window code calls destroy() on a document', () => {
    const offenders = [];
    for (const dir of ['src/renderer/js', 'src/renderer/pdf-viewer', 'src/renderer/doc-viewer', 'src/renderer/office-viewer', 'src/renderer/image-viewer', 'src/renderer/media-viewer', 'src/renderer/folder-viewer']) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      for (const name of fs.readdirSync(full)) {
        if (!/\.m?js$/.test(name)) continue;
        const text = fs.readFileSync(path.join(full, name), 'utf8');
        if (/\b(?:doc|pdf|pdfDoc|old|s\.doc)\.destroy\(\)/.test(text)) offenders.push(dir + '/' + name);
      }
    }
    expect(offenders, 'files that call destroy() on a pdf.js document').toEqual([]);
  });

  it('the print preview releases a page set through its loading task', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/js/print-preview-ui.js'), 'utf8');
    expect(src).toContain('doc.loadingTask.destroy()');
  });
});
