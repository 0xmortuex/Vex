// Every IPC channel the 2026-10 features added has a schema, a preload entry, is
// reachable only from Vex's own window (UI-only) and is closed in a private
// window, except the few read-only ones named here with the reason.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

const CHANNELS = ('clips-inbox:add clips-inbox:clear clips-inbox:list clips-inbox:remove companion:publish companion:start companion:status companion:stop '
  + 'downloads:tidy-apply downloads:tidy-history downloads:tidy-plan downloads:tidy-undo extensions:usage-audit health:fix health:scan health:undo '
  + 'journal:at journal:configure journal:diff journal:forget journal:list journal:note-version journal:note-versions journal:push journal:stats '
  + 'kb:context kb:forget kb:keep-out kb:keep-out-clear kb:plan kb:put kb:related kb:related-page kb:search kb:status kb:step kb:sync-archive '
  + 'packs:discard packs:export packs:generate-key packs:install packs:items packs:list packs:pick-file packs:preview packs:set-enabled packs:set-global '
  + 'packs:trust-key packs:uninstall packs:untrust-key playground:send privacy:report privacy:report-clean quiet:drop quiet:get quiet:held quiet:release '
  + 'quiet:set screen-share:preflight tabsnap:clear tabsnap:load tabsnap:save tuning:advise tuning:forget tuning:history websafety:allow-host websafety:check websafety:forget-host '
  + 'websafety:get websafety:set-paranoid websafety:set-sensitivity').split(' ');

// Open to a private window on purpose: they only read what the window already
// shows (the safety level; the verdict for one address) or are another feature's
// own channel that predates this list.
const PRIVATE_OK = new Set(['websafety:get', 'websafety:check', 'screen-share:preflight']);

const policySrc = read('src', 'main', 'ipc-policy.js');
const PRIVATE_DISABLED = eval(policySrc.match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]); // eslint-disable-line no-eval
const schemas = read('src', 'main', 'ipc-schemas.js');
const schemaNames = new Set();
for (const m of schemas.matchAll(/define\(\s*'([^']+)'/g)) for (const n of m[1].split(/\s+/)) schemaNames.add(n);
const preload = read('src', 'preload.js');
const preloadNames = new Set([...preload.matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*'([^']+)'/g)].map(m => m[1]));

describe('channels added by the 2026-10 features', () => {
  it('each has a payload schema', () => {
    expect(CHANNELS.filter(c => !schemaNames.has(c))).toEqual([]);
  });
  it('each is exposed by the preload', () => {
    expect(CHANNELS.filter(c => !preloadNames.has(c))).toEqual([]);
  });
  it('each is for Vex\'s own window only', () => {
    expect(CHANNELS.filter(c => !UI_ONLY_CHANNELS.has(c))).toEqual([]);
  });
  it('each is closed in a private window, except the read-only ones named above', () => {
    expect(CHANNELS.filter(c => !PRIVATE_OK.has(c) && !PRIVATE_DISABLED.test(c))).toEqual([]);
  });
  it('no channel is handled twice', () => {
    const files = ['src/main.js', ...fs.readdirSync(path.resolve(__dirname, '../../src/main')).filter(f => f.endsWith('.js')).map(f => 'src/main/' + f)];
    const seen = new Map();
    for (const f of files) {
      for (const m of read(f).matchAll(/ipcMain\.(?:handle|once)\(\s*'([^']+)'/g)) seen.set(m[1], (seen.get(m[1]) || []).concat(f));
    }
    expect([...seen].filter(([, v]) => v.length > 1).map(([k]) => k)).toEqual([]);
  });
});
