// @vitest-environment jsdom
//
// Settings panel categorisation (settings-ui.js). Every setting group gets a
// category mark + a chip in the sticky nav. Two things regressed here:
//   - "Personalization" contains the substring "persona", so it was filed under
//     AI Personas and never got a chip of its own;
//   - seven groups (Autofill, Sidebar Buttons, Keyboard Shortcuts, Smart Tab
//     Grouping, AI History Indexing, Cloud Services, Layout) matched nothing and
//     all collapsed into a single "Other" chip.
// The marks are inline SVG now, not emoji.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { SettingsUI } = await import('../../src/renderer/js/settings-ui.js');

// The labels the Settings panel actually renders, in document order.
const PANEL_LABELS = [
  'General', 'Default Browser', 'Sidebar Buttons', 'Privacy & Security',
  'Privacy Hardening', 'Autofill', 'Sessions', 'Workspaces', 'Performance',
  'Data', 'Location', 'Vex Sync', 'AI Backend', 'AI Personas', 'AI Memory',
  'On-Device AI (WebGPU)', 'MCP Servers', 'AI Skills', 'AI History Indexing',
  'GUI Style', 'Tab Layout', 'Layout', 'Site Permissions', 'Chrome Extensions',
  'Keyboard Shortcuts', 'Smart Tab Grouping', 'Boosts', 'Passwords', 'Focus',
  'Command Chains', 'Library', 'Reading & Accessibility',
  'Recall (full-text history)', 'Browsing extras', 'Personalization',
  'Cloud Services (self-hosted)', 'About',
];

const catFor = (label) => SettingsUI._matchCat(label.toLowerCase()).name;

describe('SettingsUI category matching', () => {
  it('files Personalization under its own category, not Personas', () => {
    expect(catFor('Personalization')).toBe('Personalization');
    expect(catFor('AI Personas')).toBe('Personas');
  });

  it('keeps Tab Layout in Appearance and the toolbar Layout row separate', () => {
    expect(catFor('Tab Layout')).toBe('Appearance');
    expect(catFor('GUI Style')).toBe('Appearance');
    expect(catFor('Layout')).toBe('Layout');
  });

  it('gives every group in the panel a real category', () => {
    const unmatched = PANEL_LABELS.filter(l => catFor(l) === 'Other');
    expect(unmatched).toEqual([]);
  });

  it('maps the groups that used to fall through to their own categories', () => {
    expect(catFor('Autofill')).toBe('Autofill');
    expect(catFor('Sidebar Buttons')).toBe('Sidebar');
    expect(catFor('Keyboard Shortcuts')).toBe('Shortcuts');
    expect(catFor('Smart Tab Grouping')).toBe('Tab Groups');
    expect(catFor('AI History Indexing')).toBe('AI History');
    expect(catFor('Cloud Services (self-hosted)')).toBe('Cloud');
  });

  it('falls back to Other for a label nothing claims', () => {
    expect(catFor('Something Unheard Of')).toBe('Other');
  });
});

describe('SettingsUI category marks', () => {
  it('renders an inline SVG and never an emoji', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const cat of SettingsUI.CATS) {
      const svg = SettingsUI._svg(cat.icon, 15);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('stroke="currentColor"');
      expect(emoji.test(svg)).toBe(false);
      expect(emoji.test(cat.name)).toBe(false);
      expect(SettingsUI.ICONS[cat.icon]).toBeTruthy();
    }
  });

  it('falls back to the gear mark for an unknown icon name', () => {
    expect(SettingsUI._svg('nope', 13)).toContain(SettingsUI.ICONS.gear);
  });
});

describe('SettingsUI.enhance', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="panel-settings">
        <div class="settings-content">
          <div class="setting-group"><label class="setting-label">Personalization</label></div>
          <div class="setting-group"><label class="setting-label">AI Personas</label></div>
          <div class="setting-group"><label class="setting-label">Autofill</label></div>
        </div>
      </div>`;
  });

  it('gives each distinct category its own nav chip', () => {
    SettingsUI.enhance();
    const chips = Array.from(document.querySelectorAll('.set-nav .set-nav-chip')).map(c => c.textContent.trim());
    // AI Personas is one of the AI sections, so its nav chip is the AI one.
    expect(chips).toEqual(['Personalization', 'AI', 'Autofill']);
    expect(document.querySelectorAll('.set-nav .set-nav-chip svg').length).toBe(3);
  });

  it('is idempotent — reopening Settings does not duplicate marks or chips', () => {
    SettingsUI.enhance();
    SettingsUI.enhance();
    expect(document.querySelectorAll('.set-emoji').length).toBe(3);
    expect(document.querySelectorAll('.set-nav .set-nav-chip').length).toBe(3);
    expect(document.querySelectorAll('.set-subnav').length).toBe(1);
    expect(document.querySelectorAll('.set-subnav .set-nav-chip').length).toBe(1);
  });

  it('filters groups by the search box and restores them when cleared', () => {
    SettingsUI.enhance();
    const root = document.querySelector('.settings-content');
    SettingsUI._filter(root, 'autofill');
    const shown = Array.from(root.querySelectorAll('.setting-group')).filter(g => g.style.display !== 'none');
    expect(shown.length).toBe(1);
    SettingsUI._filter(root, '');
    expect(Array.from(root.querySelectorAll('.setting-group')).every(g => g.style.display !== 'none')).toBe(true);
  });
});

// The owner, 2026-10-10: 37 chips wrapped the bar to five rows. The seven AI
// sections share one "AI" chip now, with their own row of smaller chips above
// the first of them. Built from the real Settings markup in index.html.
describe('the AI sections share one chip', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const html = readFileSync(join(__dirname, '../../src/renderer/index.html'), 'utf8');
  const AI_LABELS = ['AI Backend', 'AI Personas', 'AI Memory', 'On-Device AI (WebGPU)', 'MCP Servers', 'AI Skills', 'AI History Indexing'];

  let root, panel;
  beforeEach(() => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.body.innerHTML = doc.getElementById('panel-settings').outerHTML;
    delete document.body.dataset.uiMode;
    SettingsUI.enhance();
    panel = document.getElementById('panel-settings');
    root = panel.querySelector('.settings-content');
  });
  const navNames = () => [...panel.querySelectorAll('.set-nav .set-nav-chip')].map(c => c.textContent.trim());
  const sections = () => [...root.children].filter(el => el.classList.contains('setting-group'));
  const labelOf = (g) => g.querySelector('.setting-label').textContent.replace(/\s+/g, ' ').trim();
  // jsdom has no scrollIntoView: record where each call scrolled to.
  const watchScroll = () => {
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const spy = { lastTarget: null, mockRestore() { if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had); else delete Element.prototype.scrollIntoView; } };
    Element.prototype.scrollIntoView = function () { spy.lastTarget = this; };
    return spy;
  };

  it('puts one AI chip in the nav instead of seven, the other chips in their old order', () => {
    const names = navNames();
    expect(names.filter(n => n === 'AI')).toHaveLength(1);
    for (const gone of ['Personas', 'AI Memory', 'On-Device', 'MCP', 'Skills', 'History']) expect(names).not.toContain(gone);
    expect(names.length).toBeLessThanOrEqual(31);
    expect(names.slice(0, 15)).toEqual(['General', 'Browser', 'Sidebar', 'Privacy', 'Autofill', 'Sessions', 'Workspaces',
      'Performance', 'Profiles', 'Data', 'Location', 'Sync', 'AI', 'Appearance', 'Other']);
    expect(names).toContain('Recall');
    expect(names).toContain('Personalization');
  });

  it('keeps the AI sections together, under their own row of chips', () => {
    const labels = sections().map(labelOf);
    const first = labels.indexOf('AI Backend');
    expect(labels.slice(first, first + AI_LABELS.length)).toEqual(AI_LABELS);
    const row = root.querySelector(':scope > .set-subnav');
    expect(row).toBeTruthy();
    expect(row.nextElementSibling).toBe(sections()[first]);
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('aria-label')).toBe('AI sections');
    const subs = [...row.querySelectorAll('button.set-nav-chip')];
    expect(subs.map(c => c.textContent.trim())).toEqual(['AI', 'Personas', 'Memory', 'On-Device', 'MCP', 'Skills', 'History']);
    subs.forEach(c => expect(c.querySelector('svg.set-cat-icon')).toBeTruthy());
    expect(root.querySelectorAll('.set-subnav')).toHaveLength(1);
  });

  it('the AI chip lands on the row, and each sub-chip on its section', () => {
    const spy = watchScroll();
    try {
      const ai = [...panel.querySelectorAll('.set-nav .set-nav-chip')].find(c => c.textContent.trim() === 'AI');
      ai.click();
      expect(spy.lastTarget).toBe(root.querySelector('.set-subnav'));
      const subs = [...root.querySelectorAll('.set-subnav .set-nav-chip')];
      const byLabel = Object.fromEntries(sections().map(g => [labelOf(g), g]));
      subs.forEach((chip, i) => {
        chip.click();
        expect(spy.lastTarget).toBe(byLabel[AI_LABELS[i]]);
      });
    } finally { spy.mockRestore(); }
  });

  it('each AI section keeps its own mark and colour', () => {
    const byLabel = Object.fromEntries(sections().map(g => [labelOf(g), g]));
    expect(byLabel['MCP Servers'].style.getPropertyValue('--cat-color')).toBe('#38bdf8');
    expect(byLabel['AI Personas'].style.getPropertyValue('--cat-color')).toBe('#8b5cf6');
    expect(byLabel['On-Device AI (WebGPU)'].style.getPropertyValue('--cat-color')).toBe('#2dd4bf');
    for (const l of AI_LABELS) expect(byLabel[l].querySelector('.set-emoji svg')).toBeTruthy();
  });

  it('the search still finds each AI section, and hides both rows of chips while it does', () => {
    for (const [q, want] of [['mcp', 'MCP Servers'], ['skills', 'AI Skills'], ['persona', 'AI Personas'], ['webgpu', 'On-Device AI (WebGPU)']]) {
      SettingsUI._filter(root, q);
      const shown = sections().filter(g => g.style.display !== 'none').map(labelOf);
      expect(shown).toContain(want);
      // The names on the row of chips never make another section match.
      expect(shown).not.toContain('AI Backend');
      expect(panel.querySelector('.set-nav').style.display).toBe('none');
      expect(root.querySelector('.set-subnav').style.display).toBe('none');
    }
    SettingsUI._filter(root, '');
    expect(panel.querySelector('.set-nav').style.display).toBe('');
    expect(root.querySelector('.set-subnav').style.display).toBe('');
  });

  it('reopening Settings does not add a second row or chip', () => {
    SettingsUI.enhance();
    expect(root.querySelectorAll('.set-subnav')).toHaveLength(1);
    expect(root.querySelectorAll('.set-subnav .set-nav-chip')).toHaveLength(7);
    expect(navNames().filter(n => n === 'AI')).toHaveLength(1);
  });

  it('Simple mode: the AI chip and row are advanced while every AI section is, basic once one is not', () => {
    const ai = () => [...panel.querySelectorAll('.set-nav .set-nav-chip')].find(c => c.textContent.trim() === 'AI');
    expect(ai().dataset.tier).toBe('advanced');
    expect(root.querySelector('.set-subnav').dataset.tier).toBe('advanced');
    const saved = SettingsUI.BASIC_SECTIONS;
    SettingsUI.BASIC_SECTIONS = [...saved, 'mcp servers'];
    try {
      SettingsUI.enhance();
      expect(ai().dataset.tier).toBe('basic');
      expect(root.querySelector('.set-subnav').dataset.tier).toBe('basic');
      const subs = [...root.querySelectorAll('.set-subnav .set-nav-chip')];
      expect(subs.filter(c => c.dataset.tier === 'basic').map(c => c.textContent.trim())).toEqual(['MCP']);
    } finally { SettingsUI.BASIC_SECTIONS = saved; }
    const css = readFileSync(join(__dirname, '../../src/renderer/css/simple-mode.css'), 'utf8');
    expect(css).toContain('body[data-ui-mode="simple"] #panel-settings:not(.set-show-advanced) .settings-content > .set-subnav[data-tier="advanced"]');
  });

  it('deep links into the AI sections still reach them', () => {
    const ids = { 'personas-panel-content': 'AI Personas', 'ai-memory-panel-content': 'AI Memory', 'webllm-panel-content': 'On-Device AI (WebGPU)',
      'mcp-panel-content': 'MCP Servers', 'skills-panel-content': 'AI Skills', 'ai-mode-radio': 'AI Backend' };
    const saved = globalThis.SidebarManager;
    const raf = window.requestAnimationFrame;
    globalThis.SidebarManager = { openPanel: vi.fn() };
    window.requestAnimationFrame = (fn) => { fn(); return 0; };
    const spy = watchScroll();
    try {
      for (const [id, label] of Object.entries(ids)) {
        const el = document.getElementById(id);
        expect(el, id).toBeTruthy();
        expect(labelOf(el.closest('.settings-content > .setting-group'))).toBe(label);
        SettingsUI.openSection(id);
        expect(spy.lastTarget).toBe(el);
      }
    } finally {
      spy.mockRestore();
      globalThis.SidebarManager = saved;
      window.requestAnimationFrame = raf;
    }
  });

  it('the new chip names have a Turkish translation', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    const tr = VexI18nUI.TABLE.tr;
    for (const s of ['AI sections', 'Personas', 'Memory', 'On-Device', 'Skills', 'History']) expect(tr[s], s).toBeTruthy();
  });

  it('the row of sub-chips is never a scroll box', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/css/settings-redesign.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /\.set-subnav\b/.test(m[1])).map(m => m[2]).join(';');
    expect(rules).toMatch(/flex-wrap:\s*wrap/);
    expect(rules).not.toMatch(/max-height|overflow/);
  });
});

// The owner, 2026-10-09: at the normal size the chip bar is not a scroll box.
// A two-row cap (v2.37.0) hid Personalization and Cloud behind a scrollbar.
// It stays one scrolling row only in a short window and at Larger/Largest.
describe('the chip bar height', () => {
  const { readFileSync } = require('node:fs');
  const css = readFileSync(require('node:path').join(__dirname, '../../src/renderer/css/settings-redesign.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rulesFor = (sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => m[1].split(',').some(s => s.trim() === sel))
    .map(m => m[2]);

  it('at the normal size every chip shows: no height cap, no scroll box', () => {
    const base = rulesFor('.set-nav');
    expect(base.length).toBeGreaterThan(0);
    // The plain .set-nav rules: the one at the top level, and the one inside the short-window query.
    const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const plain = [...top.matchAll(/(^|\})\s*\.set-nav\s*\{([^}]*)\}/g)].map(m => m[2]).join(';');
    expect(plain).toMatch(/flex-wrap:\s*wrap/);
    expect(plain).not.toMatch(/max-height|overflow/);
  });

  it('a short window and Larger/Largest keep one row that scrolls', () => {
    expect(css).toMatch(/@media \(max-height: 760px\)\s*\{\s*\.set-nav\s*\{[^}]*max-height:\s*34px;[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\[data-vex-scale="largest"\]\) \.set-nav\s*\{[^}]*max-height:\s*34px;[^}]*overflow-y:\s*auto/);
  });
});
