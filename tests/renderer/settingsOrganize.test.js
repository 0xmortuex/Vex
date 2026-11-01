// @vitest-environment jsdom
//
// Short Settings (js/settings-organize.js) and the one Developer mode switch
// (js/simple-mode.js): every section stays reachable, nothing critical sits
// behind Developer mode, a long explanation folds behind a ? without losing a
// word, and a profile's saved mode keeps meaning the same thing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
const { SettingsOrganize } = require('../../src/renderer/js/settings-organize.js');
const { VexSimpleMode } = require('../../src/renderer/js/simple-mode.js');
globalThis.SettingsOrganize = SettingsOrganize;
globalThis.VexSimpleMode = VexSimpleMode;
Element.prototype.scrollIntoView = function () {};

const ROOT = process.cwd();
const JS = join(ROOT, 'src/renderer/js');
const HTML = readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8');
const CSS = readFileSync(join(ROOT, 'src/renderer/css/simple-mode.css'), 'utf8');

// Every heading Settings can show: the page's own, and the ones modules register.
function allHeadings() {
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  const out = new Set([...doc.querySelectorAll('#panel-settings .setting-group > .setting-label')]
    .map(l => (l.querySelector('strong') || l).textContent.replace(/\s+/g, ' ').trim()));
  for (const f of readdirSync(JS).filter(n => n.endsWith('.js'))) {
    const src = readFileSync(join(JS, f), 'utf8');
    for (const m of src.matchAll(/VexSettingsGroups\.register\(\s*\{/g)) {
      const t = /title:\s*(['"`])((?:(?!\1).)*)\1/.exec(src.slice(m.index, m.index + 700));
      if (t && !t[2].includes('${')) out.add(t[2]);
    }
  }
  return [...out];
}

describe('importance of every section', () => {
  const headings = allHeadings();

  it('finds the page and the module sections (an inventory that went empty would test nothing)', () => {
    expect(headings.length).toBeGreaterThan(150);
    expect(headings).toContain('General');
    expect(headings).toContain('Health check');
  });

  it('rates every section critical, high, mid or low, and puts it in a top category (none falls into Other)', () => {
    const others = [];
    for (const h of headings) {
      const imp = SettingsOrganize.importanceOf(h);
      expect(['critical', 'high', 'mid', 'low'], h).toContain(imp);
      const cat = SettingsUI._matchCat(h.toLowerCase());
      if (cat.name === 'Other') others.push(h);
      expect(SettingsUI.TOPS.map(t => t.name), h).toContain(SettingsUI.topOf(cat));
    }
    expect(others).toEqual([]);
  });

  it('is critical exactly when the section shows without Developer mode', () => {
    for (const h of headings) {
      expect(SettingsOrganize.importanceOf(h) === 'critical', h).toBe(SettingsUI.tierOf(h) === 'basic');
    }
  });

  it('keeps everything the owner called critical out of Developer mode', () => {
    const critical = ['General', 'Default Browser', 'Appearance', 'GUI Style', 'Tab Layout', 'Sidebar Buttons', 'Privacy & Security',
      'Privacy Hardening', 'Site Permissions', 'Passwords', 'Passkeys', 'Payment cards', 'Autofill', 'Vex Sync', 'Data', 'Downloads',
      'Sessions', 'About', 'Wallpapers'];
    for (const h of critical) {
      expect(headings, h + ' is not a section any more').toContain(h);
      expect(SettingsUI.tierOf(h), h).toBe('basic');
    }
  });

  it('puts the gesture editor, sounds, packs, chains and developer tools in Developer mode', () => {
    for (const h of ['Sounds', 'Command Chains', 'Developer bench', 'Developer helpers', 'More developer tools', 'Holidays and phrases from packs',
      'Playfulness', 'Click effect', 'Mouse cursor', 'Loadout cards']) {
      expect(SettingsUI.tierOf(h), h).toBe('advanced');
    }
  });

  it('only hides sections that are advanced, and only while Developer mode is off', () => {
    const hides = [...CSS.matchAll(/([^{}]*)\{[^}]*display:\s*none\s*!important[^}]*\}/g)].map(m => m[1]).filter(sel => sel.includes('.setting-group'));
    expect(hides.length).toBeGreaterThan(0);
    for (const sel of hides) {
      expect(sel).toContain('[data-tier="advanced"]');
      expect(sel).toContain('body[data-ui-mode="simple"]');
      expect(sel).not.toContain('[data-tier="basic"]');
    }
  });
});

describe('the real Settings page, organised', () => {
  let panel, root;
  const build = () => {
    const doc = new DOMParser().parseFromString(HTML, 'text/html');
    document.body.innerHTML = doc.getElementById('panel-settings').outerHTML;
    panel = document.getElementById('panel-settings');
    root = panel.querySelector('.settings-content');
  };
  const idsOf = () => new Set([...root.querySelectorAll('[id]')].map(e => e.id).filter(id => !id.startsWith('set-info-')));
  const wordsOf = () => {
    const copy = root.cloneNode(true);
    copy.querySelectorAll('.set-more-btn, .set-dev-note, .set-radio-select, .set-info-btn, .set-nav, .set-emoji').forEach(e => e.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };

  beforeEach(() => {
    localStorage.clear();
    delete document.body.dataset.uiMode;
    build();
  });

  it('loses no id, no control and no word, and is the same when run again', () => {
    const ids = idsOf();
    const controls = root.querySelectorAll('input, select, textarea, button').length;
    const words = wordsOf();
    const first = SettingsOrganize.apply(root);
    expect(first.folded).toBeGreaterThan(5);
    expect(idsOf()).toEqual(ids);
    expect(root.querySelectorAll('input, select:not(.set-radio-select), textarea, button:not(.set-info-btn):not(.set-more-btn)').length).toBe(controls);
    expect(wordsOf()).toBe(words);
    const again = SettingsOrganize.apply(root);
    expect(again).toEqual({ folded: 0, radios: 0, more: 0 });
  });

  it('folds each long explanation behind its own ? that opens and closes it', () => {
    SettingsOrganize.apply(root);
    const btns = [...root.querySelectorAll('.set-info-btn')];
    expect(btns.length).toBeGreaterThan(5);
    for (const b of btns) {
      const target = document.getElementById(b.getAttribute('aria-controls'));
      expect(target, 'the text a ? controls').toBeTruthy();
      expect(target.classList.contains('set-info-folded')).toBe(true);
      expect(b.getAttribute('aria-expanded')).toBe('false');
      expect(b.getAttribute('aria-label')).toBe('About this setting');
    }
    btns[0].click();
    const t = document.getElementById(btns[0].getAttribute('aria-controls'));
    expect(t.classList.contains('set-info-open')).toBe(true);
    expect(btns[0].getAttribute('aria-expanded')).toBe('true');
    btns[0].click();
    expect(t.classList.contains('set-info-open')).toBe(false);
  });

  it('keeps the Game mode block of Privacy hardening, the AI mode choice and long sections behind a closed More options', () => {
    SettingsOrganize.apply(root);
    const game = document.getElementById('game-mode-settings');
    expect(game.closest('.set-more-body')).toBeTruthy();
    expect(game.closest('.set-more-body').hasAttribute('data-open')).toBe(false);
    const bodies = [...root.querySelectorAll('.set-more-body')];
    expect(bodies.length).toBeGreaterThan(3);
    for (const b of bodies) {
      expect(b.hasAttribute('data-open')).toBe(false);
      const btn = b.previousElementSibling;
      expect(btn.classList.contains('set-more-btn')).toBe(true);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('turns the AI mode radio buttons into one drop-down that still drives them', () => {
    SettingsOrganize.apply(root);
    const sel = root.querySelector('select.set-radio-select');
    expect(sel).toBeTruthy();
    expect([...sel.options].map(o => o.value)).toEqual(['auto', 'local', 'cloud']);
    const radios = [...root.querySelectorAll('input[name="ai-mode"]')];
    const seen = [];
    radios.forEach(r => r.addEventListener('change', () => seen.push(r.value)));
    sel.value = 'cloud'; sel.dispatchEvent(new Event('change'));
    expect(radios.find(r => r.checked).value).toBe('cloud');
    expect(seen).toContain('cloud');
    // A script that sets a radio later is picked up when the drop-down is used.
    radios.find(r => r.value === 'local').checked = true;
    sel.dispatchEvent(new Event('mousedown'));
    expect(sel.value).toBe('local');
  });

  it('every section is critical (in Settings for everyone) or Developer mode\'s, and every one is found by the search', () => {
    SettingsUI.enhance();
    const groups = [...root.querySelectorAll(':scope > .setting-group')];
    expect(groups.length).toBeGreaterThan(40);
    for (const g of groups) expect(['basic', 'advanced']).toContain(g.dataset.tier);
    const critical = groups.filter(g => g.dataset.tier === 'basic').length;
    expect(critical).toBeGreaterThan(10);
    expect(critical).toBeLessThan(groups.length);
    const search = panel.querySelector('.set-search');
    for (const g of groups) {
      const label = (g.querySelector(':scope > .setting-label strong') || g.querySelector(':scope > .setting-label')).textContent.replace(/\s+/g, ' ').trim();
      search.value = label;
      search.dispatchEvent(new Event('input'));
      expect(g.style.display, 'searching "' + label + '"').toBe('');
    }
  });

  it('a search that reaches Developer mode says so and offers to turn it on', () => {
    SettingsUI.enhance();
    document.body.dataset.uiMode = 'simple';
    localStorage.setItem('vex.uiMode', 'simple');
    const search = panel.querySelector('.set-search');
    search.value = 'MCP Servers';
    search.dispatchEvent(new Event('input'));
    const note = root.querySelector(':scope > .set-dev-note');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('Developer mode');
    note.querySelector('button').click();
    expect(localStorage.getItem('vex.uiMode')).toBe('full');
    // No advanced result, or Developer mode on: nothing to say.
    document.body.dataset.uiMode = 'simple';
    SettingsOrganize.devNote(root, 0);
    expect(root.querySelector(':scope > .set-dev-note').hidden).toBe(true);
    document.body.dataset.uiMode = 'full';
    SettingsOrganize.devNote(root, 3);
    expect(root.querySelector(':scope > .set-dev-note').hidden).toBe(true);
  });

  it('opens what hides a section the user is taken to (a deep link, a result)', () => {
    SettingsOrganize.apply(root);
    const game = document.getElementById('game-mode-settings');
    const inner = game.querySelector('input, button, select') || game;
    SettingsUI.reveal(inner);
    expect(game.closest('.set-more-body').hasAttribute('data-open')).toBe(true);
    expect(game.closest('.set-more-body').previousElementSibling.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('what is folded, and what is left alone', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="panel-settings"><div class="settings-content">
      <div class="setting-group" id="g"><label class="setting-label">Thing</label>
        <p class="setting-info" id="keep-id">This sentence is long enough to be folded away but it has an id so a script may be writing to it.</p>
        <p class="setting-info status">Saved. This is a status line which a script writes into, long enough to look like an explanation.</p>
        <div class="setting-toggle-row"><span>Short<span style="color:var(--text-muted);font-size:11px"> · ok</span></span><label class="toggle"><input type="checkbox" id="t1"></label></div>
        <div class="setting-toggle-row"><span>Long <span id="inl" style="color:var(--text-muted);font-size:11px">· this explanation is far too long for one line of a row</span></span><label class="toggle"><input type="checkbox" id="t2"></label></div>
        <p class="setting-info" id="">A plain explanation which is long enough to need folding, under the toggle above it.</p>
      </div></div></div>`;
  });

  it('folds long text, keeps short text, ids and status lines, and keeps every word', () => {
    const root = document.querySelector('.settings-content');
    const before = root.textContent;
    const n = SettingsOrganize.fold(root);
    expect(root.textContent).toBe(before + '');
    expect(n).toBe(1 + 0);   // the explanation without an id (the inline one has an id here, so it stays)
    expect(document.getElementById('keep-id').classList.contains('set-info-folded')).toBe(false);
    expect(root.querySelector('.status').classList.contains('set-info-folded')).toBe(false);
    expect(root.querySelectorAll('.set-info-btn').length).toBe(1);
  });

  it('puts the ? inside the row of an inline explanation, between its label and its switch', () => {
    const root = document.querySelector('.settings-content');
    root.querySelector('#inl').removeAttribute('id');
    expect(SettingsOrganize.fold(root)).toBe(2);
    const row = root.querySelectorAll('.setting-toggle-row')[1];
    const kids = [...row.children].map(c => c.tagName + (c.classList.contains('set-info-btn') ? '.btn' : ''));
    expect(kids).toEqual(['SPAN', 'BUTTON.btn', 'LABEL']);
  });

  it('only folds more rows than MORE_AFTER, and starts closed', () => {
    const rows = (n) => Array.from({ length: n }, (_, i) => `<div class="setting-toggle-row"><span>Row ${i}</span></div>`).join('');
    document.body.innerHTML = `<div class="settings-content">
      <div class="setting-group"><label class="setting-label">A</label>${rows(12)}</div>
      <div class="setting-group"><label class="setting-label">B</label>${rows(10)}</div></div>`;
    const root = document.querySelector('.settings-content');
    expect(SettingsOrganize.more(root)).toBe(1);               // B would fold only 2 rows (under MORE_MIN): it stays whole
    const [a, b] = root.querySelectorAll('.setting-group');
    expect(a.querySelectorAll('.set-more-body > .setting-toggle-row').length).toBe(4);
    expect(a.querySelector('.set-more-count').textContent).toBe('(4)');
    expect(a.querySelector('.set-more-body').hasAttribute('data-open')).toBe(false);
    expect(b.querySelector('.set-more-body')).toBeNull();
    a.querySelector('.set-more-btn').click();
    expect(a.querySelector('.set-more-body').hasAttribute('data-open')).toBe(true);
  });
});

describe('Developer mode keeps the saved Simple mode key, and nobody\'s visible state flips', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<input type="checkbox" id="setting-developer-mode"><button id="btn-all-features" hidden></button>';
    delete document.body.dataset.uiMode;
    window.showToast = vi.fn();
    delete window.VexTabPolicy;
  });

  it('a profile that was Simple is Developer mode off, calm, as before', () => {
    localStorage.setItem('vex.uiMode', 'simple');
    VexSimpleMode.init();
    expect(VexSimpleMode.isDeveloper()).toBe(false);
    expect(document.getElementById('setting-developer-mode').checked).toBe(false);
    expect(document.body.dataset.uiMode).toBe('simple');
  });

  it('a profile that was Full is Developer mode on, with everything, as before', () => {
    localStorage.setItem('vex.uiMode', 'full');
    VexSimpleMode.init();
    expect(VexSimpleMode.isDeveloper()).toBe(true);
    expect(document.getElementById('setting-developer-mode').checked).toBe(true);
    expect(document.body.dataset.uiMode).toBe('full');
  });

  it('switching writes the same key and values it always did', () => {
    VexSimpleMode.init();
    const box = document.getElementById('setting-developer-mode');
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.uiMode')).toBe('full');
    box.checked = false; box.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.uiMode')).toBe('simple');
  });

  it('the update that adds the new Settings changes no stored value', () => {
    globalThis.Onboarding = { done: () => true, _usedBefore: () => true };
    localStorage.setItem('vex.uiMode', 'simple');
    expect(VexSimpleMode.migrate()).toBeNull();
    expect(localStorage.getItem('vex.uiMode')).toBe('simple');
    localStorage.setItem('vex.uiMode', 'full');
    expect(VexSimpleMode.migrate()).toBeNull();
    expect(localStorage.getItem('vex.uiMode')).toBe('full');
    localStorage.removeItem('vex.uiMode');           // an existing profile that never chose: Full, as it was
    expect(VexSimpleMode.migrate()).toBe('full');
    // A brand-new profile is left for the wizard, whose default is Simple: Developer mode off.
    localStorage.clear();
    globalThis.Onboarding = { done: () => false, _usedBefore: () => false };
    expect(VexSimpleMode.migrate()).toBeNull();
    expect(VexSimpleMode.DEFAULT_FOR_NEW).toBe('simple');
  });
});

describe('wired into the page', () => {
  it('loads the organiser after settings-ui.js and its stylesheet before a11y.css', () => {
    expect(HTML.indexOf('js/settings-organize.js')).toBeGreaterThan(HTML.indexOf('js/settings-ui.js'));
    expect(HTML.indexOf('css/settings-organize.css')).toBeGreaterThan(-1);
    expect(HTML.indexOf('css/settings-organize.css')).toBeLessThan(HTML.indexOf('css/a11y.css'));
    expect(readFileSync(resolve(ROOT, 'src/renderer/css/settings-organize.css'), 'utf8')).toContain('prefers-reduced-motion');
  });
});
