// @vitest-environment jsdom
//
// A module listed in lazy-boot.js LATE_MODULES loads after the window's load event, at an idle moment.
// The call app.js makes at start-up (`if (typeof X !== 'undefined') X.init()`) runs before the file
// exists, so it is skipped without a word. links-windows.js relied on that call, and for that reason
// the "Links and windows" Settings section and Ctrl+K "Reopen closed window" were never registered.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

describe('links-windows.js starts itself when it loads late', () => {
  let groups, extras;
  beforeEach(() => {
    localStorage.clear();
    window.showToast = vi.fn();
    groups = { register: vi.fn() };
    extras = { registerCommand: vi.fn() };
    globalThis.VexSettingsGroups = groups;
    globalThis.VexExtras = extras;
    globalThis.VexJumpActions = { enabled: () => false, setEnabled() {} };
  });

  it('registers its Settings section and the reopen command at load, with nobody calling init()', () => {
    const { VexLinksWindowsSettings } = fresh(ROOT + '/links-windows.js');
    expect(groups.register).toHaveBeenCalledTimes(1);
    expect(groups.register.mock.calls[0][0]).toMatchObject({ id: VexLinksWindowsSettings.ID, title: 'Links and windows' });
    expect(extras.registerCommand).toHaveBeenCalledTimes(1);
    expect(extras.registerCommand.mock.calls[0][0]).toMatchObject({ id: 'reopen-window', label: 'Reopen closed window' });
  });

  it('a second init() (app.js still makes its call when the file was loaded early) registers nothing twice', () => {
    const { VexLinksWindowsSettings } = fresh(ROOT + '/links-windows.js');
    VexLinksWindowsSettings.init();
    VexLinksWindowsSettings.init();
    expect(groups.register).toHaveBeenCalledTimes(1);
    expect(extras.registerCommand).toHaveBeenCalledTimes(1);
  });
});

describe('the whole class: a late module that another file calls init() on starts itself', () => {
  const lazy = fs.readFileSync(path.join(ROOT, 'lazy-boot.js'), 'utf8');
  const late = [...lazy.matchAll(/src:\s*'js\/([^']+\.js)'/g)].map(m => m[1]).filter(f => fs.existsSync(path.join(ROOT, f)));
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const sources = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  const read = (f) => sources[f] !== undefined ? sources[f] : fs.readFileSync(path.join(ROOT, f), 'utf8');   // fun/ files sit in a sub-folder

  it('finds the late modules', () => { expect(late.length).toBeGreaterThan(20); });

  it('every global that another file init()s is also started by its own file', () => {
    const problems = [];
    for (const f of late) {
      const names = [...new Set([...read(f).matchAll(/window\.([A-Za-z0-9_]+)\s*=/g)].map(m => m[1]))];
      for (const n of names) {
        const caller = new RegExp('(^|[^A-Za-z0-9_.])' + n + '\\.init\\s*\\(');
        const callers = files.filter(g => g !== f && caller.test(sources[g]));
        if (!callers.length) continue;
        // The module starts itself with a top-level `... N.init();` (not a method definition).
        const selfStart = new RegExp('^[^\\n]*\\b' + n + '\\.init\\s*\\(\\s*\\)\\s*;', 'm');
        if (!selfStart.test(read(f))) problems.push(f + ' (' + n + ') is called by ' + callers.join(', ') + ' but never starts itself');
      }
    }
    expect(problems).toEqual([]);
  });
});
