// @vitest-environment jsdom
//
// The whole Toolbox catalogue together: the four packs load side by side, no
// id is used twice (packs or hand-built tools), every family is known, and
// every pack tool opens in the shared screen with a result or a plain error
// message on its default inputs — never a crash, never "NaN"/"undefined".
// Each pack's own test file checks its examples in detail.

import { describe, it, expect, beforeAll } from 'vitest';

const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
// Pack tools open on the shared workbench now, so it has to be present.
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { ToolboxWorkbench } = require('../../src/renderer/js/toolbox-workbench.js');
globalThis.ToolboxWorkbench = ToolboxWorkbench; global.window.ToolboxWorkbench = ToolboxWorkbench;
global.window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { Toolbox } = require('../../src/renderer/js/toolbox.js');

const PACK_FILES = ['toolbox-pack-text.js', 'toolbox-pack-units-math-science.js', 'toolbox-pack-money-date-health.js', 'toolbox-pack-dev-data-web.js', 'toolbox-pack-encoding-net-css.js'];

// With ToolboxPacks global (as in the app), each pack registers itself when
// loaded — the same path index.html takes.
beforeAll(() => {
  ToolboxPacks.specs = [];
  for (const f of PACK_FILES) require('../../src/renderer/js/' + f);
});

describe('Toolbox catalogue', () => {
  it('has hundreds of tools with unique ids across packs and hand-built tools', () => {
    const ids = Toolbox.all().map(t => t.id);
    expect(ids.length).toBeGreaterThanOrEqual(300);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tool belongs to a known family and has a name and description', () => {
    for (const t of Toolbox.all()) {
      expect(ToolboxPacks.FAMILIES[t.family], t.id).toBeTruthy();
      expect(t.name && t.desc, t.id).toBeTruthy();
    }
  });

  // `icon` is optional and falls back to the family's — but when a tool does
  // carry one it must be short typographic text, never an emoji.
  it('a tool that sets its own icon uses short typographic text', () => {
    for (const t of Toolbox.all()) {
      if (t.icon === undefined) continue;
      expect(typeof t.icon === 'string' && t.icon.length > 0, t.id).toBe(true);
      expect(/\p{Extended_Pictographic}/u.test(t.icon), t.id).toBe(false);
    }
  });

  it('every pack tool opens in the shared screen with a clean result or error', () => {
    for (const spec of ToolboxPacks.specs) {
      document.body.innerHTML = '';
      expect(() => Toolbox.openTool(spec.id), spec.id).not.toThrow();
      const shell = document.getElementById('vex-workbench');
      expect(shell, spec.id).toBeTruthy();
      // The result pane has to be real — an empty shell would pass a "did it
      // open" check while being useless.
      const out = document.getElementById('wb-out');
      expect(out, spec.id).toBeTruthy();
      // What the tool PRODUCES must never be NaN or undefined. The reference
      // panel is deliberately excluded: math-two-points documents a vertical
      // line, whose slope genuinely is "undefined", and banning the word from
      // a tool's own documentation would be the wrong lesson to teach.
      const text = out.textContent + ' ' + (document.getElementById('wb-note')?.textContent || '');
      expect(text, spec.id).not.toMatch(/\bNaN\b|\bundefined\b|\[object Object\]|Invalid Date/);
    }
    // Every tool in the catalogue is rendered for real, so this one test does
    // more DOM work than the default 5s budget allows once the suite runs the
    // files in parallel. Slow, not hanging.
  }, 60000);
});
