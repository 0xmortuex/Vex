// T0-012: every JsonStore instance has a schema version for the keys it holds.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JsonStore } = require('../../src/main/file-store.js');

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('src/main.js');
const constOf = (file, name) => { const m = new RegExp('const ' + name + "\\s*=\\s*'([^']+)'").exec(read(file)); if (!m) throw new Error(name + ' not found in ' + file); return m[1]; };

describe('the keys every JsonStore holds are versioned', () => {
  const dataKeys = /const STORE_KEYS = \[([^\]]+)\]/.exec(main)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  const protectBlock = main.slice(main.indexOf('jsonStore: (() => {'), main.indexOf('})(),', main.indexOf('jsonStore: (() => {')));

  it('the window-facing and desk store registers its keys, devdesk and the userscripts included', () => {
    for (const k of ['settings', 'history', 'sync-records', 'sync-tombstones', 'sync-known-devices', 'tabs', 'theme', 'userscripts', 'gui-style']) expect(dataKeys).toContain(k);
    expect(dataKeys).toContain(constOf('src/main/dev-desk.js', 'KEY'));
    expect(main).toMatch(/for \(const key of STORE_KEYS\) dataStore\.schema\(key, \{ version: 1 \}\)/);
  });

  it('the protect store registers the keys its modules write', () => {
    for (const [file, name] of [['src/main/extension-usage.js', 'STORE_KEY'], ['src/main/privacy-report.js', 'STORE_KEY'], ['src/main/signout-why.js', 'STORE_KEY'], ['src/main/quiet-hours.js', 'CONFIG_KEY'], ['src/main/quiet-hours.js', 'HELD_KEY']]) {
      expect(protectBlock).toContain("'" + constOf(file, name) + "'");
    }
    expect(protectBlock).toContain('PLAIN_KEY');
  });

  it('the reminders store registers reminders and reminders_meta', () => {
    expect(main).toMatch(/new JsonStore\(userDataPath\)\.schema\('reminders', \{ version: 1 \}\)\.schema\('reminders_meta', \{ version: 1 \}\)/);
  });

  it('a registered key is stamped with its version, a file from a newer Vex is refused, and plain old files are adopted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schemas-'));
    try {
      const st = new JsonStore(dir).schema('devdesk', { version: 1 });
      fs.writeFileSync(path.join(dir, 'devdesk.json'), JSON.stringify({ enabled: true }));
      expect(await st.read('devdesk')).toEqual({ enabled: true });
      const stamped = JSON.parse(fs.readFileSync(path.join(dir, 'devdesk.json'), 'utf8'));
      expect(stamped).toMatchObject({ $vexStore: 1, v: 1, data: { enabled: true } });
      fs.writeFileSync(path.join(dir, 'devdesk.json'), JSON.stringify({ $vexStore: 1, v: 9, data: { x: 1 } }));
      await expect(new JsonStore(dir).schema('devdesk', { version: 1 }).read('devdesk')).rejects.toThrow(/newer Vex/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
