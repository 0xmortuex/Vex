// Datasets kept from page tables (Wave 5): the pure rules (src/renderer/js/evodata-core.js), the files
// (src/main/evodata-datasets-store.js) on a real temp folder, and the IPC wiring (src/main/evodata-ipc.js).
// Deterministic: no clock (every time is passed in), no network, no Electron, nothing outside a fresh temp folder.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const C = require('../../src/renderer/js/evodata-core.js');
const { createDatasetStore } = require('../../src/main/evodata-datasets-store.js');
const { registerDatasets } = require('../../src/main/evodata-ipc.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const policy = require('../../src/main/ipc-policy.js');

const quiet = { error() {}, warn() {}, log() {} };

describe('numbers', () => {
  it('reads English and Turkish number formats, and refuses what is not one', () => {
    const cases = [
      ['1,234.56', 1234.56], ['1.234,56', 1234.56], ['12,50', 12.5], ['12.5', 12.5], ['1.234', 1234], ['0.500', 0.5],
      ['1.234.567', 1234567], ['45%', 45], ['-5', -5], ['+7', 7], ['  3 ', 3],
    ];
    for (const [text, n] of cases) expect(C.parseNumber(text), text).toBe(n);
    for (const text of ['', 'abc', '12.05.2024', '1,2,3', '--5', '1.', '12 apples', '1.2.3']) expect(C.parseNumber(text), text).toBeNull();
  });
});

describe('columns are inferred', () => {
  it('takes a header row of words, and names the columns after it', () => {
    const r = C.inferColumns([['Name', 'Price'], ['Ali', '12,5'], ['Veli', '3']]);
    expect(r.header).toBe(true);
    expect(r.columns).toEqual([{ name: 'Name', type: 'text' }, { name: 'Price', type: 'number' }]);
    expect(r.body).toEqual([['Ali', '12,5'], ['Veli', '3']]);
  });
  it('does not take a first row with a number in it as a header', () => {
    const r = C.inferColumns([['Ali', '12'], ['Veli', '3']]);
    expect(r.header).toBe(false);
    expect(r.columns.map(c => c.name)).toEqual(['Column 1', 'Column 2']);
    expect(r.body.length).toBe(2);
  });
  it('can be told the first row is, or is not, a header', () => {
    expect(C.inferColumns([['Ali', 'Veli'], ['a', 'b']], { header: false }).body.length).toBe(2);
    expect(C.inferColumns([['1', '2'], ['a', 'b']], { header: true }).columns.map(c => c.name)).toEqual(['1', '2']);
  });
  it('makes blank and repeated column names unique, and pads short rows', () => {
    const r = C.inferColumns([['Price', 'Price', ''], ['1', '2'], ['3']], { header: true });
    expect(r.columns.map(c => c.name)).toEqual(['Price', 'Price (2)', 'Column 3']);
    expect(r.body).toEqual([['1', '2', ''], ['3', '', '']]);
  });
  it('a column is a number only when every filled cell is one', () => {
    expect(C.columnType(['1', '', '2,5'])).toBe('number');
    expect(C.columnType(['1', 'x'])).toBe('text');
    expect(C.columnType(['', ''])).toBe('text');
  });
  it('refuses nothing to keep, and rows that are not a list', () => {
    expect(() => C.inferColumns([])).toThrow(/no rows/);
    expect(() => C.inferColumns('x')).toThrow(/no rows/);
  });
});

describe('a dataset is created, de-duplicated and capped', () => {
  const rows = [['Name', 'City'], ['Ali', 'Izmir'], ['ALİ', 'Ankara'], ['Veli', '']];
  it('keeps one row per key, comparing Turkish letters properly', () => {
    const { dataset, duplicates } = C.createDataset({ name: 'People', rows, keyColumn: 'name', id: 'd1', now: 5 });
    expect(dataset.rows.map(r => r[0])).toEqual(['Ali', 'Veli']);
    expect(duplicates).toBe(1);
    expect(dataset.keyColumn).toBe('Name');
    expect(dataset.createdAt).toBe(5);
  });
  it('treats dotless and dotted i as different letters, as Turkish does', () => {
    const { dataset } = C.createDataset({ name: 'x', rows: [['K'], ['Isık'], ['ISIK'], ['isik'], ['İSİK']], keyColumn: 'K', id: 'd1' });
    // I and ı are one letter, i and İ are another: the second row repeats the first, the fourth repeats the third.
    expect(dataset.rows.map(r => r[0])).toEqual(['Isık', 'isik']);
  });
  it('without a key column, identical rows are kept once', () => {
    const { dataset } = C.createDataset({ name: 'x', rows: [['A', 'B'], ['1', '2'], ['1', '2'], ['1', '3']], id: 'd1' });
    expect(dataset.rows).toEqual([['1', '2'], ['1', '3']]);
    expect(dataset.keyColumn).toBeNull();
  });
  it('a blank key never counts as a repeat', () => {
    const { dataset } = C.createDataset({ name: 'x', rows: [['K', 'V'], ['', '1'], ['', '2'], ['a', '3']], keyColumn: 'K', id: 'd1' });
    expect(dataset.rows.length).toBe(3);
  });
  it('keeps the address of the page without a sign-in part or a #fragment, and no address that is not a web page', () => {
    const make = (url) => C.createDataset({ name: 'x', rows: [['A'], ['b']], header: true, source: { url, title: 'T' }, id: 'd1' }).dataset.source.url;
    expect(make('https://user:pw@example.com/p?q=1#frag')).toBe('https://example.com/p?q=1');
    expect(make('file:///C:/secret.html')).toBe('');
    expect(make('not a url')).toBe('');
  });
  it('needs a name and a real key column', () => {
    expect(() => C.createDataset({ name: '   ', rows, id: 'd1' })).toThrow(/needs a name/);
    expect(() => C.createDataset({ name: 'x', rows, keyColumn: 'nope', id: 'd1' })).toThrow(/no column called "nope"/);
  });
  it('caps the rows at 5,000 and says how many did not fit', () => {
    const many = [['N']].concat(Array.from({ length: 5003 }, (_, i) => ['n' + i]));
    const r = C.createDataset({ name: 'big', rows: many, header: true, id: 'd1' });
    expect(r.dataset.rows.length).toBe(5000);
    expect(r.capped).toBe(3);
  });
  it('caps the size at 5 MB', () => {
    const wide = [['K', 'V']].concat(Array.from({ length: 4000 }, (_, i) => ['k' + i, 'x'.repeat(2000)]));
    const r = C.createDataset({ name: 'wide', rows: wide, header: true, id: 'd1' });
    expect(r.dataset.rows.length).toBeLessThan(4000);
    expect(C.datasetBytes(r.dataset)).toBeLessThanOrEqual(C.LIMITS.bytes);
    expect(r.capped).toBe(4000 - r.dataset.rows.length);
  });
  it('can start with only a header (the dataset a page watch fills)', () => {
    const r = C.createDataset({ name: 'w', rows: [['Captured at', 'Value']], header: true, allowEmpty: true, watchId: 'w_1', id: 'd1' });
    expect(r.dataset.rows).toEqual([]);
    expect(r.dataset.watchId).toBe('w_1');
    expect(() => C.createDataset({ name: 'w', rows: [['Captured at', 'Value']], header: true, id: 'd1' })).toThrow();
  });
});

describe('rows are appended', () => {
  const make = () => C.createDataset({ name: 'People', rows: [['Name', 'Age'], ['Ali', '30'], ['Veli', '41']], keyColumn: 'Name', id: 'd1', now: 1 }).dataset;
  it('adds new keys, skips old ones and a repeated header, and fits the shape', () => {
    const r = C.appendRows(make(), [['Name', 'Age'], ['ali', '99'], ['Zeki'], ['Can', '5', 'extra']], { now: 9 });
    expect(r.added).toBe(2);
    expect(r.skipped).toBe(2);
    expect(r.dataset.rows).toEqual([['Ali', '30'], ['Veli', '41'], ['Zeki', ''], ['Can', '5']]);
    expect(r.dataset.updatedAt).toBe(9);
  });
  it('does not change the dataset it was given', () => {
    const d = make();
    C.appendRows(d, [['Zeki', '1']]);
    expect(d.rows.length).toBe(2);
  });
  it('a different key column can be chosen, and is remembered', () => {
    const r = C.appendRows(make(), [['Ali', '31'], ['Can', '30']], { keyColumn: 'Age' });
    expect(r.dataset.keyColumn).toBe('Age');
    expect(r.added).toBe(1);
    expect(r.dataset.rows.map(x => x[0])).toEqual(['Ali', 'Veli', 'Ali']);
  });
  it('a key column can be cleared (whole-row de-dupe)', () => {
    const r = C.appendRows(make(), [['Ali', '31']], { keyColumn: '' });
    expect(r.dataset.keyColumn).toBeNull();
    expect(r.added).toBe(1);
  });
  it('refuses a key column that does not exist', () => {
    expect(() => C.appendRows(make(), [['a', 'b']], { keyColumn: 'Nope' })).toThrow(/no column/);
  });
  it('a full dataset refuses the rest and drops nothing old', () => {
    const d = make();
    d.rows = Array.from({ length: 4999 }, (_, i) => ['n' + i, '1']);
    const r = C.appendRows(d, [['a1', '1'], ['a2', '1'], ['a3', '1']]);
    expect(r.added).toBe(1);
    expect(r.capped).toBe(2);
    expect(r.dataset.rows.length).toBe(5000);
    expect(r.dataset.rows[0]).toEqual(['n0', '1']);
  });
  it('the type of a column follows its rows', () => {
    const r = C.appendRows(make(), [['Zeki', 'unknown']]);
    expect(r.dataset.columns[1].type).toBe('text');
  });
});

describe('CSV is safe to open in a spreadsheet', () => {
  it('puts a quote mark in front of a cell that would run as a formula', () => {
    expect(C.csvCell('=1+1')).toBe("'=1+1");
    expect(C.csvCell('+1+1')).toBe("'+1+1");
    expect(C.csvCell('-1+1')).toBe("'-1+1");
    expect(C.csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(C.csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(C.csvCell('\t=1')).toBe("'\t=1");
    expect(C.csvCell('+90 555 123 45 67')).toBe("'+90 555 123 45 67");
  });
  it('leaves a plain number alone, negative ones included', () => {
    for (const n of ['-5', '+3', '-12.5', '42', '3.14']) expect(C.csvCell(n), n).toBe(n);
    expect(C.csvCell('-1.234,56', ';')).toBe('-1.234,56');
  });
  it('quotes a field with the delimiter, a quote or a line break, and doubles the quotes', () => {
    expect(C.csvCell('a,b')).toBe('"a,b"');
    expect(C.csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(C.csvCell('one\ntwo')).toBe('"one\ntwo"');
    expect(C.csvCell('one\r\ntwo')).toBe('"one\r\ntwo"');
    expect(C.csvCell('plain')).toBe('plain');
  });
  it('with a semicolon delimiter (Turkish Excel) it is the semicolon that is quoted', () => {
    expect(C.csvCell('a;b', ';')).toBe('"a;b"');
    expect(C.csvCell('a,b', ';')).toBe('a,b');
    expect(C.csvCell('1,5', ';')).toBe('1,5');
  });
  it('a header cell is neutralised too, lines end \\r\\n, and a file starts with a byte-order mark', () => {
    const cols = [{ name: '=evil' }, { name: 'ok' }];
    const text = C.toCsv(cols, [['a', '=b'], ['c', 'd']]);
    expect(text).toBe("'=evil,ok\r\na,'=b\r\nc,d\r\n");
    const file = C.toCsvFile(cols, [['a', 'b']]);
    expect(file.charCodeAt(0)).toBe(0xFEFF);
    expect(Buffer.from(file, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xEF, 0xBB, 0xBF]));
    expect(file.slice(1)).toBe(C.toCsv(cols, [['a', 'b']]));
  });
  it('only a comma or a semicolon can be the delimiter', () => {
    expect(() => C.toCsv([{ name: 'a' }], [], { delimiter: '\t' })).toThrow(/comma or a semicolon/);
  });
  it('JSON carries the rows as objects by column name, as they are', () => {
    const d = C.createDataset({ name: 'J', rows: [['A', 'B'], ['=x', '2']], header: true, id: 'd1', now: 0 }).dataset;
    const out = JSON.parse(C.toJson(d, 0));
    expect(out.rows).toEqual([{ A: '=x', B: '2' }]);
    expect(out.name).toBe('J');
  });
});

describe('a dataset is filtered and sorted', () => {
  const ds = C.createDataset({ name: 's', rows: [['City', 'Pop'], ['İstanbul', '15.000'], ['Izmir', '4,3'], ['ısparta', '0,4'], ['Ankara', '']], header: true, id: 'd1' }).dataset;
  it('finds Turkish names whatever the case or the dots', () => {
    expect(C.view(ds, { filter: 'istanbul' })).toEqual([0]);
    expect(C.view(ds, { filter: 'IZMİR' })).toEqual([1]);
    expect(C.view(ds, { filter: 'isparta' })).toEqual([2]);
    expect(C.view(ds, { filter: 'xyz' })).toEqual([]);
  });
  it('every word must be found, in any order', () => {
    expect(C.view(ds, { filter: '4,3 izmir' })).toEqual([1]);
    expect(C.view(ds, { filter: 'izmir ankara' })).toEqual([]);
  });
  it('sorts a number column by value, and a blank is last either way', () => {
    expect(C.view(ds, { sortColumn: 1 })).toEqual([2, 1, 0, 3]);
    expect(C.view(ds, { sortColumn: 1, descending: true })).toEqual([0, 1, 2, 3]);
  });
  it('sorts text with the comparison it is given', () => {
    const idx = C.view(ds, { sortColumn: 0, compare: (a, b) => a.localeCompare(b, 'tr') });
    expect(idx.length).toBe(4);
    expect(ds.rows[idx[0]][0]).toBe('Ankara');
  });
  it('an unknown sort column changes nothing', () => {
    expect(C.view(ds, { sortColumn: 9 })).toEqual([0, 1, 2, 3]);
  });
});

describe('the files', () => {
  let dir, now;
  const open = (fsImpl) => createDatasetStore({ dir, fsImpl: fsImpl || fs, now: () => now, log: quiet });
  const table = [['Name', 'Age'], ['Ali', '30'], ['Veli', '41']];
  beforeEach(() => { dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kd-')), 'kept-pages', 'datasets'); now = 1000; });
  afterEach(() => { fs.rmSync(path.resolve(dir, '..', '..'), { recursive: true, force: true }); });

  it('keeps a dataset across a restart, and lists it with its size', () => {
    const made = open().create({ name: 'People', rows: table, keyColumn: 'Name', source: { url: 'https://example.com/people', title: 'People' } });
    const again = open();
    const meta = again.list();
    expect(meta.length).toBe(1);
    expect(meta[0]).toMatchObject({ id: made.dataset.id, name: 'People', rowCount: 2, keyColumn: 'Name' });
    expect(meta[0].bytes).toBeGreaterThan(0);
    expect(again.get(made.dataset.id).rows).toEqual([['Ali', '30'], ['Veli', '41']]);
  });
  it('appends and persists, and a second append of the same rows adds nothing', () => {
    const s = open();
    const id = s.create({ name: 'P', rows: table, keyColumn: 'Name' }).dataset.id;
    now = 2000;
    expect(s.append(id, [['Zeki', '5'], ['Ali', '1']])).toMatchObject({ added: 1, skipped: 1 });
    expect(open().get(id).rows.length).toBe(3);
    expect(open().append(id, [['Zeki', '5']])).toMatchObject({ added: 0, skipped: 1 });
    expect(open().get(id).updatedAt).toBe(2000);
  });
  it('takes the name, header and key from the table and nothing else from the window (not the id, not the time)', () => {
    const r = open().create({ name: 'P', rows: table, id: 'evil', now: 5, createdAt: 7 });
    expect(r.dataset.id).not.toBe('evil');
    expect(r.dataset.createdAt).toBe(1000);
  });
  it('refuses the 51st dataset and keeps the 50', () => {
    const s = open();
    for (let i = 0; i < 50; i++) s.create({ name: 'd' + i, rows: [['A'], ['x']] , header: true });
    expect(() => s.create({ name: 'one more', rows: [['A'], ['x']], header: true })).toThrow(/50 datasets/);
    expect(s.list().length).toBe(50);
    s.remove(s.list()[0].id);
    expect(() => s.create({ name: 'now it fits', rows: [['A'], ['x']], header: true })).not.toThrow();
  });
  it('is not made from a bank, payment, sign-in, mail or health page', () => {
    const s = open();
    for (const url of ['https://www.paypal.com/x', 'https://example.com/login', 'https://mail.google.com/mail', 'https://example.com/a?token=abc', 'https://onlinebanking.example.com/']) {
      expect(() => s.create({ name: 'x', rows: table, source: { url } }), url).toThrow();
    }
    expect(s.list().length).toBe(0);
  });
  it('a dataset for a page watch is filled by that watch only', () => {
    const s = open();
    const id = s.create({ name: 'w', rows: [['Captured at', 'Value', 'What changed']], header: true, allowEmpty: true, watchId: 'w_1' }).dataset.id;
    s.create({ name: 'other', rows: [['A'], ['x']], header: true, watchId: 'w_2' });
    expect(s.appendForWatch('w_1', ['2026-01-01T00:00:00.000Z', '9', 'up'])).toBe(1);
    expect(s.appendForWatch('w_none', ['t', 'v', 'c'])).toBe(0);
    expect(s.get(id).rows).toEqual([['2026-01-01T00:00:00.000Z', '9', 'up']]);
    expect(s.setWatch(id, null).watchId).toBeNull();
    expect(s.appendForWatch('w_1', ['t2', 'v', 'c'])).toBe(0);
  });
  it('exports CSV with a byte-order mark and neutralised formulas, semicolon CSV, and JSON', () => {
    const s = open();
    const id = s.create({ name: 'Sales: 2026/Q1', rows: [['Item', 'Note'], ['a', '=cmd()'], ['b', 'x,y']], header: true }).dataset.id;
    const csv = s.exportAs(id, 'csv');
    expect(csv.name).toBe('Sales- 2026-Q1.csv');
    expect(Buffer.from(csv.text, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xEF, 0xBB, 0xBF]));
    expect(csv.text.slice(1)).toBe("Item,Note\r\na,'=cmd()\r\nb,\"x,y\"\r\n");
    expect(s.exportAs(id, 'csv-semicolon').text.slice(1)).toBe("Item;Note\r\na;'=cmd()\r\nb;x,y\r\n");
    expect(JSON.parse(s.exportAs(id, 'json').text).rows[0]).toEqual({ Item: 'a', Note: '=cmd()' });
    expect(() => s.exportAs(id, 'xml')).toThrow(/Unknown format/);
  });
  it('delete removes one dataset, and "delete everything" removes every file it kept and nothing else', () => {
    const s = open();
    const a = s.create({ name: 'a', rows: table, header: true }).dataset.id;
    s.create({ name: 'b', rows: table, header: true });
    const neighbour = path.join(dir, '..', 'recall-extras.json');
    fs.writeFileSync(neighbour, '{"v":1,"items":[]}');
    expect(s.remove(a)).toBe(true);
    expect(s.list().length).toBe(1);
    expect(s.remove(a)).toBe(false);
    const removed = s.clearAll();
    expect(removed).toBeGreaterThan(0);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(neighbour)).toBe(true);
    expect(open().list()).toEqual([]);
  });
  it('a write that fails half way leaves the dataset as it was, and says so', () => {
    const id = open().create({ name: 'P', rows: table, keyColumn: 'Name' }).dataset.id;
    const before = fs.readFileSync(path.join(dir, id + '.json'), 'utf8');
    const broken = { ...fs, renameSync() { throw new Error('the disk went away'); } };
    expect(() => open(broken).append(id, [['Zeki', '5']])).toThrow(/disk went away/);
    expect(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')).toBe(before);
    expect(fs.readdirSync(dir).filter(n => n.endsWith('.tmp'))).toEqual([]);
    expect(open().get(id).rows.length).toBe(2);
  });
  it('an index that is missing is rebuilt from the files', () => {
    const id = open().create({ name: 'P', rows: table, keyColumn: 'Name' }).dataset.id;
    fs.rmSync(path.join(dir, 'index.json'), { force: true });
    fs.rmSync(path.join(dir, 'index.json.bak'), { force: true });
    expect(open().list().map(m => m.id)).toEqual([id]);
  });
  it('a dataset file that is damaged is kept aside and reported, not rewritten or thrown away', () => {
    const id = open().create({ name: 'P', rows: table, keyColumn: 'Name' }).dataset.id;
    fs.writeFileSync(path.join(dir, id + '.json'), '{"half":');
    const s = open();
    expect(() => s.get(id)).toThrow(/could not be read/);
    expect(fs.readdirSync(dir).some(n => n.includes('.corrupt-'))).toBe(true);
  });
  it('an id that is not an id never becomes a path', () => {
    expect(() => open().get('../../x')).toThrow(/gone/);
    expect(open().remove('../../x')).toBe(false);
  });
});

describe('the IPC channels', () => {
  let root, handlers, saved;
  const call = async (channel, ...args) => handlers.get(channel)({ sender: {} }, ...args);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kdi-'));
    handlers = new Map();
    saved = null;
    registerDatasets({
      ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
      dialog: { showSaveDialog: async (...a) => { saved = a; return { canceled: false, filePath: path.join(root, 'out.csv') }; } },
      windowOf: () => null, baseDir: () => root, downloadsDir: () => root, now: () => 5000, log: quiet,
    });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('answers { ok: false, error } with the reason, never throws into the window', async () => {
    const r = await call('recall:dataset-get', 'dnope');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gone/);
    const bad = await call('recall:dataset-create', { name: 'x', rows: [['A']], source: { url: 'https://www.paypal.com/' } });
    expect(bad.ok).toBe(false);
  });
  it('creates, appends, lists and exports a file the person chose (BOM and all)', async () => {
    const made = await call('recall:dataset-create', { name: 'P', rows: [['Name'], ['=x'], ['y']], header: true });
    expect(made).toMatchObject({ ok: true, rows: 2, columns: 1 });
    expect((await call('recall:dataset-append', made.id, [['z']], undefined))).toMatchObject({ ok: true, added: 1 });
    const list = await call('recall:dataset-list');
    expect(list.items.length).toBe(1);
    expect(list.limits.rows).toBe(5000);
    const out = await call('recall:dataset-export', made.id, 'csv');
    expect(out.ok).toBe(true);
    const bytes = fs.readFileSync(path.join(root, 'out.csv'));
    expect([...bytes.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
    expect(bytes.toString('utf8').slice(1)).toBe("Name\r\n'=x\r\ny\r\nz\r\n");
    expect(saved[0]).toMatchObject({ filters: [{ name: 'CSV', extensions: ['csv'] }] });
  });
  it('a cancelled save writes nothing', async () => {
    const made = await call('recall:dataset-create', { name: 'P', rows: [['Name'], ['a']], header: true });
    handlers.clear();
    registerDatasets({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, dialog: { showSaveDialog: async () => ({ canceled: true }) }, windowOf: () => null, baseDir: () => root, downloadsDir: () => root, log: quiet });
    expect(await call('recall:dataset-export', made.id, 'csv')).toMatchObject({ ok: true, cancelled: true });
    expect(fs.existsSync(path.join(root, 'out.csv'))).toBe(false);
  });
  it('"delete everything" empties the folder', async () => {
    await call('recall:dataset-create', { name: 'P', rows: [['A'], ['a']], header: true });
    expect((await call('recall:dataset-clear')).ok).toBe(true);
    expect((await call('recall:dataset-list')).items).toEqual([]);
    expect(fs.existsSync(path.join(root, 'kept-pages', 'datasets'))).toBe(false);
  });
});

describe('the contracts', () => {
  const channels = ['recall:dataset-list', 'recall:dataset-get', 'recall:dataset-create', 'recall:dataset-append', 'recall:dataset-append-watch',
    'recall:dataset-set-watch', 'recall:dataset-delete', 'recall:dataset-clear', 'recall:dataset-export'];
  it('every channel is the window\'s own and closed in a private window', () => {
    const src = fs.readFileSync('src/main/ipc-policy.js', 'utf8');
    const re = eval(src.match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]);
    for (const c of channels) {
      expect(policy.UI_ONLY_CHANNELS.has(c), c).toBe(true);
      expect(re.test(c), c).toBe(true);
    }
  });
  it('payloads are checked: shapes, sizes and the format name', () => {
    expect(() => validate('recall:dataset-create', [{ name: 'x', rows: [['a', 'b']], header: 'auto', keyColumn: 'a' }])).not.toThrow();
    expect(() => validate('recall:dataset-create', [{ name: 'x', rows: [[1, 2]] }])).toThrow();
    expect(() => validate('recall:dataset-create', [{ name: 'x', rows: 'nope' }])).toThrow();
    expect(() => validate('recall:dataset-create', [{ name: 'x', rows: [['a']], header: 'yes' }])).toThrow();
    expect(() => validate('recall:dataset-export', ['d1', 'csv-semicolon'])).not.toThrow();
    expect(() => validate('recall:dataset-export', ['d1', 'xml'])).toThrow();
    expect(() => validate('recall:dataset-append', ['d1', [['a']], undefined])).not.toThrow();
    expect(() => validate('recall:dataset-append', ['d1', [['a']], 'Name', 'extra'])).toThrow();
    expect(() => validate('recall:dataset-set-watch', ['d1', null])).not.toThrow();
    expect(() => validate('recall:dataset-list', ['x'])).toThrow();
  });
});
