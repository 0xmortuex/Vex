// Where Ctrl+P goes. A PDF shown in Vex's own viewer prints through the viewer (the document's pages, with its marks); the print preview would have
// shown the viewer's page with its toolbar (found in the real app, 2026-10-25, when the print preview and the PDF viewer were merged).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/webview.js'), 'utf8').replace(/\r\n/g, '\n');

describe('printPage', () => {
  const at = src.indexOf('  printPage(wv = this.getActiveWebview()) {');
  const body = src.slice(at, src.indexOf('\n  },', at));
  it('sends a PDF in Vex\'s own viewer to the viewer\'s own print before the preview is considered', () => {
    expect(at).toBeGreaterThan(-1);
    const toViewer = body.indexOf("this.pdfPage(wv)) { wv.send('pdfview:command', 'print'); return; }");
    const preview = body.indexOf('VexPrintPreview.open(wv)');
    expect(toViewer).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(toViewer);
  });
});
