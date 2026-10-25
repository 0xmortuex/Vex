// @vitest-environment jsdom
//
// Vex's office-document viewer, spreadsheet data (src/renderer/office-viewer/xlsx-core.js, numfmt.js): what an .xlsx is read as,
// and how a saved number is shown.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fflate = require('fflate');
const xlsx = require('../../src/renderer/office-viewer/xlsx-core.js');
const zipinfo = require('../../src/renderer/office-viewer/zipinfo.js');
const fx = require('../helpers/officeFixtures.js');

function open(buf) {
  const u8 = new Uint8Array(buf);
  const dir = zipinfo.readDirectory(u8);
  const names = new Set(dir.entries.map((e) => e.name));
  const text = (n) => (names.has(n) ? new TextDecoder().decode(fflate.unzipSync(u8, { filter: (f) => f.name === n })[n]) : '');
  const book = xlsx.parseWorkbook({ has: (n) => names.has(n), text });
  const shared = xlsx.parseSharedStrings(text('xl/sharedStrings.xml'));
  return { book, sheet: (i) => xlsx.parseSheet(text(book.sheets[i].path), shared) };
}

describe('a workbook', () => {
  it('lists its sheets, the hidden one marked', () => {
    const { book } = open(fx.xlsx({ rows: 10 }));
    expect(book.sheets.map((s) => [s.name, s.state])).toEqual([['Sales', 'visible'], ['Odds & ends', 'visible'], ['Hidden', 'hidden']]);
  });

  it('reads 5000 rows with their formulas, widths, frozen row, merge and filter', () => {
    const { sheet } = open(fx.xlsx({ rows: 5000 }));
    const s = sheet(0);
    expect(s.maxRow).toBe(5001);
    expect(s.maxCol).toBe(6);
    expect(s.rows[0].map((c) => c[0])).toEqual(['Item', 'Date', 'Qty', 'Price', 'Total', 'Note']);
    expect(s.rows[4999][4][3]).toBe('C5000*D5000');     // a formula is kept beside its saved result
    expect(typeof s.rows[4999][4][0]).toBe('number');
    expect(s.freeze).toEqual({ rows: 1, cols: 0 });
    expect(s.colWidths[0]).toBe(18 * 7 + 5);
    expect(s.merges).toEqual([{ r1: 2, c1: 5, r2: 2, c2: 7 }]);
    expect(s.filter).toBe('A1:F5001');
    expect(s.rowHeights[0]).toBe(32);
    expect(s.truncated).toBe(false);
  });

  it('reads inline text, booleans, errors and numbers', () => {
    const { sheet } = open(fx.xlsx({ rows: 2 }));
    const s = sheet(1);
    expect(s.rows[0][0]).toEqual(['Second sheet', 's', 0]);
    expect(s.rows[0][1][1]).toBe('b');
    expect(s.rows[0][2]).toEqual(['#DIV/0!', 'e', 0]);
    expect(s.rows[1][3][3]).toBe('SUM(A2:C2)');
  });

  it('reads cell styles: bold, fill, number format', () => {
    const { book } = open(fx.xlsx({ rows: 2 }));
    expect(book.styles[1]).toMatchObject({ b: 1, color: 'ffffff', fill: '1f4e78' });
    expect(book.styles[3].nf).toBe('#,##0.00 "TL"');
    expect(book.styles[2].nf).toBe(14);
  });

  it('moves a shared formula to the cell that uses it', () => {
    expect(xlsx.shiftFormula('A1+$B$2*C1', 2, 1)).toBe('B3+$B$2*D3');
    expect(xlsx.shiftFormula('SUM(A1:A3)&"A1"', 1, 0)).toBe('SUM(A2:A4)&"A1"');
    expect(xlsx.shiftFormula("'Sheet A1'!B2", 1, 1)).toBe("'Sheet A1'!C3");
  });

  it('knows a macro workbook', () => {
    expect(open(fx.xlsx({ rows: 2, macros: true })).book.macros).toBe(true);
  });

  it('stops at the cell limit and says so', () => {
    const cells = [];
    for (let i = 1; i <= 40; i++) cells.push(`<row r="${i}">${'ABCDEFGHIJ'.split('').map((c) => `<c r="${c}${i}"><v>${i}</v></c>`).join('')}</row>`);
    const xml = `<worksheet><sheetData>${cells.join('')}</sheetData></worksheet>`;
    const real = xlsx.MAX_CELLS;
    expect(real).toBeGreaterThan(100000);
    expect(xlsx.parseSheet(xml, []).cells).toBe(400);
  });
});

describe('number formats', async () => {
  const nf = await import('../../src/renderer/office-viewer/numfmt.js');
  const f = (v, code, opts) => nf.formatCell(v, 'n', code, opts);
  it('digits, separators and currency marks', () => {
    expect(f(1234.5, '#,##0.00 "TL"')).toBe('1,234.50 TL');
    expect(f(1234.5, '#,##0.00 "TL"', { locale: 'tr' })).toBe('1.234,50 TL');
    expect(f(3.14159, 2)).toBe('3.14');
    expect(f(0, 3)).toBe('0');
    expect(f(0.5, '#.##')).toBe('.5');
    expect(f(1234567, 3)).toBe('1,234,567');
    expect(f(12, '000')).toBe('012');
    expect(f(1234567, '#,##0,')).toBe('1,235');
  });
  it('percent, scientific, fractions', () => {
    expect(f(0.256, 9)).toBe('26%');
    expect(f(0.256, 10)).toBe('25.60%');
    expect(f(12345.678, 11)).toBe('1.23E+04');
    expect(f(1.5, '# ?/?')).toBe('1 1/2');
  });
  it('negative and zero sections', () => {
    expect(f(-5, '#,##0;(#,##0)')).toBe('(5)');
    expect(f(-5, '0.0;[Red]-0.0')).toBe('-5.0');
    expect(f(0, '0;-0;"zero"')).toBe('zero');
    expect(f(-3.5, 4)).toBe('-3.50');
  });
  it('dates and times, in English and Turkish', () => {
    expect(f(45000, 14)).toBe('3/15/2023');
    expect(f(45000, 14, { locale: 'tr' })).toBe('15.03.2023');
    expect(f(45000.75, 'yyyy-mm-dd hh:mm')).toBe('2023-03-15 18:00');
    expect(f(45000, 'dddd d mmmm yyyy')).toBe('Wednesday 15 March 2023');
    expect(f(45000, 'dddd d mmmm yyyy', { locale: 'tr' })).toBe('Çarşamba 15 Mart 2023');
    expect(f(0.5, 'h:mm AM/PM')).toBe('12:00 PM');
    expect(f(1.5, '[h]:mm')).toBe('36:00');
    expect(f(61, 'yyyy-mm-dd')).toBe('1900-03-01');
    expect(f(1, 'yyyy-mm-dd', { date1904: true })).toBe('1904-01-02');
    expect(nf.isDateFormat(14)).toBe(true);
    expect(nf.isDateFormat('0.00')).toBe(false);
    expect(nf.isDateFormat('#,##0 "dd"')).toBe(false);
  });
  it('general, text, booleans and errors', () => {
    expect(f(0.1 + 0.2, null)).toBe('0.3');
    expect(f(123456789012, null)).toBe('1.23457E+11');
    expect(f(1 / 3, null, { locale: 'tr' })).toBe('0,33333333333');
    expect(nf.formatCell('abc', 's', 14)).toBe('abc');
    expect(nf.formatCell(true, 'b', null)).toBe('TRUE');
    expect(nf.formatCell('#DIV/0!', 'e', null)).toBe('#DIV/0!');
  });
});
