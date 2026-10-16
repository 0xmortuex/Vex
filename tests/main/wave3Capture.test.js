// Wave 3 capture: DOI lookup (stand-in fetch), PDF toolkit (real pdf-lib), IPC schemas and policy.
// pdf-lib is a declared dependency; in a worktree without node_modules run with NODE_PATH pointing at one.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDoiResolver, normalizeDoi, recordFromWork } = require('../../src/main/doi-resolve.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

describe('DOI lookup', () => {
  it('normalizes the usual spellings and refuses anything else', () => {
    expect(normalizeDoi('https://doi.org/10.1000/xyz123.')).toBe('10.1000/xyz123');
    expect(normalizeDoi('doi: 10.1000/xyz123')).toBe('10.1000/xyz123');
    expect(() => normalizeDoi('hello')).toThrow(/not a DOI/);
  });
  it('turns a Crossref message into record fields', () => {
    const r = recordFromWork({ title: ['A title'], author: [{ family: 'Smith', given: 'Jo' }, { name: 'The Lab' }], 'container-title': ['J. Tests'], volume: '3', issue: '2', page: '1-9', publisher: 'P', issued: { 'date-parts': [[2020, 3, 5]] }, license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }] }, '10.1/x');
    expect(r).toMatchObject({ kind: 'article', title: 'A title', container: 'J. Tests', date: '2020-03-05', doi: '10.1/x', oaUrl: 'https://doi.org/10.1/x' });
    expect(r.authors).toEqual([{ family: 'Smith', given: 'Jo' }, { family: 'The Lab', given: '' }]);
  });
  it('asks Crossref once, with an egress hint and no credentials, and explains refusals', async () => {
    const calls = [];
    const ok = createDoiResolver({ fetch: async (u, i) => { calls.push([u, i]); return { ok: true, status: 200, json: async () => ({ message: { title: ['T'] } }) }; } });
    expect((await ok.resolve('10.1000/abc')).title).toBe('T');
    expect(calls[0][0]).toBe('https://api.crossref.org/works/10.1000%2Fabc');
    expect(calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', egress: { feature: 'Citation lookup (DOI)', kind: 'fetch' } });
    const nf = createDoiResolver({ fetch: async () => ({ ok: false, status: 404 }) });
    await expect(nf.resolve('10.1000/abc')).rejects.toThrow(/does not know/);
    const down = createDoiResolver({ fetch: async () => { throw new Error('offline'); } });
    await expect(down.resolve('10.1000/abc')).rejects.toThrow(/Could not reach Crossref/);
  });
});

describe('IPC contracts', () => {
  it('bounds the DOI and PDF requests', () => {
    expect(() => validate('sources:resolve-doi', ['10.1/x'])).not.toThrow();
    expect(() => validate('pdftool:run', [{ op: 'merge', tokens: ['a'.repeat(32), 'b'.repeat(32)] }])).not.toThrow();
    expect(() => validate('pdftool:run', [{ op: 'merge', tokens: ['C:\\x.pdf'] }])).toThrow(/Invalid payload/);
    expect(() => validate('pdftool:run', [{ op: 'format-disk', tokens: ['a'.repeat(32)] }])).toThrow(/Invalid payload/);
  });
  it('are for Vex\'s own window only', () => {
    for (const c of ['sources:resolve-doi', 'pdftool:pick-files', 'pdftool:run', 'pdftool:forget']) expect(UI_ONLY_CHANNELS.has(c)).toBe(true);
  });
});

describe('PDF toolkit', () => {
  const T = require('../../src/main/pdf-toolkit.js');
  const lib = require('pdf-lib');
  const make = async (n) => { const d = await lib.PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([100 + i, 100]); return Buffer.from(await d.save()); };
  const widths = async (bytes) => (await lib.PDFDocument.load(bytes)).getPages().map(p => p.getWidth());

  it('reads page lists', () => {
    expect(T.parsePageSpec('1-3, 5, 8-', 9)).toEqual([0, 1, 2, 4, 7, 8]);
    expect(T.parsePageSpec('3,1,2', 3)).toEqual([2, 0, 1]);
    expect(T.parsePageSpec('odd', 4)).toEqual([0, 2]);
    expect(T.parsePageSpec('3-1', 3)).toEqual([2, 1, 0]);
    expect(() => T.parsePageSpec('9', 3)).toThrow(/outside/);
    expect(() => T.parsePageSpec('a', 3)).toThrow(/not a page/);
  });
  it('merges, extracts and reorders, splits and rotates', async () => {
    const a = await make(3), b = await make(2);
    expect((await T.merge([{ bytes: a, name: 'a' }, { bytes: b, name: 'b' }])).pages).toBe(5);
    expect(await widths((await T.extract(a, '3,1', 'a')).bytes)).toEqual([102, 100]);
    const parts = await T.split(a, { mode: 'each' }, 'a');
    expect(parts.map(p => p.pages)).toEqual([1, 1, 1]);
    expect((await T.split(a, { mode: 'every', n: 2 }, 'a')).map(p => p.pages)).toEqual([2, 1]);
    const r = await T.rotate(a, { spec: '2', degrees: 90 }, 'a');
    expect((await lib.PDFDocument.load(r.bytes)).getPages().map(p => p.getRotation().angle)).toEqual([0, 90, 0]);
    await expect(T.merge([{ bytes: a, name: 'a' }])).rejects.toThrow(/at least two/);
    await expect(T.extract(Buffer.from('not a pdf'), '1', 'x.txt')).rejects.toThrow(/not a PDF/);
  });
  it('writes only where the person saves, and never over an input', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-pdf-'));
    const f1 = path.join(dir, 'one.pdf'), f2 = path.join(dir, 'two.pdf');
    fs.writeFileSync(f1, await make(2)); fs.writeFileSync(f2, await make(1));
    const handlers = new Map();
    let save = path.join(dir, 'merged.pdf');
    let open = [f1, f2];
    T.registerPdfToolkit({
      ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: open }), showSaveDialog: async () => ({ canceled: false, filePath: save }) },
      windowFor: () => null,
    });
    const picked = await handlers.get('pdftool:pick-files')({});
    expect(picked.files.map(f => f.pages)).toEqual([2, 1]);
    const tokens = picked.files.map(f => f.token);
    const done = await handlers.get('pdftool:run')({}, { op: 'merge', tokens });
    expect(done.ok).toBe(true);
    expect(await widths(fs.readFileSync(save))).toHaveLength(3);
    save = f1;
    const refused = await handlers.get('pdftool:run')({}, { op: 'merge', tokens });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/replace one of the PDFs/);
    expect(fs.statSync(f1).size).toBeGreaterThan(0);
    const unknown = await handlers.get('pdftool:run')({}, { op: 'rotate', tokens: ['0'.repeat(32)], degrees: 90 });
    expect(unknown.ok).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
    open = [];
  });
});
