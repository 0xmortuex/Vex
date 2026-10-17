// T3-117 (Wave 6): Turkish letters in a filled form and in marks, with an embedded system font (@pdf-lib/fontkit).
// Real pdf-lib; in a worktree without node_modules run with NODE_PATH pointing at one that has pdf-lib and @pdf-lib/fontkit.
import { describe, it, expect } from 'vitest';

const T = require('../../src/main/pdf-toolkit.js');
const F = require('../../src/main/pdf-fonts.js');
const lib = require('pdf-lib');

const NO_FONT = { fsImpl: { existsSync: () => false }, platform: 'linux' };
let sys = null;
try { sys = F.readSystemFont(); } catch { sys = null; }

async function withForm() {
  const d = await lib.PDFDocument.create();
  const p = d.addPage([300, 400]);
  d.getForm().createTextField('full_name').addToPage(p, { x: 20, y: 340, width: 200, height: 20 });
  return Buffer.from(await d.save());
}
async function plain() { const d = await lib.PDFDocument.create(); d.addPage([300, 400]); return Buffer.from(await d.save()); }
const fontNames = async (bytes) => {
  const doc = await lib.PDFDocument.load(bytes);
  const names = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    const d = o && (o.dict || o);
    if (d && typeof d.get === 'function' && String(d.get(lib.PDFName.of('Type'))) === '/Font') names.push(String(d.get(lib.PDFName.of('BaseFont')) || ''));
  }
  return names;
};

describe('Turkish letters', () => {
  it.skipIf(!sys)('a form answer keeps its letters and the file carries a subset of the system font', async () => {
    const r = await T.fillForm(await withForm(), { values: { full_name: 'Şengül Ğıda İstanbul' } }, 'f.pdf');
    expect((await T.inspect(r.bytes, 'f.pdf')).fields[0].value).toBe('Şengül Ğıda İstanbul');
    expect((await fontNames(r.bytes)).some(n => !/Helvetica/.test(n))).toBe(true);        // an embedded font is not the standard Helvetica
  });
  it.skipIf(!sys)('a text mark is drawn with the letters, and plain text on the same page still embeds nothing extra', async () => {
    const r = await T.annotate(await plain(), { items: [{ kind: 'text', page: 1, x: 0.1, y: 0.1, text: 'Ğı ş İ' }] }, 'a.pdf');
    expect(r.marks).toBe(1);
    expect((await fontNames(r.bytes)).some(n => !/Helvetica/.test(n))).toBe(true);
    const latin = await T.annotate(await plain(), { items: [{ kind: 'text', page: 1, x: 0.1, y: 0.1, text: 'Merhaba café' }], fonts: NO_FONT }, 'a.pdf');
    expect((await fontNames(latin.bytes)).some(n => !/Helvetica/.test(n))).toBe(false);   // WinAnsi text: standard Helvetica, nothing embedded
  });
  it('with no system font the refusal says so and names the way out', async () => {
    await expect(T.fillForm(await withForm(), { values: { full_name: 'Ayşe' }, fonts: NO_FONT }, 'f.pdf')).rejects.toThrow(/No system font[\s\S]*Replace letters the PDF font cannot draw/);
  });
  it('the choice to replace the letters still works and never looks for a font', async () => {
    const bad = { fsImpl: { existsSync: () => { throw new Error('must not look'); } } };
    const r = await T.fillForm(await withForm(), { values: { full_name: 'Şengül' }, ascii: true, fonts: bad }, 'f.pdf');
    expect((await T.inspect(r.bytes, 'f.pdf')).fields[0].value).toBe('Sengül');
  });
  it.skipIf(!sys)('a letter that no system font draws (Linear B) is refused, not dropped', async () => {
    await expect(T.annotate(await plain(), { items: [{ kind: 'text', page: 1, x: 0, y: 0, text: '𐀀' }] }, 'a.pdf')).rejects.toThrow(/cannot draw/);
  });
});
