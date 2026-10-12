// @vitest-environment jsdom
//
// Ctrl+Alt+1..3 run the first three command chains (app.js), outside the
// shortcut registry. The editor gave them to another command with no warning,
// and from inside a page they did nothing because the window never asked main
// for them (found 2026-10-10).

import { describe, it, expect, beforeAll, vi } from 'vitest';

let SR;
beforeAll(() => {
  localStorage.clear();
  globalThis.CommandBar = { commands: [{ id: 'toolbox', label: 'Toolbox', action() {} }] };
  window.vex = { setGuestShortcutKeys: vi.fn() };
  SR = require('../../src/renderer/js/shortcuts-registry.js');
  SR.init();
});

describe('command-chain keys', () => {
  it('the editor reports Ctrl+Alt+1 as taken', () => {
    expect(SR.setShortcut('cmd:toolbox', 'Ctrl+Alt+1')).toEqual({ conflict: 'fixed', conflictLabel: 'Run command chain 1' });
    expect(SR.setShortcut('tasks', 'Ctrl+Alt+3')).toEqual({ conflict: 'fixed', conflictLabel: 'Run command chain 3' });
  });

  it('main is asked for them, so they work from inside a page', () => {
    SR._tellMain();
    const sent = window.vex.setGuestShortcutKeys.mock.calls.at(-1)[0];
    for (const k of ['Ctrl+Alt+1', 'Ctrl+Alt+2', 'Ctrl+Alt+3']) expect(sent).toContain(k);
  });
});
