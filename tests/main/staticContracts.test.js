// T0-004: static contract tests. Four cheap checks that read the source and
// need no browser:
//
//   1. every `vex:*` DOM event that is dispatched is used somewhere else, and
//      every one that is used is dispatched by something
//   2. no renderer code reads a lexical-only global as window.X
//      (tests/renderer/globalsOnWindow.test.js covers the top folder; this walks
//      every renderer folder, and `let` / `class` declarations too)
//   3. ipcMain channels vs payload schemas vs preload calls vs the policy lists
//   4. every require() of a package in src/ is a declared runtime dependency
//
// The tree passes today. Where it carries a known legacy exception the
// exception is listed below WITH A REASON; the lists may only shrink. A new
// violation fails the test: fix it, do not add to a list.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const ROOT = path.resolve(__dirname, '../..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(rel, ext, out); }
    else if (ext.test(e.name)) out.push(rel);
  }
  return out;
}

// Blank comments (keeping offsets and newlines) so a comment about a thing is not the thing.
function stripComments(src) {
  const blank = (m) => m.split('\n').map(seg => ' '.repeat(seg.length)).join('\n');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (m, p) => p + ' '.repeat(m.length - p.length));
}

// Whole-line comments only. The full stripper above can be fooled by a quote or
// a slash inside a regular expression in a very large file (main.js), and then
// swallows real code; for the channel and require scans a missed trailing
// comment is the lesser evil.
function stripLineComments(src) {
  return src.replace(/^[ \t]*(?:\/\/|\*|\/\*).*$/gm, '');
}

// ---- 1. events ---------------------------------------------------------------
// Legacy exceptions. Each is an event Vex dispatches as an extension point for
// future listeners, or a hook another builder is expected to consume; none has
// a listener today. Remove an entry when it gets one.
const EVENTS_DISPATCHED_NEVER_USED = new Map([
  ['vex:note-saved', 'Wave 6: a saved note announces itself (with the feature that saved it) so a count shown anywhere can refresh; src has no listener yet, tests/renderer/inboxOrigins.test.js listens'],
  ['vex:actions-board', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:courses-changed', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:ci-failure', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:endpoint-health', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:dep-radar', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:deploy-desk', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:electron-ticker', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:exams-changed', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:exam-mode', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:form-rescue-changed', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:game-warmdown', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:github-vault', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:study-block', 'Wave 1/2: the feature announces its state change for later consumers; none listens yet'],
  ['vex:agent-kill', 'agent run cancelled: dispatched for extension points'],
  ['vex:autopilot-done', 'telemetry hook'],
  ['vex:brief-changed', 'state-changed notification, no consumer yet'],
  ['vex:ui-scale-changed', 'state-changed notification, no consumer yet'],
  ['vex:font-changed', 'state-changed notification, no consumer yet'],
  ['vex:challenge-changed', 'state-changed notification, no consumer yet'],
  ['vex:discovery-changed', 'state-changed notification, no consumer yet'],
  ['vex:problem', 'state-changed notification, no consumer yet'],
  ['vex:level-up', 'state-changed notification, no consumer yet'],
  ['vex:levels-changed', 'state-changed notification, no consumer yet'],
  ['vex:offline-pages-changed', 'state-changed notification, no consumer yet'],
  ['vex:routine-suggested', 'state-changed notification, no consumer yet'],
  ['vex:panel-keepawake', 'state-changed notification, no consumer yet'],
  ['vex:skin-changed', 'state-changed notification, no consumer yet'],
  ['vex:smart-bookmark', 'state-changed notification, no consumer yet'],
  ['vex:snooze-due', 'state-changed notification, no consumer yet'],
  ['vex:widgets-changed', 'state-changed notification, no consumer yet'],
  ['vex:cosmetics-changed', 'state-changed notification, no consumer yet'],
  ['vex:extras-changed', 'state-changed notification, no consumer yet'],
  ['vex:fortune-changed', 'state-changed notification, no consumer yet'],
  ['vex:title-changed', 'state-changed notification, no consumer yet'],
  ['vex:coop-timer', 'co-op timer state; published for other modules, no consumer yet'],
  ['vex:medal-display', 'part of the VexMedals event API (vex-medals.js header), no consumer yet'],
  ['vex:medal-progress', 'part of the VexMedals event API (vex-medals.js header), no consumer yet'],
  ['vex:medal-profile', 'part of the VexMedals event API (vex-medals.js header), no consumer yet'],
  // Wave 0 state-changed notifications: published so a later feature can follow them without an import.
  ['vex:newtab-layout', 'NewTabSlots.setLayout(): the New Tab layout changed; the page re-reads it on open, no in-window consumer yet'],
  ['vex:consent', 'VexDefaults consent given or withdrawn; no in-window consumer yet'],
  // Wave 3: announced for later consumers; none listens yet.
  ['vex:feature-reset', 'the feature sheet reset a feature\'s data; no in-window consumer yet'],
  ['vex:storage-scope-changed', 'the storage ledger scope of a feature changed; no in-window consumer yet'],
  ['vex:study-glossary', 'the study glossary changed; no in-window consumer yet'],
  ['vex:study-ledger', 'the study ledger changed; no in-window consumer yet'],
  ['vex:quiet-defaults-changed', 'VexQuietDefaults.reveal/showAll/quietAgain; the Clock panel and the site panel read hidden() each time they open, so no in-window consumer needs it yet'],
  ['vex:playfulness-changed', 'VexPlayfulness.setLevel(); the Play flags already tell their followers through vex:play-changed'],
]);
// Used but never dispatched under that literal name.
// (Empty since Wave 0 integration: vex:streak-updated is now dispatched by brief-extras/streaks.js, vex:newtab-profile by
// time-of-day.js with a literal name, and the never-fired vex:sound listener was dropped.)
const EVENTS_USED_NEVER_DISPATCHED = new Map([]);

function scanEvents() {
  const files = walk('src', /\.(?:js|html)$/);
  const dispatched = new Map(), used = new Map();
  const add = (map, name, file) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(file); };
  for (const file of files) {
    const src = stripLineComments(read(file));
    // Dispatch forms: new CustomEvent('vex:x'), new root.CustomEvent(...), new Event('vex:x'),
    // emit('vex:x'), and webContents.send('vex:x') (main telling the window). The
    // `const emit = (name, detail) => ...` helper pattern is covered by the literal at
    // each emit(...) call site.
    const SENDER = String.raw`(?:new\s+[\w.]*(?:Custom)?Event|\bemit|\bdispatch|\bfire|\.send)\(\s*$`;
    for (const m of src.matchAll(/['"`](vex:[\w:.-]+)['"`]/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (new RegExp(SENDER).test(before)) add(dispatched, m[1], file);
      else add(used, m[1], file);
    }
  }
  return { dispatched, used };
}

describe('vex:* events have a sender and a user', () => {
  const { dispatched, used } = scanEvents();
  it('finds the events (the scanner is not blind)', () => {
    expect(dispatched.size).toBeGreaterThan(40);
    expect(used.size).toBeGreaterThan(30);
  });
  it('every dispatched event is used somewhere, or is a listed legacy exception', () => {
    const orphans = [...dispatched.keys()].filter(n => !used.has(n) && !EVENTS_DISPATCHED_NEVER_USED.has(n));
    expect(orphans, `dispatched but never listened for or read: ${orphans.join(', ')}. Add the listener, or stop dispatching.`).toEqual([]);
  });
  it('every used event is dispatched somewhere, or is a listed legacy exception', () => {
    // IPC channel names that happen to start with vex: are not DOM events.
    const { handled, preloaded } = ipcFacts();
    const dead = [...used.keys()].filter(n => !dispatched.has(n) && !EVENTS_USED_NEVER_DISPATCHED.has(n) && !handled.has(n) && !preloaded.has(n));
    expect(dead, `listened for but nothing dispatches them: ${dead.join(', ')}. A listener for an event that never fires is a feature that does nothing.`).toEqual([]);
  });
  it('the legacy exception lists contain no entry that is now fine', () => {
    // Informational ratchet: an entry that gained a listener must be deleted.
    const fixed = [...EVENTS_DISPATCHED_NEVER_USED.keys()].filter(n => used.has(n) || !dispatched.has(n));
    expect(fixed, `remove from EVENTS_DISPATCHED_NEVER_USED: ${fixed.join(', ')}`).toEqual([]);
  });
});

// ---- 2. lexical globals ---------------------------------------------------------
describe('lexical-only globals are not read as window.X anywhere in the renderer', () => {
  const files = walk('src/renderer', /\.js$/);
  const lexical = new Set(), published = new Set();
  const sources = new Map(files.map(f => [f, read(f)]));
  for (const [, src] of sources) {
    for (const m of src.matchAll(/^(?:const|let|class) ([A-Z][A-Za-z0-9_]*)\b/gm)) lexical.add(m[1]);
    for (const m of src.matchAll(/(?:window|globalThis|self)\.([A-Z][A-Za-z0-9_]*)\s*=[^=]/g)) published.add(m[1]);
    for (const m of src.matchAll(/Object\.defineProperty\(\s*window\s*,\s*['"]([A-Z]\w*)['"]/g)) published.add(m[1]);
  }
  // Reads that predate this test; each is guarded or dead. Format "file:name".
  const LEGACY = new Set([]);
  it('finds the globals (the scanner is not blind)', () => {
    expect(lexical.size).toBeGreaterThan(100);
    expect(lexical.has('TabManager')).toBe(true);
  });
  it('no window.X / globalThis.X read of a name that is only a top-level const, let or class', () => {
    const offenders = [];
    for (const [file, raw] of sources) {
      stripComments(raw).split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/(?:window|globalThis|self)\.([A-Z][A-Za-z0-9_]*)\s*(?:\?\.|\.[a-z]|\[|\()/g)) {
          const name = m[1];
          if (!lexical.has(name) || published.has(name)) continue;
          if (/typeof\s+[A-Z][A-Za-z0-9_]*\s*!==\s*'undefined'/.test(line)) continue;
          if (LEGACY.has(file + ':' + name)) continue;
          offenders.push(`${file}:${i + 1}  window.${name} is declared with const/let/class and never put on window, so it is undefined`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
  it('the scanner still flags the real mistake', () => {
    const hit = (src) => stripComments(src).split('\n').some(l => /(?:window|globalThis|self)\.([A-Z][A-Za-z0-9_]*)\s*(?:\?\.|\.[a-z]|\[|\()/.test(l));
    expect(hit('window.TabManager?.open();')).toBe(true);
    expect(hit('globalThis.CommandBar.show()')).toBe(true);
    expect(hit('// window.TabManager.open()')).toBe(false);
  });
});

// ---- 3. IPC ----------------------------------------------------------------------
// Channels handled in main that are third-party and so carry no Vex payload schema.
const IPC_NO_SCHEMA = new Map([
  ['@ghostery/adblocker/inject-cosmetic-filters', 'the ad blocker library\'s own channel; main/ipc-policy.js special-cases it'],
  ['@ghostery/adblocker/is-mutation-observer-enabled', 'the ad blocker library\'s own channel; main/ipc-policy.js special-cases it'],
]);

function ipcFacts() {
  const mainFiles = [...new Set(['src/main.js', ...walk('src/main', /\.js$/), ...fs.readdirSync(path.join(ROOT, 'src')).filter(f => /\.js$/.test(f) && !f.startsWith('preload')).map(f => 'src/' + f)])];
  const handled = new Map();
  for (const f of mainFiles) for (const m of stripLineComments(read(f)).matchAll(/ipcMain\.(?:handle|on|once|handleOnce)\(\s*['"`]([^'"`]+)['"`]/g)) handled.set(m[1], (handled.get(m[1]) || []).concat(f));
  const schemaNames = new Set();
  for (const m of read('src/main/ipc-schemas.js').matchAll(/define\(\s*'([^']+)'/g)) for (const n of m[1].split(/\s+/)) schemaNames.add(n);
  const preloaded = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.startsWith('preload') || f === 'userscripts-preload.js' || f === 'site-tweaks.js')) {
    for (const m of stripLineComments(read('src', f)).matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*['"`]([^'"`]+)['"`]/g)) preloaded.set(m[1], (preloaded.get(m[1]) || []).concat(f));
  }
  return { handled, schemaNames, preloaded };
}

describe('ipcMain vs schema vs preload vs policy', () => {
  const { handled, schemaNames, preloaded } = ipcFacts();
  const policy = read('src/main/ipc-policy.js');
  const listed = (name) => {
    const m = policy.match(new RegExp('const ' + name + ' = new Set\\(\\[([\\s\\S]*?)\\]\\);'));
    expect(m, name + ' not found in ipc-policy.js').toBeTruthy();
    return [...m[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map(x => x[1]);
  };
  it('finds the channels (the scanner is not blind)', () => {
    expect(handled.size).toBeGreaterThan(300);
    expect(schemaNames.size).toBeGreaterThan(300);
    expect(preloaded.size).toBeGreaterThan(300);
  });
  it('every handled channel has a payload schema, except the named third-party ones', () => {
    const missing = [...handled.keys()].filter(c => !schemaNames.has(c) && !IPC_NO_SCHEMA.has(c));
    expect(missing, `ipcMain handles these with no schema in main/ipc-schemas.js: ${missing.join(', ')}`).toEqual([]);
  });
  it('every channel a preload calls is handled in main (no call into the void)', () => {
    const dead = [...preloaded.keys()].filter(c => !handled.has(c));
    expect(dead, `a preload calls these but no ipcMain handler exists: ${dead.join(', ')}`).toEqual([]);
  });
  it('every schema is used by a handler or a preload call (no stale contract)', () => {
    const stale = [...schemaNames].filter(c => !handled.has(c) && !preloaded.has(c));
    expect(stale, `schemas for channels nothing handles or calls: ${stale.join(', ')}`).toEqual([]);
  });
  it('every channel named in the policy lists is a real channel (a typo here is a silent hole)', () => {
    const known = (c) => handled.has(c) || schemaNames.has(c) || preloaded.has(c);
    const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
    const unknown = [
      ...[...UI_ONLY_CHANNELS].filter(c => !known(c)).map(c => 'UI_ONLY ' + c),
      ...listed('GUEST_CHANNELS').filter(c => !known(c)).map(c => 'GUEST ' + c),
      ...listed('TARGET_CHANNELS').filter(c => !known(c)).map(c => 'TARGET ' + c),
    ];
    expect(unknown).toEqual([]);
  });
  it('no channel is both reachable by a page and UI-only', () => {
    const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
    const both = listed('GUEST_CHANNELS').filter(c => UI_ONLY_CHANNELS.has(c));
    expect(both).toEqual([]);
  });
});

// ---- 4. require() vs declared dependencies --------------------------------------
describe('require() in src/ vs package.json dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  const runtime = new Set(Object.keys(pkg.dependencies || {}));
  // electron is provided by the runtime, not by node_modules in the package.
  const PROVIDED = new Map([['electron', 'the Electron runtime provides it']]);
  const builtins = new Set(builtinModules);
  function bareRequires() {
    const out = new Map();
    for (const file of walk('src', /\.js$/)) {
      for (const m of stripLineComments(read(file)).matchAll(/(?<![\w.$])require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const name = m[1];
        if (name.startsWith('.') || name.startsWith('/') || name.startsWith('node:') || builtins.has(name) || builtins.has(name.split('/')[0])) continue;
        const root = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
        out.set(root, (out.get(root) || new Set()).add(file));
      }
    }
    return out;
  }
  it('every package src/ requires is a runtime dependency (build.files omits node_modules otherwise)', () => {
    const missing = [];
    for (const [name, files] of bareRequires()) {
      if (runtime.has(name) || PROVIDED.has(name)) continue;
      const where = (pkg.devDependencies || {})[name] ? 'is only a devDependency' : 'is not declared at all';
      missing.push(`${name} ${where}; required by ${[...files].slice(0, 3).join(', ')}`);
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });
  it('finds the requires (the scanner is not blind)', () => {
    const names = [...bareRequires().keys()];
    expect(names).toContain('adm-zip');
    expect(names).toContain('electron');
  });
});
