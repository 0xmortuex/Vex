// The words inside a PDF. A PDF's text is in compressed streams full of
// operators, so this checks the parts that go wrong: escapes, kerning that
// stands for a space, streams that are pictures, and a file with no text at
// all (a scan), which has to come back empty rather than as rubbish.
import { describe, it, expect } from 'vitest';
const zlib = require('zlib');
const { extract, streams, textFromContent, unescapePdf } = require('../../src/main/pdf-text.js');

const inflate = (raw) => zlib.inflateSync(raw);

// A minimal PDF: one content stream, deflated, the way a writer produces it.
function pdfWith(content, { compress = true } = {}) {
  const body = compress ? zlib.deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj\n<< /Length ' + body.length + (compress ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n', 'latin1'),
    body,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

describe('escapes and operators', () => {
  it('undoes PDF’s own escapes', () => {
    expect(unescapePdf('a\\(b\\)c')).toBe('a(b)c');
    expect(unescapePdf('line\\nnext')).toBe('line\nnext');
    expect(unescapePdf('\\101\\102')).toBe('AB');
  });

  it('reads a plain string and a line broken up by kerning', () => {
    expect(textFromContent('BT (Hello world) Tj ET')).toBe('Hello world');
    expect(textFromContent('BT [(Hel) -20 (lo)] TJ ET')).toBe('Hello');
    expect(textFromContent('BT [(one) -400 (two)] TJ ET')).toBe('one two');
  });

  it('each line of the document is a line of the text', () => {
    expect(textFromContent('BT (first) Tj T* (second) Tj ET')).toBe('first\nsecond');
  });
});

describe('a whole file', () => {
  it('reads a compressed content stream', () => {
    const pdf = pdfWith('BT /F1 12 Tf (Invoice 2026-09) Tj T* (Total: 49.90) Tj ET');
    expect(extract(pdf, inflate)).toBe('Invoice 2026-09\nTotal: 49.90');
  });

  it('reads an uncompressed one too', () => {
    const pdf = pdfWith('BT (Plain stream) Tj ET', { compress: false });
    expect(extract(pdf, inflate)).toBe('Plain stream');
  });

  it('a scan of paper has no text, and comes back empty', () => {
    const image = Buffer.concat([
      Buffer.from('%PDF-1.4\n2 0 obj\n<< /Filter /DCTDecode /Width 100 >>\nstream\n', 'latin1'),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.from('\nendstream\nendobj', 'latin1'),
    ]);
    expect(extract(image, inflate)).toBe('');
  });

  it('a stream that will not inflate is skipped, not thrown over', () => {
    const broken = Buffer.concat([
      Buffer.from('%PDF-1.7\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
      Buffer.from('not actually deflate data', 'latin1'),
      Buffer.from('\nendstream', 'latin1'),
    ]);
    expect(() => extract(broken, inflate)).not.toThrow();
    expect(extract(broken, inflate)).toBe('');
  });

  it('several streams come out in the order they are in the file', () => {
    const one = zlib.deflateSync(Buffer.from('BT (page one) Tj ET', 'latin1'));
    const two = zlib.deflateSync(Buffer.from('BT (page two) Tj ET', 'latin1'));
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'), one,
      Buffer.from('\nendstream\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'), two,
      Buffer.from('\nendstream\n%%EOF', 'latin1'),
    ]);
    expect(extract(pdf, inflate)).toBe('page one\npage two');
    expect(streams(pdf, inflate)).toHaveLength(2);
  });
});
