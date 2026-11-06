// @vitest-environment jsdom
//
// "Do you want a sidebar?" -> yes: EVERY look shows an icon rail, drawn in that look's own materials (asked 2026-11-06: choosing
// Chrome after "yes" made the sidebar disappear). No: the rail stays gone in every look (css/sidebar-visibility.css).
// What is drawn is checked in the real window (scripts/check-ui.js, and screenshots of every look); jsdom has no layout, so this
// keeps the wiring: no rule hides the rail for a look, each look has a rail skin, and the answer is the only switch.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
// The checkout has CRLF line endings on Windows (and on CI): the multi-line CSS the tests look for is written with LF.
const css = (f) => readFileSync(resolve(ROOT, 'src/renderer/css/' + f), 'utf8').replace(/\r\n/g, '\n');
const BROWSER = css('gui-browser.css');
const GROUPS = css('sidebar-groups.css');
const VISIBILITY = css('sidebar-visibility.css');

// The looks whose browser has no icon rail of its own: they used to open panels from a toolbar button only.
const TOOLBAR_LOOKS = ['chrome', 'chrome-dark', 'safari', 'xp', 'fluent', 'fluent-dark', 'glossy'];
const RIGHT_LOOKS = ['chrome', 'chrome-dark', 'fluent', 'fluent-dark'];

async function loadStyles() {
  vi.resetModules();
  document.body.innerHTML = '';
  await import('../../src/renderer/js/gui-style.js');
  return window.VexGuiStyle;
}

beforeEach(() => { delete window.VexGuiStyle; localStorage.clear(); });

describe('the rail is not hidden for any look when a sidebar is wanted', () => {
  it('no rule hides #icon-sidebar for a look without a rail launcher', () => {
    expect(BROWSER).not.toMatch(/not\(\[data-sb-launcher="rail"\]\)[^{]*#icon-sidebar/);
    // The only rules that hide the rail in the look file: Firefox's / Netscape's own hide button, and nothing else.
    const hides = BROWSER.split('\n').filter(l => /#icon-sidebar \{[^}]*display: none/.test(l));
    expect(hides).toHaveLength(1);
    expect(hides[0]).toContain('.look-rail-hidden');
  });

  it('the answer "no" still hides the rail in every look, with the doubled id that beats a look\'s own display rule', () => {
    expect(VISIBILITY).toMatch(/body\[data-sidebar="off"\] #icon-sidebar#icon-sidebar[^{]*\{ display: none !important; \}/);
  });

  it('the shared rail skin applies to every look that has a sidebar (data-sb-side), not only the rail launchers', () => {
    expect(BROWSER).toMatch(/^body\[data-sb-side\] #icon-sidebar \{/m);
    expect(BROWSER).toMatch(/^body\[data-sb-side\] :is\(#icon-sidebar \.sidebar-icon, #tools-bar \.tool-icon\) \{/m);
    expect(BROWSER).not.toMatch(/^body\[data-sb-launcher="rail"\] #icon-sidebar \{/m);
    expect(GROUPS).toMatch(/^body\[data-sb-side\]:not\(\.tabs-hidden\) #icon-sidebar\[data-sb-grouped="1"\] \{/m);
  });
});

describe('every look has a sidebar and a rail skin of its own', () => {
  it('every look except Classic is registered with a side and a launcher, so gui-style.js stamps data-sb-side for it', async () => {
    const G = await loadStyles();
    const ids = G.styles();
    expect(ids.length).toBe(14);
    for (const id of ids) {
      if (id === 'classic') continue;
      expect(['rail', 'toolbar'], id).toContain(G.launcher(id));
    }
    for (const id of TOOLBAR_LOOKS) expect(G.launcher(id), id).toBe('toolbar');
  });

  for (const id of ['chrome', 'safari', 'xp', 'fluent', 'glossy']) {
    it(`${id}: paints its own rail (its own surface for #icon-sidebar and its own button tokens)`, () => {
      const sel = id === 'chrome' ? '[data-gui-style="chrome"], [data-gui-style="chrome-dark"]'
        : id === 'fluent' ? '[data-gui-style="fluent"], [data-gui-style="fluent-dark"]' : `[data-gui-style="${id}"]`;
      const multi = sel.includes(',');
      const lead = multi ? `body:is(${sel})` : `body${sel}`;
      expect(BROWSER, id).toContain(`${lead} #icon-sidebar {`);
      expect(BROWSER, id).toContain(`${lead} {\n  --b-rail-w:`);
      expect(BROWSER, id).toMatch(new RegExp('--b-rail-active:'));
    });
  }

  it('the right-hand looks (Chrome, Edge) put the rail on the right of the page, the left-hand ones keep it on the left', async () => {
    expect(BROWSER).toMatch(/^body\[data-sb-side="right"\] #icon-sidebar \{ order: 3; border-right: none; border-left: 1px solid var\(--b-toolbar-border\); \}/m);
    const G = await loadStyles();
    document.body.dataset.guiStyle = 'chrome';
    // gui-style.js records each look's side; the stylesheet keys on it.
    expect(readFileSync(resolve(ROOT, 'src/renderer/js/gui-style.js'), 'utf8')).toMatch(/chrome:\s+\{[^}]*side: 'right'/);
    expect(G.launcher('chrome')).toBe('toolbar');
    for (const id of RIGHT_LOOKS) expect(readFileSync(resolve(ROOT, 'src/renderer/js/gui-style.js'), 'utf8')).toMatch(new RegExp(`'?${id}'?:\\s+\\{[^}]*side: 'right'`));
  });

  it('the fullscreen slide-in works from the right for a right-hand rail', () => {
    expect(BROWSER).toMatch(/body\.fullscreen\[data-sb-side="right"\] #icon-sidebar \{ left: auto; right: 0; transform: translateX\(100%\); \}/);
  });
});

describe('the folders and the Start tile are skinned per look', () => {
  it('a browser look rounds them with its own tokens, and each retro/bold look draws its own tile', () => {
    expect(GROUPS).toMatch(/body\[data-gui-family="browser"\] #icon-sidebar \.sb-folder \{ border-radius: var\(--b-folder-radius, 14px\); \}/);
    for (const id of ['win98', 'neobrutal', 'terminal', 'xp', 'glossy']) {
      expect(GROUPS, id).toContain(`body[data-gui-style="${id}"] #icon-sidebar .sb-folder > .sb-folder-btn.sidebar-icon`);
    }
    // The square looks set both radii to 0 so a folder is a box, not a pill.
    for (const id of ['win98', 'neobrutal', 'terminal']) expect(BROWSER, id).toContain(`body[data-gui-style="${id}"] { --b-card-radius: 0; --b-folder-radius: 0; }`);
  });

  it('every look that rounds the tile sets both tokens', () => {
    for (const lead of ['body:is([data-gui-style="chrome"], [data-gui-style="chrome-dark"])', 'body[data-gui-style="safari"]', 'body:is([data-gui-style="fluent"], [data-gui-style="fluent-dark"])', 'body[data-gui-style="xp"]', 'body[data-gui-style="glossy"]']) {
      const at = BROWSER.indexOf(lead + ' {\n  --b-rail-w:');
      expect(at, lead).toBeGreaterThan(-1);
      const block = BROWSER.slice(at, BROWSER.indexOf('}', at));
      expect(block, lead).toMatch(/--b-card-radius: \d+px/);
      expect(block, lead).toMatch(/--b-folder-radius: \d+px/);
    }
  });
});

describe('the answer is the only switch', () => {
  it('yes leaves body[data-sidebar] unset in every look, no sets it to off', async () => {
    document.body.innerHTML = '<div id="content-area"></div><div id="top-bar-right"><button id="btn-settings-top"></button></div>';
    vi.resetModules();
    require('../../src/renderer/js/vex-icons.js');
    await import('../../src/renderer/js/sidebar-visibility.js');
    const V = window.VexSidebarVisibility;
    const G = await loadStyles();
    document.body.innerHTML = '<div id="content-area"></div><div id="top-bar-right"><button id="btn-settings-top"></button></div>';
    for (const id of G.styles()) {
      document.body.dataset.guiStyle = id;
      V.setEnabled(true);
      expect(document.body.dataset.sidebar, id + ' yes').toBeUndefined();
      V.setEnabled(false);
      expect(document.body.dataset.sidebar, id + ' no').toBe('off');
    }
  });
});
