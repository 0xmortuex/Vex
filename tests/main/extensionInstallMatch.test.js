// @vitest-environment jsdom
//
// EX1: installing a different extension with the same name went into the
// installed one's folder and read its private storage (and could be an
// older version). An installed copy is the same extension only by its key or
// its source record; a name alone asks "Replace X?" and starts fresh.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const fnSrc = (name) => { const a = MAIN.indexOf(`function ${name}(`); return MAIN.slice(a, MAIN.indexOf('\n}\n', a) + 2); };

function mainSide(entries, sources = {}) {
  const ctx = vm.createContext({
    path, _readSources: () => sources, _installedEntries: () => entries,
    _installedCopyNamed: (name) => entries.find(e => e.manifest.name === name) || null,
    _extUpdates: require('../../src/main/extension-updates.js'),
  });
  vm.runInContext(fnSrc('_sameExtensionAs') + '\n' + fnSrc('_installedPreview') + '\nthis.same = _sameExtensionAs; this.preview = _installedPreview;', ctx);
  return ctx;
}
const A = { folder: 'dark-mode-1', path: '/x/dark-mode-1', manifest: { name: 'Dark Mode', version: '2.0.0', key: 'KEY-A' } };
const C = { folder: 'cat-1', path: '/x/cat-1', manifest: { name: 'Catalogued', version: '1.0.0' } };

describe('which installed copy a package is', () => {
  it('a different extension with the same name is not the installed one', () => {
    const m = mainSide([A]);
    expect(m.same({ key: 'KEY-B' })).toBe(null);
    expect(m.same({})).toBe(null);
    expect(m.preview(null, 'Dark Mode', '1.0.0')).toEqual({ folder: 'dark-mode-1', version: '2.0.0', sameNameOnly: true, downgrade: false });
  });
  it('the same key, store id or catalogue entry is', () => {
    const m = mainSide([A, C], { 'dark-mode-1': { webstore: 'abcdefghijklmnopabcdefghijklmnop' }, 'cat-1': { catalog: 'ublock' } });
    expect(m.same({ key: 'KEY-A' }).folder).toBe('dark-mode-1');
    expect(m.same({ webstoreId: 'abcdefghijklmnopabcdefghijklmnop' }).folder).toBe('dark-mode-1');
    expect(m.same({ catalogId: 'ublock' }).folder).toBe('cat-1');
    expect(m.same({ key: 'KEY-A', exceptFolder: '/x/dark-mode-1' })).toBe(null);
  });
  it('an older version of the same extension is a downgrade the dialog warns about', () => {
    const m = mainSide([A]);
    expect(m.preview(A, 'Dark Mode', '1.5.0')).toMatchObject({ sameNameOnly: false, downgrade: true });
    expect(m.preview(A, 'Dark Mode', '2.1.0')).toMatchObject({ sameNameOnly: false, downgrade: false });
  });
  it('an install updates in place only the same extension, never one matched by name', () => {
    const act = fnSrc('_activateInstalledFolder');
    expect(act).toMatch(/previous = _sameExtensionAs\(\{ \.\.\.match, key: manifest\.key, exceptFolder: destFolder \}\);/);
    expect(MAIN).not.toMatch(/function _installedCopyOf\(/);
    expect(fnSrc('_webStoreCopyOf')).not.toMatch(/_installedCopyNamed/);
    expect(MAIN).toMatch(/const previous = _sameExtensionAs\(\{ key: keyB64 \}\);/);
    expect(MAIN).toMatch(/match: \{ catalogId: id \}/);
    expect(MAIN).toMatch(/match: \{ webstoreId: pkg\.id \}/);
  });
});

describe('the dialog', () => {
  let VexWebStore;
  beforeEach(() => {
    window.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const r = require.resolve(path.join(ROOT, 'src/renderer/js/web-store.js'));
    delete require.cache[r];
    ({ VexWebStore } = require(r));
  });
  it('asks "Replace X?" for a different extension of the same name, and says nothing is passed on', () => {
    const p = { name: 'Dark Mode', version: '1.0.0', installed: { folder: 'dark-mode-1', version: '2.0.0', sameNameOnly: true, downgrade: false } };
    expect(VexWebStore.confirmWords(p)).toEqual({ title: 'Replace "Dark Mode"?', okLabel: 'Replace' });
    expect(VexWebStore.dialogHtml(p)).toMatch(/different extension called "Dark Mode".*none of its settings or data are passed on/);
  });
  it('warns about an older version, and updates the same one as before', () => {
    expect(VexWebStore.confirmWords({ name: 'X', installed: { downgrade: true } }).okLabel).toBe('Install older version');
    expect(VexWebStore.confirmWords({ name: 'X', installed: { version: '1' } })).toEqual({ title: 'Update "X"?', okLabel: 'Update' });
    expect(VexWebStore.confirmWords({ name: 'X' })).toEqual({ title: 'Add "X"?', okLabel: 'Add to Vex' });
  });
});
