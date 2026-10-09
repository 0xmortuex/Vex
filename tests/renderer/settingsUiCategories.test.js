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

import { beforeEach, describe, expect, it } from 'vitest';

const { SettingsUI } = await import('../../src/renderer/js/settings-ui.js');

// The labels the Settings panel actually renders, in document order.
const PANEL_LABELS = [
  'General', 'Default Browser', 'Sidebar Buttons', 'Privacy & Security',
  'Privacy Hardening', 'Autofill', 'Sessions', 'Workspaces', 'Performance',
  'Data', 'Location', 'Vex Sync', 'AI Backend', 'GUI Style', 'Tab Layout',
  'Layout', 'Site Permissions', 'Chrome Extensions', 'Keyboard Shortcuts',
  'Smart Tab Grouping', 'AI Personas', 'AI Memory', 'On-Device AI (WebGPU)',
  'MCP Servers', 'AI Skills', 'Boosts', 'Passwords', 'Focus', 'Command Chains',
  'Library', 'Reading & Accessibility', 'Recall (full-text history)',
  'Browsing extras', 'AI History Indexing', 'Personalization',
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
    expect(catFor('AI History Indexing')).toBe('History');
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
    const chips = Array.from(document.querySelectorAll('.set-nav-chip')).map(c => c.textContent.trim());
    expect(chips).toEqual(['Personalization', 'Personas', 'Autofill']);
    expect(document.querySelectorAll('.set-nav-chip svg').length).toBe(3);
  });

  it('is idempotent — reopening Settings does not duplicate marks or chips', () => {
    SettingsUI.enhance();
    SettingsUI.enhance();
    expect(document.querySelectorAll('.set-emoji').length).toBe(3);
    expect(document.querySelectorAll('.set-nav-chip').length).toBe(3);
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
