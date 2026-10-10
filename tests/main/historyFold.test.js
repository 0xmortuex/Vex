// History was kept twice: the History panel's list (vex.history in
// vex-persist.json) and a 500-visit copy in vex-storage/history.json, rewritten
// with its .bak on every page visit (166 KB on the owner's profile, found
// 2026-10-10). The file is no longer written; once, at start, the visits only
// it holds join vex.history and the file goes (main/history-fold.js). An
// existing profile keeps every visit.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { JsonStore } = require('../../src/main/file-store.js');
const { createPreferenceStore } = require('../../src/main/storage.js');
const { foldHistoryFile, mergeHistory } = require('../../src/main/history-fold.js');

const directories = [];
async function profile({ panel, file, fileBak }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-history-fold-'));
  directories.push(dir);
  const storage = path.join(dir, 'vex-storage');
  await fs.mkdir(storage);
  const persist = path.join(dir, 'vex-persist.json');
  const prefs = { __vexPreferenceStore: 1, 'vex.theme': '"dark"' };
  if (panel !== undefined) prefs['vex.history'] = JSON.stringify(panel);
  await fs.writeFile(persist, JSON.stringify(prefs));
  if (file !== undefined) await fs.writeFile(path.join(storage, 'history.json'), JSON.stringify({ $vexStore: 1, data: file }));
  if (fileBak !== undefined) await fs.writeFile(path.join(storage, 'history.json.bak'), JSON.stringify({ $vexStore: 1, data: fileBak }));
  return { dir, storage, persist, dataStore: new JsonStore(storage), preferences: createPreferenceStore(persist) };
}
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

const exists = p => fs.access(p).then(() => true, () => false);
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 10, 12);
const at = (daysAgo, h = 0) => NOW - daysAgo * DAY - h * 3600000;
const iso = t => new Date(t).toISOString();
const savedList = async p => JSON.parse(JSON.parse(await fs.readFile(p.persist, 'utf8'))['vex.history']);

describe('folding history.json into the History panel\'s list', () => {
  it('keeps every visit of an existing profile, adds the ones only the file had, and removes the file and its backup', async () => {
    const panel = [
      { id: 'h_1', url: 'https://a.example/', title: 'A', favicon: '', visitedAt: iso(at(0)), indexed: true, summary: 'kept' },
      { id: 'h_2', url: 'https://b.example/', title: 'B', favicon: 'https://b.example/f.ico', visitedAt: iso(at(3)), indexed: false },
    ];
    const file = [
      { id: 'u1', url: 'https://a.example/', title: 'A', time: at(0, 2) },   // same row (within a day)
      { id: 'u2', url: 'https://c.example/', title: 'Only in the file', time: at(1) },
      { id: 'u3', url: 'https://b.example/', title: 'B, a week earlier', time: at(10) },   // another visit
      { id: 'u4', url: 'https://c.example/', title: 'Only in the file', time: at(1, 1) },  // repeat of u2
      { id: 'u5', url: 'file:///C:/x.pdf', title: 'not a web page', time: at(2) },
      { id: 'u6', url: 'https://d.example/', time: at(4) },                   // no title
    ];
    const p = await profile({ panel, file, fileBak: file.slice(1) });

    const r = await foldHistoryFile(p);
    expect(r).toEqual({ added: 3, removed: true });

    const list = await savedList(p);
    // Everything the panel had, untouched.
    expect(list.find(e => e.id === 'h_1')).toEqual(panel[0]);
    expect(list.find(e => e.id === 'h_2')).toEqual(panel[1]);
    // And what only the file had, newest first.
    expect(list.map(e => e.url)).toEqual(['https://a.example/', 'https://c.example/', 'https://b.example/', 'https://d.example/', 'https://b.example/']);
    const c = list.find(e => e.url === 'https://c.example/');
    expect(c).toMatchObject({ title: 'Only in the file', favicon: '', visitedAt: iso(at(1)), indexed: false });
    expect(c.id).toMatch(/^h_\d+_[a-z0-9]+$/);
    expect(list.find(e => e.url === 'https://d.example/').title).toBe('https://d.example/');
    // The list still passes what its saves are checked against.
    expect(() => require('../../src/renderer/js/data-contracts.js').storage('history', list)).not.toThrow();
    // Other settings are left alone.
    expect(JSON.parse(await fs.readFile(p.persist, 'utf8'))['vex.theme']).toBe('"dark"');

    expect(await exists(path.join(p.storage, 'history.json'))).toBe(false);
    expect(await exists(path.join(p.storage, 'history.json.bak'))).toBe(false);
  });

  it('is done once: a second start finds no file and writes nothing', async () => {
    const p = await profile({ panel: [], file: [{ url: 'https://a.example/', title: 'A', time: at(1) }] });
    await foldHistoryFile(p);
    const before = await fs.stat(p.persist);
    const again = await foldHistoryFile({ dataStore: new JsonStore(p.storage), preferences: createPreferenceStore(p.persist) });
    expect(again).toEqual({ added: 0, removed: false });
    expect((await fs.stat(p.persist)).mtimeMs).toBe(before.mtimeMs);
    expect((await savedList(p)).map(e => e.url)).toEqual(['https://a.example/']);
  });

  it('takes the whole file into a profile that had no list of its own', async () => {
    const file = [{ url: 'https://a.example/', title: 'A', time: at(1) }, { url: 'https://b.example/', title: 'B', time: at(2) }];
    const p = await profile({ file });
    expect(await foldHistoryFile(p)).toEqual({ added: 2, removed: true });
    expect((await savedList(p)).map(e => e.url)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('does not rewrite the list when the file holds nothing new, and still removes the file', async () => {
    const panel = [{ id: 'h_1', url: 'https://a.example/', title: 'A', favicon: '', visitedAt: iso(at(1)), indexed: false }];
    const p = await profile({ panel, file: [{ url: 'https://a.example/', title: 'A', time: at(1, 3) }] });
    const before = await fs.readFile(p.persist, 'utf8');
    expect(await foldHistoryFile(p)).toEqual({ added: 0, removed: true });
    expect(await fs.readFile(p.persist, 'utf8')).toBe(before);
    expect(await exists(path.join(p.storage, 'history.json'))).toBe(false);
  });

  it('removes a backup left on its own', async () => {
    const p = await profile({ panel: [], fileBak: [] });
    expect(await foldHistoryFile(p)).toEqual({ added: 0, removed: true });
    expect(await exists(path.join(p.storage, 'history.json.bak'))).toBe(false);
  });

  it('keeps the file when the saved list cannot be read, and says why', async () => {
    const p = await profile({ file: [{ url: 'https://a.example/', time: at(1) }] });
    const prefs = JSON.parse(await fs.readFile(p.persist, 'utf8'));
    prefs['vex.history'] = '{"not":"a list"}';
    await fs.writeFile(p.persist, JSON.stringify(prefs));
    await expect(foldHistoryFile({ dataStore: p.dataStore, preferences: createPreferenceStore(p.persist) })).rejects.toThrow('The saved history list is not a list');
    expect(await exists(path.join(p.storage, 'history.json'))).toBe(true);
  });
});

describe('the History panel reads the folded list', () => {
  it('shows every entry, the file\'s ones included', async () => {
    const { list } = mergeHistory(JSON.stringify([{ id: 'h_1', url: 'https://a.example/', title: 'A', favicon: '', visitedAt: iso(at(0)), indexed: false }]),
      [{ url: 'https://c.example/', title: 'C', time: at(2) }]);
    // history-panel.js is a renderer script; its reader is plain enough to load here.
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://vex.test/' });
    const g = globalThis;
    const saved = { window: g.window, document: g.document, localStorage: g.localStorage };
    g.window = dom.window; g.document = dom.window.document; g.localStorage = dom.window.localStorage;
    try {
      dom.window.localStorage.setItem('vex.history', JSON.stringify(list));
      const MODULE = require.resolve('../../src/renderer/js/history-panel.js');
      delete require.cache[MODULE];
      const H = require(MODULE).HistoryPanel;
      expect(H.list().map(e => [e.url, e.title])).toEqual([['https://a.example/', 'A'], ['https://c.example/', 'C']]);
    } finally { Object.assign(g, saved); }
  }, 30000); // loading jsdom here takes ~3.4s alone, past the 5s default on a busy machine
});
