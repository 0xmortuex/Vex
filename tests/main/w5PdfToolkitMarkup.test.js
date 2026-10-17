// T3-117: annotate, fill, sign (a signature picture) and compress, with real pdf-lib.
// pdf-lib is a declared dependency; in a worktree without it run with NODE_PATH pointing at a node_modules that has it.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../../src/main/pdf-toolkit.js');
const lib = require('pdf-lib');
const { validate } = require('../../src/main/ipc-schemas.js');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

// A 1x1 transparent PNG.
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

async function plain(n = 2) { const d = await lib.PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([300, 400]); return Buffer.from(await d.save()); }
async function withForm() {
  const d = await lib.PDFDocument.create();
  const p = d.addPage([300, 400]);
  const f = d.getForm();
  f.createTextField('full_name').addToPage(p, { x: 20, y: 340, width: 200, height: 20 });
  f.createCheckBox('agree').addToPage(p, { x: 20, y: 300, width: 14, height: 14 });
  const dd = f.createDropdown('city'); dd.addOptions(['Ankara', 'Izmir']); dd.addToPage(p, { x: 20, y: 260, width: 120, height: 20 });
  return Buffer.from(await d.save());
}
const contentOf = async (bytes, i = 0) => {
  const doc = await lib.PDFDocument.load(bytes);
  const page = doc.getPages()[i];
  const refs = page.node.Contents();
  const arr = refs.asArray ? refs.asArray() : [refs];
  return arr.map(r => Buffer.from(lib.decodePDFRawStream(doc.context.lookup(r)).decode()).toString('latin1')).join('\n');
};

describe('inspect', () => {
  it('lists page sizes and form fields with their kind', async () => {
    const r = await T.inspect(await withForm(), 'f.pdf');
    expect(r.pages).toEqual([{ w: 300, h: 400, rotation: 0 }]);
    expect(r.fields.map(f => [f.name, f.type])).toEqual([['full_name', 'text'], ['agree', 'checkbox'], ['city', 'dropdown']]);
    expect(r.fields[2].options).toEqual(['Ankara', 'Izmir']);
  });
});

describe('fill a form', () => {
  it('writes the answers, keeps them editable, or flattens them on request', async () => {
    const src = await withForm();
    const r = await T.fillForm(src, { values: { full_name: 'Ayse Yilmaz', agree: true, city: 'Izmir' } }, 'f.pdf');
    const after = await T.inspect(r.bytes, 'f.pdf');
    expect(after.fields.find(f => f.name === 'full_name').value).toBe('Ayse Yilmaz');
    expect(after.fields.find(f => f.name === 'agree').value).toBe(true);
    expect(after.fields.find(f => f.name === 'city').value).toBe('Izmir');
    const flat = await T.fillForm(src, { values: { full_name: 'Ayse' }, flatten: true }, 'f.pdf');
    expect((await T.inspect(flat.bytes, 'f.pdf')).fields).toEqual([]);
  });
  it('says plainly what is wrong', async () => {
    const src = await withForm();
    await expect(T.fillForm(src, { values: {} }, 'f.pdf')).rejects.toThrow(/at least one field/);
    await expect(T.fillForm(src, { values: { nope: 'x' } }, 'f.pdf')).rejects.toThrow(/no form field called "nope"/);
    await expect(T.fillForm(src, { values: { full_name: 'Ay\u015Fe' } }, 'f.pdf')).rejects.toThrow(/cannot draw/);
  });
  it('replaces the Turkish letters only when asked', async () => {
    const src = await withForm();
    const r = await T.fillForm(src, { values: { full_name: '\u015Eeng\u00FCl \u011E\u0131da' }, ascii: true }, 'f.pdf');
    expect((await T.inspect(r.bytes, 'f.pdf')).fields[0].value).toBe('Sengul Gida'.replace('Sengul', 'Seng\u00FCl'));
  });
});

describe('annotate and sign', () => {
  it('adds text, a highlight and a box and keeps the page count', async () => {
    const r = await T.annotate(await plain(2), { items: [
      { kind: 'text', page: 1, x: 0.1, y: 0.1, text: 'Checked', size: 14, color: 'red' },
      { kind: 'highlight', page: 2, x: 0.1, y: 0.2, w: 0.5, h: 0.05 },
      { kind: 'rect', page: 2, x: 0.1, y: 0.4, w: 0.3, h: 0.1, color: 'blue' },
    ] }, 'a.pdf');
    expect(r.marks).toBe(3);
    expect((await lib.PDFDocument.load(r.bytes)).getPageCount()).toBe(2);
    const content = await contentOf(r.bytes, 0);
    expect(content.toUpperCase()).toContain(Buffer.from('Checked').toString('hex').toUpperCase());
  });
  it('places a signature picture as an image on the page', async () => {
    const r = await T.annotate(await plain(1), { items: [{ kind: 'signature', page: 1, x: 0.5, y: 0.8, w: 0.3 }], signature: PNG }, 'a.pdf');
    expect(r.signed).toBe(1);
    const doc = await lib.PDFDocument.load(r.bytes);
    const res = doc.getPages()[0].node.Resources();
    expect(res.lookup(lib.PDFName.of('XObject'), lib.PDFDict).keys().length).toBe(1);
  });
  it('refuses a signature that is missing or not a PNG, and bad marks', async () => {
    const src = await plain(1);
    const sig = { kind: 'signature', page: 1, x: 0.1, y: 0.1, w: 0.2 };
    await expect(T.annotate(src, { items: [sig] }, 'a.pdf')).rejects.toThrow(/signature first/);
    await expect(T.annotate(src, { items: [sig], signature: new Uint8Array([1, 2, 3, 4]) }, 'a.pdf')).rejects.toThrow(/PNG/);
    await expect(T.annotate(src, { items: [] }, 'a.pdf')).rejects.toThrow(/at least one mark/);
    await expect(T.annotate(src, { items: [{ kind: 'text', page: 3, x: 0, y: 0, text: 'x' }] }, 'a.pdf')).rejects.toThrow(/page 3/);
    await expect(T.annotate(src, { items: [{ kind: 'text', page: 1, x: 2, y: 0, text: 'x' }] }, 'a.pdf')).rejects.toThrow(/outside the page/);
    await expect(T.annotate(src, { items: [{ kind: 'highlight', page: 1, x: 0.6, y: 0, w: 0.6, h: 0.1 }] }, 'a.pdf')).rejects.toThrow(/too wide/);
    await expect(T.annotate(src, { items: [{ kind: 'text', page: 1, x: 0, y: 0, text: '\u011F' }] }, 'a.pdf')).rejects.toThrow(/cannot draw/);
  });
  it('refuses a turned page rather than placing marks sideways', async () => {
    const d = await lib.PDFDocument.create(); d.addPage([300, 400]).setRotation(lib.degrees(90));
    await expect(T.annotate(Buffer.from(await d.save()), { items: [{ kind: 'text', page: 1, x: 0, y: 0, text: 'x' }] }, 'r.pdf')).rejects.toThrow(/turned/);
  });
});

describe('compress', () => {
  it('shrinks a bloated file, and says so when it cannot', async () => {
    const d = await lib.PDFDocument.create();
    for (let i = 0; i < 40; i++) { const p = d.addPage([300, 400]); p.drawText('Line ' + i, { x: 10, y: 10 }); }
    d.setTitle('t'.repeat(10));
    const big = Buffer.from(await d.save({ useObjectStreams: false }));
    const r = await T.compress(big, 'b.pdf');
    expect(r.after).toBeLessThan(r.before);
    expect((await lib.PDFDocument.load(r.bytes)).getPageCount()).toBe(40);
    await expect(T.compress(r.bytes, 'b.pdf')).rejects.toThrow(/already as compact/);
  });
});

describe('through the IPC handlers', () => {
  it('annotates a chosen file, saves where the person says, never over the input, and keeps the total cap', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-pdfm-'));
    try {
      const input = path.join(dir, 'in.pdf');
      fs.writeFileSync(input, await plain(1));
      const handlers = new Map();
      let savePath = path.join(dir, 'out.pdf');
      T.registerPdfToolkit({
        ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [input] }), showSaveDialog: async () => ({ canceled: false, filePath: savePath }) },
        windowFor: () => null,
      });
      const picked = await handlers.get('pdftool:pick-files')({});
      const token = picked.files[0].token;
      const info = await handlers.get('pdftool:inspect')({}, token);
      expect(info).toMatchObject({ ok: true, name: 'in.pdf', pages: [{ w: 300, h: 400 }] });
      const made = await handlers.get('pdftool:run')({}, { op: 'annotate', tokens: [token], items: [{ kind: 'text', page: 1, x: 0.1, y: 0.1, text: 'Hi' }] });
      expect(made.ok).toBe(true);
      expect(fs.existsSync(savePath)).toBe(true);
      savePath = input;
      const clash = await handlers.get('pdftool:run')({}, { op: 'compress', tokens: [token] });
      expect(clash.ok).toBe(false);
      expect(fs.readFileSync(input).length).toBeGreaterThan(0);
      expect((await handlers.get('pdftool:inspect')({}, 'f'.repeat(32))).ok).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('IPC contracts', () => {
  const token = 'a'.repeat(32);
  it('accepts the new operations and bounds their payloads', () => {
    expect(() => validate('pdftool:inspect', [token])).not.toThrow();
    expect(() => validate('pdftool:inspect', ['C:\\x.pdf'])).toThrow(/Invalid payload/);
    expect(() => validate('pdftool:run', [{ op: 'compress', tokens: [token] }])).not.toThrow();
    expect(() => validate('pdftool:run', [{ op: 'fill', tokens: [token], values: { a: 'b', c: true }, flatten: true }])).not.toThrow();
    expect(() => validate('pdftool:run', [{ op: 'annotate', tokens: [token], items: [{ kind: 'signature', page: 1, x: 0.1, y: 0.1, w: 0.2 }], signature: PNG }])).not.toThrow();
    expect(() => validate('pdftool:run', [{ op: 'annotate', tokens: [token], items: [{ kind: 'text', page: 1, x: 5, y: 0.1, text: 'x' }] }])).toThrow(/Invalid payload/);
    expect(() => validate('pdftool:run', [{ op: 'annotate', tokens: [token], items: [{ kind: 'script', page: 1, x: 0.1, y: 0.1 }] }])).toThrow(/Invalid payload/);
    expect(() => validate('pdftool:run', [{ op: 'annotate', tokens: [token], items: [{ kind: 'text', page: 1, x: 0.1, y: 0.1, text: 'x' }], signature: new Uint8Array(500 * 1024) }])).toThrow(/Invalid payload/);
    expect(() => validate('pdftool:run', [{ op: 'fill', tokens: [token], values: { a: 5 } }])).toThrow(/Invalid payload/);
  });
  it('is for Vex\'s own window only', () => {
    expect(UI_ONLY_CHANNELS.has('pdftool:inspect')).toBe(true);
  });
});
