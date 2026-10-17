// Every IPC channel the 2026-10 features added has a schema, a preload entry, is
// reachable only from Vex's own window (UI-only) and is closed in a private
// window, except the few read-only ones named here with the reason.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

const CHANNELS = ('clips-inbox:add clips-inbox:clear clips-inbox:list clips-inbox:remove companion:publish companion:start companion:status companion:stop '
  + 'downloads:set-media-names downloads:set-ask-types downloads:release-assist downloads:mods-plan downloads:mods-apply downloads:mods-undo downloads:mods-history downloads:extract-here downloads:tidy-apply downloads:tidy-history downloads:tidy-plan downloads:tidy-undo downloads:motw-check downloads:open-defender extensions:usage-audit health:fix health:scan health:undo '
  + 'journal:at journal:configure journal:diff journal:forget journal:list journal:note-version journal:note-versions journal:push journal:stats '
  + 'kb:context kb:forget kb:keep-out kb:keep-out-clear kb:plan kb:put kb:related kb:related-page kb:search kb:status kb:step kb:sync-archive '
  + 'packs:discard packs:export packs:generate-key packs:install packs:items packs:list packs:pick-file packs:preview packs:set-enabled packs:set-global '
  + 'packs:trust-key packs:uninstall packs:untrust-key playground:send repos:pick-folder privacy:report privacy:report-clean quiet:drop quiet:get quiet:held quiet:release '
  + 'devbench:requests devbench:overrides-get devbench:overrides-set devbench:overrides-active devbench:overrides-state devbench:overrides-pick-file '
  + 'devbench:log-pick-file devbench:log-follow-socket devbench:log-poll devbench:log-stop devbench:log-list devbench:pkg '
  + 'quiet:set screen-share:preflight signout:why commit:state tabsnap:clear tabsnap:load tabsnap:save tuning:advise tuning:forget tuning:history websafety:allow-host websafety:check websafety:forget-host '
  + 'websafety:get websafety:set-paranoid websafety:set-sensitivity '
  + 'devdesk:config devdesk:set-config devdesk:grant-root devdesk:revoke-root devdesk:open-file devdesk:open-terminal devdesk:branch devdesk:ports '
  + 'devext:pick devext:reload devext:stop devext:status devext:vencord castlabs:behind panelguard:throttle '
  + 'discord:heap-begin discord:heap-end discord:heap-usage profilecrypt:status profilecrypt:enable profilecrypt:disable profilecrypt:change profilecrypt:new-recovery '
  + 'transcribe:config transcribe:pick transcribe:clear transcribe:set transcribe:begin transcribe:chunk transcribe:end').split(' ');

// Open to a private window on purpose: they only read what the window already
// shows (the safety level; the verdict for one address) or are another feature's
// own channel that predates this list.
const PRIVATE_OK = new Set(['websafety:get', 'websafety:check', 'screen-share:preflight', 'commit:state']);

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
