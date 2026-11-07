// B6: an unreadable enabled/disabled list must never switch extensions on. It fails CLOSED (everything disabled)
// until the owner reviews, a good .bak is put back, and the state is written atomically.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ext = require('../../src/main/extensions.js');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-ext-'));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const ALL = ['adblock-1', 'dark-2', 'notes-3'];
const read = (opts) => ext.readDisabledFailClosed(dir, () => ALL, opts);

describe('readDisabledFailClosed', () => {
  it('normal path: no file means nothing disabled, a good file is read as it is', () => {
    expect(read()).toMatchObject({ state: 'ok', disabled: new Set() });
    ext.writeDisabled(dir, new Set(['dark-2']));
    expect(read()).toMatchObject({ state: 'ok', disabled: new Set(['dark-2']) });
    expect(fs.readdirSync(dir).filter(n => n.includes('corrupt'))).toEqual([]);
  });

  it('a cut file with no backup: EVERY extension counts as disabled, the damaged file is kept, nothing is rewritten', () => {
    fs.writeFileSync(ext.disabledPath(dir), '["dark-2"');
    const r = read();
    expect(r.state).toBe('closed');
    expect(r.disabled).toEqual(new Set(ALL));
    expect(fs.readFileSync(r.corruptCopy, 'utf8')).toBe('["dark-2"');
    expect(fs.readFileSync(ext.disabledPath(dir), 'utf8')).toBe('["dark-2"');
  });

  it('a zero-byte file and a file that is not a list both fail closed (not "all enabled")', () => {
    fs.writeFileSync(ext.disabledPath(dir), '');
    expect(read().state).toBe('closed');
    fs.writeFileSync(ext.disabledPath(dir), '{"a":1}');
    const r = read({ keepCopy: false });
    expect(r.state).toBe('closed');
    expect(r.disabled).toEqual(new Set(ALL));
  });

  it('an unreadable file (a directory where the file should be: EISDIR) fails closed too', () => {
    fs.mkdirSync(ext.disabledPath(dir));
    expect(read({ keepCopy: false }).disabled).toEqual(new Set(ALL));
  });

  it('a cut file with a good backup: the backup is put back and the damaged file is kept', () => {
    ext.writeDisabled(dir, new Set(['dark-2']));
    ext.writeDisabled(dir, new Set(['dark-2', 'notes-3']));   // .bak holds ['dark-2']
    fs.writeFileSync(ext.disabledPath(dir), '["dark-2",');
    const r = read();
    expect(r.state).toBe('recovered');
    expect(r.disabled).toEqual(new Set(['dark-2']));
    expect(JSON.parse(fs.readFileSync(ext.disabledPath(dir), 'utf8'))).toEqual(['dark-2']);
    expect(fs.readFileSync(r.corruptCopy, 'utf8')).toBe('["dark-2",');
    expect(read().state).toBe('ok');
  });

  it('closed -> the owner switches one extension on: the list is written atomically with the others still off', () => {
    fs.writeFileSync(ext.disabledPath(dir), 'garbage');
    const disabled = read({ keepCopy: false }).disabled;       // what extensions:set-enabled does next
    disabled.delete('dark-2');
    ext.writeDisabled(dir, disabled);
    expect(read()).toMatchObject({ state: 'ok', disabled: new Set(['adblock-1', 'notes-3']) });
    expect(fs.readdirSync(dir).filter(n => n.endsWith('.tmp'))).toEqual([]);
  });

  it('putting the backup back fails (disk full): still answers from the backup and reports it, never throws', () => {
    ext.writeDisabled(dir, new Set(['dark-2']));
    ext.writeDisabled(dir, new Set(['dark-2', 'notes-3']));
    fs.writeFileSync(ext.disabledPath(dir), '[');
    const real = fs.renameSync;
    fs.renameSync = () => { throw Object.assign(new Error('injected ENOSPC'), { code: 'ENOSPC' }); };
    let r;
    try { r = read(); } finally { fs.renameSync = real; }
    expect(r.state).toBe('recovered');
    expect(r.error.restoreError).toMatch(/ENOSPC/);
  });
});

describe('main.js wiring', () => {
  const src = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  it('no longer returns an empty set on a read error, and tells the owner', () => {
    expect(src).not.toMatch(/every extension is being treated as enabled/);
    expect(src).toMatch(/readDisabledFailClosed\(extensionsDir/);
    expect(src).toMatch(/feature: 'extensions-state', id: 'closed'/);
  });
});
