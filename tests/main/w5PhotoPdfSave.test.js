// T3-105: the photo preparer may now save the one-page PDF it builds, and only a real PDF under a .pdf name.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const pp = require('../../src/main/photo-prep.js');

const pdf = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1'));

describe('photoprep:save with a PDF', () => {
  it('writes a PDF to a .pdf name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vexpp-'));
    try {
      const out = path.join(dir, 'scan.pdf');
      const r = await pp.savePicture({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: out }) }, bytes: pdf, suggestedName: 'scan.pdf' });
      expect(r.bytes).toBe(pdf.length);
      expect(fs.readFileSync(out).slice(0, 5).toString()).toBe('%PDF-');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('refuses bytes that are not a PDF under a .pdf name', async () => {
    await expect(pp.savePicture({ dialog: {}, bytes: new Uint8Array([1, 2, 3]), suggestedName: 'x.pdf' })).rejects.toThrow(/not a PDF/);
  });
  it('refuses a picture saved under a .pdf name typed in the dialog, and a PDF saved as a picture', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vexpp-'));
    try {
      const asPdf = path.join(dir, 'a.pdf');
      await expect(pp.savePicture({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: asPdf }) }, bytes: new Uint8Array([1]), suggestedName: 'a.jpg' })).rejects.toThrow(/\.jpg or \.png/);
      const asJpg = path.join(dir, 'a.jpg');
      await expect(pp.savePicture({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: asJpg }) }, bytes: pdf, suggestedName: 'a.pdf' })).rejects.toThrow(/\.jpg or \.png/);
      expect(fs.existsSync(asPdf) || fs.existsSync(asJpg)).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
