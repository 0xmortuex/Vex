// ToolboxLib — the pure logic behind the built-in Toolbox tools.
import { describe, it, expect } from 'vitest';
import { ToolboxLib } from '../../src/renderer/js/toolbox.js';

describe('ToolboxLib base64', () => {
  it('round-trips unicode', () => {
    const s = 'Héllo, 世界! ✨';
    expect(ToolboxLib.b64dec(ToolboxLib.b64enc(s))).toBe(s);
  });
  it('returns null on invalid base64', () => {
    expect(ToolboxLib.b64dec('!!!not base64!!!')).toBeNull();
  });
});

describe('ToolboxLib timestamp', () => {
  it('treats 10-digit as seconds', () => {
    const d = ToolboxLib.tsToDate(1700000000);
    expect(d.getUTCFullYear()).toBe(2023);
  });
  it('treats 13-digit as ms', () => {
    const d = ToolboxLib.tsToDate(1700000000000);
    expect(d.getUTCFullYear()).toBe(2023);
  });
  it('dateToTs parses a date', () => {
    expect(ToolboxLib.dateToTs('2023-11-14T22:13:20Z')).toBe(1700000000);
  });
  it('rejects garbage', () => {
    expect(ToolboxLib.tsToDate('nope')).toBeNull();
    expect(ToolboxLib.dateToTs('nope')).toBeNull();
  });
});

describe('ToolboxLib uuid', () => {
  it('is a valid v4 shape', () => {
    expect(ToolboxLib.uuidv4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('ToolboxLib wordStats', () => {
  it('counts words/chars/reading time', () => {
    const s = ToolboxLib.wordStats('Hello world.  Foo bar baz!');
    expect(s.words).toBe(5);
    expect(s.sentences).toBe(2);
    expect(s.chars).toBe(26);
  });
  it('empty text is all zero', () => {
    const s = ToolboxLib.wordStats('');
    expect(s.words).toBe(0);
    expect(s.lines).toBe(0);
  });
});

describe('ToolboxLib color', () => {
  it('hex<->rgb', () => {
    expect(ToolboxLib.hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(ToolboxLib.hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(ToolboxLib.rgbToHex(255, 0, 0)).toBe('#ff0000');
  });
  it('contrast black/white is 21', () => {
    expect(ToolboxLib.contrast('#000000', '#ffffff')).toBe(21);
  });
  it('invalid hex -> null', () => {
    expect(ToolboxLib.hexToRgb('zzz')).toBeNull();
  });
});

describe('ToolboxLib csv', () => {
  it('parses quoted fields with commas', () => {
    const rows = ToolboxLib.csvToRows('a,b\n"x,y",z');
    expect(rows).toEqual([['a', 'b'], ['x,y', 'z']]);
  });
  it('handles escaped quotes', () => {
    const rows = ToolboxLib.csvToRows('"he said ""hi"""');
    expect(rows[0][0]).toBe('he said "hi"');
  });
});

describe('ToolboxLib cron', () => {
  it('describes common expressions', () => {
    expect(ToolboxLib.cronDescribe('* * * * *')).toContain('every minute');
    expect(ToolboxLib.cronDescribe('*/15 * * * *')).toContain('every 15 minutes');
    expect(ToolboxLib.cronDescribe('bad')).toBeNull();
  });
  it('computes next runs', () => {
    const from = new Date('2026-01-01T00:00:00');
    const next = ToolboxLib.cronNext('0 12 * * *', 2, from);
    expect(next.length).toBe(2);
    expect(next[0].getHours()).toBe(12);
    expect(next[0].getMinutes()).toBe(0);
  });
});

describe('ToolboxLib jwt/case/pass/markdown', () => {
  it('decodes a JWT header+payload', () => {
    const tok = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiQSJ9.sig';
    const d = ToolboxLib.jwtDecode(tok);
    expect(d.header.alg).toBe('HS256');
    expect(d.payload.sub).toBe('123');
  });
  it('rejects a non-JWT', () => { expect(ToolboxLib.jwtDecode('nope')).toBeNull(); });
  it('converts case', () => {
    expect(ToolboxLib.caseConvert('hello world', 'upper')).toBe('HELLO WORLD');
    expect(ToolboxLib.caseConvert('hello world', 'snake')).toBe('hello_world');
    expect(ToolboxLib.caseConvert('hello world', 'camel')).toBe('helloWorld');
    expect(ToolboxLib.caseConvert('hello world', 'kebab')).toBe('hello-world');
    expect(ToolboxLib.caseConvert('hello world', 'constant')).toBe('HELLO_WORLD');
  });
  it('generates a password of the right length from the pool', () => {
    const pw = ToolboxLib.passGen(20, { upper: false, lower: true, digits: false, symbols: false });
    expect(pw.length).toBe(20);
    expect(/^[abcdefghijkmnpqrstuvwxyz]+$/.test(pw)).toBe(true);
  });
  it('renders basic markdown safely', () => {
    const src = ['# Hi', '', '**b** and <script>'].join(String.fromCharCode(10));
    const h = ToolboxLib.mdToHtml(src);
    expect(h).toContain('<h1>Hi</h1>');
    expect(h).toContain('<strong>b</strong>');
    expect(h).toContain('&lt;script&gt;');
  });
});
