import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDevExtension } = require('../../src/main/dev-extension');

let dir, ext, loads, unloads, watchers, timers, dev;
const ABSENT = [['history', 'your browsing history'], ['sidePanel', 'its side panel']];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-devext-'));
  ext = path.join(dir, 'ext');
  fs.mkdirSync(path.join(ext, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Mine', version: '1.0.0', permissions: ['history'] }));
  fs.writeFileSync(path.join(ext, 'bg.js'), 'chrome.history.search({});\nchrome.storage.local.get();\nchrome.sidePanel.open();\n');
  fs.writeFileSync(path.join(ext, 'node_modules', 'x.js'), 'chrome.history.search();');
  loads = []; unloads = []; watchers = []; timers = [];
  dev = createDevExtension({
    fs, path, absent: ABSENT, cautions: () => ['careful'],
    load: async (folder) => { loads.push(folder); return { extension: { id: 'x' }, errors: [] }; },
    unload: (folder) => unloads.push(folder),
    watch: (d, o, cb) => { const w = { cb, closed: false, close() { this.closed = true; }, on() {} }; watchers.push(w); return w; },
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('plugin dev loop', () => {
  it('lists the chrome.* namespaces Vex lacks, with where, and skips node_modules', async () => {
    const st = await dev.start(ext);
    expect(st.active).toBe(true);
    expect(st.report.unsupported.map(u => u.api).sort()).toEqual(['history', 'sidePanel']);
    expect(st.report.unsupported.find(u => u.api === 'history').hits).toEqual([{ file: 'bg.js', line: 1 }]);
    expect(st.report.cautions).toEqual(['careful']);
  });
  it('reloads once after a burst of changes', async () => {
    await dev.start(ext);
    watchers[0].cb(); watchers[0].cb(); watchers[0].cb();
    timers[timers.length - 1]();
    await new Promise(r => setImmediate(r));
    expect(unloads).toHaveLength(1);
    expect(loads).toHaveLength(2);
    expect(dev.status().reloads).toBe(1);
  });
  it('keeps a failed reload in the status', async () => {
    await dev.start(ext);
    fs.writeFileSync(path.join(ext, 'manifest.json'), '{ broken');
    await expect(dev.reload()).rejects.toThrow(/not valid JSON/);
    expect(dev.status().lastError).toMatch(/not valid JSON/);
  });
  it('refuses a folder without a manifest and leaves nothing loaded', async () => {
    const empty = path.join(dir, 'empty');
    fs.mkdirSync(empty);
    await expect(dev.start(empty)).rejects.toThrow(/no manifest\.json/);
    expect(dev.status().active).toBe(false);
  });
  it('stop closes the watcher and unloads', async () => {
    await dev.start(ext);
    await dev.stop();
    expect(watchers[0].closed).toBe(true);
    expect(unloads.length).toBeGreaterThan(0);
    expect(dev.status().active).toBe(false);
  });
  it('reads installed Vencord builds without changing them', () => {
    const base = path.join(dir, 'extensions');
    fs.mkdirSync(path.join(base, 'vencord-1'), { recursive: true });
    fs.writeFileSync(path.join(base, 'vencord-1', 'manifest.json'), JSON.stringify({ version: '1.2.3' }));
    fs.writeFileSync(path.join(base, 'vencord-1', 'browser.js'), 'abc');
    fs.mkdirSync(path.join(base, 'other'));
    const list = dev.vencordStatus(base);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ folder: 'vencord-1', version: '1.2.3', bundle: 'browser.js', loadable: true });
    expect(list[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
