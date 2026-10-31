// @vitest-environment jsdom
//
// "Do you want a sidebar?": the wizard step (short and full version), the stored answer (vex.sidebar, js/sidebar-visibility.js),
// and the look step that follows it, which leads with the looks that suit the answer.
// What is drawn (the rail really gone, in every look) is checked in the real window, not here: jsdom has no layout.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');

const ROOT = process.cwd();

async function loadVisibility() {
  vi.resetModules();
  document.body.innerHTML = '<div id="content-area"></div><div id="top-bar-right"><button id="btn-settings-top"></button></div><input type="checkbox" id="setting-sidebar" checked>';
  await import('../../src/renderer/js/sidebar-visibility.js');
  return window.VexSidebarVisibility;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  document.body.removeAttribute('data-sidebar');
  delete window.VexSidebarVisibility;
  delete window.VexGuiStyle;
  Onboarding.step = 0; Onboarding._session = {}; Onboarding._pace = null;
  window.showToast = vi.fn();
});

describe('the step list', () => {
  it('has the sidebar question right before the look, in BOTH versions', () => {
    const all = Onboarding.STEPS().map(s => s.key);
    expect(all.indexOf('sidebar')).toBeGreaterThan(-1);
    expect(all.indexOf('sidebar')).toBe(all.indexOf('look') - 1);
    const quick = Onboarding.STEPS().filter(s => s.quick).map(s => s.key);
    expect(quick.indexOf('sidebar')).toBe(quick.indexOf('look') - 1);
    Onboarding._pace = 'quick';
    expect(Onboarding._stepsForPace().map(s => s.key)).toContain('sidebar');
    Onboarding._pace = 'full';
    expect(Onboarding._stepsForPace().map(s => s.key)).toContain('sidebar');
  });

  it('counts toward the time left and has a title and a plain explanation', () => {
    const s = Onboarding.STEPS().find(x => x.key === 'sidebar');
    expect(s.secs).toBeGreaterThan(0);
    expect(s.title).toMatch(/sidebar/i);
    expect(s.sub).toMatch(/Ctrl\+K/);
  });

  it('is "already set" only once the question was answered', async () => {
    const V = await loadVisibility();
    expect(Onboarding._isStepDone('sidebar')).toBe(false);
    V.setEnabled(false);
    expect(Onboarding._isStepDone('sidebar')).toBe(true);
  });
});

describe('the stored answer', () => {
  it('leaves the sidebar ON for a profile that never answered, and writes nothing by itself', async () => {
    const V = await loadVisibility();
    expect(V.enabled()).toBe(true);
    expect(V.chosen()).toBe(false);
    expect(localStorage.getItem('vex.sidebar')).toBe(null);
    expect(document.body.hasAttribute('data-sidebar')).toBe(false);
  });

  it('off sets body[data-sidebar], on removes it, both are remembered and tell the page', async () => {
    const V = await loadVisibility();
    const heard = vi.fn();
    window.addEventListener('vex:sidebar-visibility', heard);
    V.setEnabled(false);
    expect(document.body.dataset.sidebar).toBe('off');
    expect(localStorage.getItem('vex.sidebar')).toBe('off');
    expect(document.getElementById('setting-sidebar').checked).toBe(false);
    V.setEnabled(true);
    expect(document.body.hasAttribute('data-sidebar')).toBe(false);
    expect(localStorage.getItem('vex.sidebar')).toBe('on');
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener('vex:sidebar-visibility', heard);
  });

  it('applies a saved "off" when the page loads', async () => {
    localStorage.setItem('vex.sidebar', 'off');
    await loadVisibility();
    expect(document.body.dataset.sidebar).toBe('off');
    expect(document.getElementById('setting-sidebar').checked).toBe(false);
  });

  it('the Settings switch changes it, and a save that fails is told, not hidden', async () => {
    const V = await loadVisibility();
    const box = document.getElementById('setting-sidebar');
    box.checked = false; box.dispatchEvent(new Event('change'));
    expect(V.enabled()).toBe(false);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    box.checked = true; box.dispatchEvent(new Event('change'));
    set.mockRestore();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Could not save the sidebar setting/), 'error');
    expect(box.checked).toBe(false);
    expect(() => { vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); }); V.setEnabled(true); }).toThrow(/Could not save/);
    vi.restoreAllMocks();
  });

  it('is in the Reset to Defaults list, and the first frame is painted with it', () => {
    expect(readFileSync(resolve(ROOT, 'src/renderer/js/app.js'), 'utf8')).toMatch(/SETTINGS_PREF_KEYS = \[[\s\S]*?'vex\.sidebar'/);
    expect(readFileSync(resolve(ROOT, 'src/renderer/js/early-look.js'), 'utf8')).toMatch(/'data-sidebar'\]/);
  });

  it('is wired in index.html: the stylesheet after the looks and before a11y.css, the script, the switch and the toolbar gear', () => {
    const html = readFileSync(resolve(ROOT, 'src/renderer/index.html'), 'utf8');
    const at = (s) => html.indexOf(s);
    expect(at('css/sidebar-visibility.css')).toBeGreaterThan(at('css/gui-browser.css'));
    expect(at('css/sidebar-visibility.css')).toBeLessThan(at('css/a11y.css'));
    expect(at('src="js/sidebar-visibility.js"')).toBeGreaterThan(at('src="js/look-sidebar.js"'));
    expect(html).toContain('id="setting-sidebar"');
    expect(html).toContain('id="btn-settings-top"');
  });
});

describe('the looks that suit each answer', () => {
  it('yes leads with the rail looks, no with the toolbar looks, and nothing is lost', () => {
    const yes = Onboarding.looksForSidebar(true);
    const no = Onboarding.looksForSidebar(false);
    expect(yes.first).toEqual(['classic', 'glass', 'firefox', 'firefox-dark', 'win98', 'neobrutal', 'terminal']);
    expect(no.first).toEqual(['chrome', 'chrome-dark', 'safari', 'xp', 'fluent', 'fluent-dark', 'glossy']);
    expect([...yes.first, ...yes.rest].sort()).toEqual(Onboarding.LOOKS().map(l => l.id).sort());
    expect(no.rest).toEqual(yes.first);
  });

  it('agrees with the launcher each look really has (gui-style.js)', async () => {
    document.body.innerHTML = '';
    vi.resetModules();
    await import('../../src/renderer/js/gui-style.js');
    const G = window.VexGuiStyle;
    expect(G.styles().sort()).toEqual(Onboarding.LOOKS().map(l => l.id).sort());
    for (const id of Onboarding.LOOK_ORDER().rail) expect(G.launcher(id), id).toBe('rail');
    for (const id of Onboarding.LOOK_ORDER().toolbar) expect(G.launcher(id), id).toBe('toolbar');
    expect(() => G.launcher('nope')).toThrow(/Unknown GUI style/);
  });

  it('keeps a look that already suits, otherwise preselects the best match', () => {
    expect(Onboarding.bestLook(true, 'classic')).toBe('classic');
    expect(Onboarding.bestLook(true, 'firefox-dark')).toBe('firefox-dark');
    expect(Onboarding.bestLook(true, 'chrome')).toBe('classic');
    expect(Onboarding.bestLook(false, 'classic')).toBe('chrome');
    expect(Onboarding.bestLook(false, 'safari')).toBe('safari');
  });
});

describe('the look step, filtered by the answer', () => {
  function fakeGui(initial) {
    const g = { cur: initial, set: vi.fn((id) => { g.cur = id; return Promise.resolve(); }), get: () => g.cur, getColors: () => 'look', setColors: vi.fn() };
    window.VexGuiStyle = g;
    return g;
  }
  const ids = (body) => [...body.querySelectorAll('[data-look]')].map(b => b.dataset.look);
  const selected = (body) => [...body.querySelectorAll('[data-look]')].filter(b => b.getAttribute('style').includes('solid var(--primary)')).map(b => b.dataset.look);

  it('a no shows the toolbar looks only, applies the best one, and offers every look behind a link', () => {
    const g = fakeGui('classic');
    Onboarding._session.sidebar = false;
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderLook(body);
    expect(ids(body)).toEqual(['chrome', 'chrome-dark', 'safari', 'xp', 'fluent', 'fluent-dark', 'glossy']);
    expect(g.set).toHaveBeenCalledWith('chrome');
    expect(selected(body)).toEqual(['chrome']);
    // A pick of the look is not recorded by the preselect: only the person's own click does that.
    expect(localStorage.getItem('vex.guiStyleChosen')).toBe(null);
    body.querySelector('#ob-look-all').click();
    expect(ids(body)).toHaveLength(14);
    expect(body.querySelector('#ob-look-all')).toBe(null);
  });

  it('a yes shows the rail looks, and keeps the look already on if it suits', () => {
    const g = fakeGui('firefox');
    Onboarding._session.sidebar = true;
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderLook(body);
    expect(ids(body)).toEqual(['classic', 'glass', 'firefox', 'firefox-dark', 'win98', 'neobrutal', 'terminal']);
    expect(g.set).not.toHaveBeenCalled();
    expect(selected(body)).toEqual(['firefox']);
  });

  it('never replaces a look the person chose earlier, and shows it even when it does not suit the answer', () => {
    const g = fakeGui('glossy');
    localStorage.setItem('vex.guiStyleChosen', '1');
    Onboarding._session.sidebar = true;
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderLook(body);
    expect(g.set).not.toHaveBeenCalled();
    expect(ids(body)).toHaveLength(14);
    expect(selected(body)).toEqual(['glossy']);
  });

  it('a click on a card applies that look and records the choice', () => {
    const g = fakeGui('classic');
    Onboarding._session.sidebar = true;
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderLook(body);
    body.querySelector('[data-look="terminal"]').click();
    expect(g.set).toHaveBeenLastCalledWith('terminal');
    expect(localStorage.getItem('vex.guiStyleChosen')).toBe('1');
  });

  it('without an answer in this run it follows what the profile has now', async () => {
    const V = await loadVisibility();
    V.setEnabled(false);
    expect(Onboarding._wantsSidebar()).toBe(false);
    V.setEnabled(true);
    expect(Onboarding._wantsSidebar()).toBe(true);
  });
});

describe('the sidebar step itself', () => {
  function draw(overlayHtml = '<div id="ob-body"></div>') {
    const overlay = document.createElement('div'); overlay.innerHTML = overlayHtml; document.body.appendChild(overlay);
    const body = overlay.querySelector('#ob-body');
    Onboarding._renderSidebar(body);
    return { overlay, body };
  }

  it('offers yes and no, yes preselected on a profile that never answered', () => {
    const { body } = draw();
    const cards = [...body.querySelectorAll('[data-sb-answer]')];
    expect(cards.map(c => c.dataset.sbAnswer)).toEqual(['yes', 'no']);
    expect(cards.map(c => c.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(body.textContent).toMatch(/Ctrl\+K/);
  });

  it('shows the saved answer when the wizard is run again', async () => {
    const V = await loadVisibility();
    V.setEnabled(false);
    const { body } = draw();
    expect(body.querySelector('[data-sb-answer="no"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('a click is remembered across Back and Skip, and Save & continue stores it', async () => {
    const V = await loadVisibility();
    const { overlay, body } = draw();
    body.querySelector('[data-sb-answer="no"]').click();
    expect(Onboarding._session.sidebar).toBe(false);
    Onboarding._stash('sidebar', overlay);
    expect(Onboarding._session.sidebar).toBe(false);
    const render = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    await Onboarding._commitAndNext('sidebar', overlay);
    render.mockRestore();
    expect(V.enabled()).toBe(false);
    expect(document.body.dataset.sidebar).toBe('off');
  });

  it('says so, and stays on the step, when the answer cannot be saved', async () => {
    const overlay = document.createElement('div'); overlay.innerHTML = '<div id="ob-body"></div>'; document.body.appendChild(overlay);
    Onboarding._pendingSidebar = false;
    Onboarding.step = 4;
    const shown = vi.spyOn(Onboarding, '_showError').mockImplementation(() => {});
    await Onboarding._commitAndNext('sidebar', overlay);
    expect(shown).toHaveBeenCalledWith(overlay, expect.stringMatching(/sidebar choice was not saved/));
    expect(Onboarding.step).toBe(4);
    shown.mockRestore();
  });
});

describe('Turkish', () => {
  it('has the step title, its explanation and the strings of both steps', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/js/i18n.js'), 'utf8');
    for (const k of ['sidebar:', "'sidebar.sub':", 'sidebarYes:', 'sidebarYesSub:', 'sidebarNo:', 'sidebarNoSub:', 'sidebarNote:', 'looksSidebar:', 'looksSidebarSub:', 'looksNoSidebar:', 'looksNoSidebarSub:', 'showAllLooks:']) {
      expect(src, k).toContain(k);
    }
    const ui = readFileSync(resolve(ROOT, 'src/renderer/js/i18n-ui.js'), 'utf8');
    for (const s of ["'Show the sidebar':", "'Close this panel':"]) expect(ui, s).toContain(s);
  });
});

describe('the rules in the style sheet', () => {
  const css = readFileSync(resolve(ROOT, 'src/renderer/css/sidebar-visibility.css'), 'utf8');
  it('hides the rail and the side-panel button, and nothing of the tab list', () => {
    expect(css).toMatch(/body\[data-sidebar="off"\] #icon-sidebar#icon-sidebar/);
    expect(css).toMatch(/#btn-look-sidebar#btn-look-sidebar\s*\{\s*display: none !important/);
    expect(css).not.toMatch(/#tabs-sidebar/);
  });
});
