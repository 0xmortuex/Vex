// @vitest-environment jsdom
//
// Turkish was half applied (found 2026-10-10): the window's lang stayed "en",
// every Settings heading stayed English (a heading holds the section's mark,
// and elements with children were skipped), ten chips, the search box, the
// toolbar tooltips, seven setup steps and the "already set" badge too. And
// switching back to English put back the English a label STARTED with, not
// the one Vex had changed it to since; the Stop/Reload tooltip kept the
// language of the first page load.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const tr = () => localStorage.setItem('vex.lang', JSON.stringify('tr'));
const en = () => localStorage.setItem('vex.lang', JSON.stringify('en'));

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; document.documentElement.lang = 'en'; });

describe('the window says which language it is in', () => {
  it('sets <html lang> to tr, and back to en', () => {
    tr();
    VexI18nUI.apply();
    expect(document.documentElement.lang).toBe('tr');
    en();
    VexI18nUI.apply();
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('labels with child elements', () => {
  it('translates the first text node of a Settings heading and keeps its mark', () => {
    tr();
    document.body.innerHTML = '<div id="panel-settings"><label class="setting-label"><span class="set-emoji"><svg></svg></span>Privacy &amp; Security</label></div>';
    VexI18nUI.apply();
    const l = document.querySelector('.setting-label');
    expect(l.textContent).toBe('Gizlilik ve güvenlik');
    expect(l.querySelector('.set-emoji svg')).toBeTruthy();
    expect(VexI18nUI.english(l)).toBe('Privacy & Security');
    en();
    VexI18nUI.apply();
    expect(l.textContent).toBe('Privacy & Security');
    expect(l.querySelector('.set-emoji svg')).toBeTruthy();
  });

  it('a text-only heading that gets its mark later still switches back', () => {
    tr();
    document.body.innerHTML = '<div id="panel-settings"><label class="setting-label">General</label></div>';
    VexI18nUI.apply();
    const l = document.querySelector('.setting-label');
    const mark = document.createElement('span');
    mark.className = 'set-emoji';
    mark.innerHTML = '<svg></svg>';
    l.insertBefore(mark, l.firstChild);
    expect(VexI18nUI.english(l)).toBe('General');
    en();
    VexI18nUI.apply();
    expect(l.textContent).toBe('General');
    expect(l.querySelector('svg')).toBeTruthy();
  });

  it('Settings still files a Turkish heading under its category', () => {
    const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
    globalThis.VexI18nUI = VexI18nUI;
    tr();
    document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"><div class="setting-group"><label class="setting-label">Privacy &amp; Security</label></div></div></div>';
    VexI18nUI.apply();
    SettingsUI.enhance();
    const chips = [...document.querySelectorAll('.set-nav .set-nav-chip')];
    expect(chips.length).toBe(1);
    expect(document.querySelector('.setting-group').style.getPropertyValue('--cat-color')).toBe('#22c55e');
    delete globalThis.VexI18nUI;
  });
});

describe('switching back to English', () => {
  it('puts back the CURRENT English of a label that changed while Turkish was on', () => {
    tr();
    document.body.innerHTML = '<div id="panel-downloads"><button id="b">Pause</button></div>';
    VexI18nUI.apply();
    const b = document.getElementById('b');
    expect(b.textContent).toBe('Duraklat');
    b.textContent = 'Resume';            // the panel's own code, as a pause/resume does
    VexI18nUI.apply();
    expect(b.textContent).toBe('Sürdür');
    en();
    VexI18nUI.revert();
    expect(b.textContent).toBe('Resume');
  });

  it('leaves English that Vex wrote after the translation alone', () => {
    tr();
    document.body.innerHTML = '<div id="panel-downloads"><button id="b" title="Pause">Pause</button></div>';
    VexI18nUI.apply();
    const b = document.getElementById('b');
    b.textContent = 'Resume';
    b.title = 'Resume';
    en();
    VexI18nUI.revert();
    expect(b.textContent).toBe('Resume');
    expect(b.title).toBe('Resume');
  });
});

describe('what has a Turkish translation now', () => {
  it('every Settings chip, the search box and the toolbar tooltips', () => {
    const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
    const names = new Set(SettingsUI.CATS.map(c => c.group ? SettingsUI.GROUPS[c.group].name : c.name));
    const missing = [...names].filter(n => n !== 'MCP' && !VexI18nUI.lookup(n, 'tr'));
    expect(missing).toEqual([]);
    for (const s of ['Search settings…', 'Vex page — site information', 'All features — show every panel, button and setting Vex has',
      'Hide the sidebar (Ctrl+B)', 'Show the sidebar (Ctrl+B)', 'Command Bar (Ctrl+K)', 'Privacy — trackers & ads blocked',
      'Close / open the left sidebar (Ctrl+B)', 'New tab', 'Stop loading this page (Esc)']) {
      expect(VexI18nUI.lookup(s, 'tr'), s).toBeTruthy();
    }
  });

  it('every top-level Settings heading', () => {
    const html = readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const heads = [...doc.querySelectorAll('#panel-settings .settings-content > .setting-group > .setting-label')]
      .map(l => (l.querySelector('strong') || l).textContent.replace(/\s+/g, ' ').trim());
    expect(heads.length).toBeGreaterThan(40);
    expect(heads.filter(h => !VexI18nUI.lookup(h, 'tr'))).toEqual([]);
  });

  it('every setup step has a Turkish title and subtitle', () => {
    localStorage.setItem('vex.lang', 'tr');
    require('../../src/renderer/js/i18n.js');
    const t = window.VexI18n.strings.tr;
    const src = readFileSync(path.join(__dirname, '../../src/renderer/js/onboarding.js'), 'utf8');
    const keys = [...src.matchAll(/\{ key: '([a-z]+)',\s+title:/g)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    expect(keys.flatMap(k => [t[k] ? null : k, t[k + '.sub'] ? null : k + '.sub']).filter(Boolean)).toEqual([]);
  });

  it('the setup badge says "already set" through the translation', () => {
    const src = readFileSync(path.join(__dirname, '../../src/renderer/js/onboarding.js'), 'utf8');
    expect(src).not.toMatch(/' already set<\/span>'/);
    expect(src).toMatch(/VexI18n\?\.t\('configured'/);
  });
});

describe('the Stop / Reload tooltip follows the language', () => {
  it('is Turkish while loading in Turkish, and English again in English', async () => {
    vi.resetModules();
    globalThis.VexI18nUI = VexI18nUI;
    tr();
    document.body.innerHTML = '<div id="nav-buttons"><button id="btn-reload" title="Reload (Ctrl+R)"><svg></svg></button></div>';
    VexI18nUI.apply();
    const btn = document.getElementById('btn-reload');
    expect(btn.title).toBe('Yenile (Ctrl+R)');
    globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true) };
    window.vex = window.vex || { getStartPageUrl: () => new Promise(() => {}) };
    await import('../../src/renderer/js/vex-icons.js');
    await import('../../src/renderer/js/vex-utils.js');
    const { TabManager } = await import('../../src/renderer/js/tabs.js');
    TabManager.syncReloadButton({ loading: true });
    expect(btn.title).toBe('Bu sayfanın yüklenmesini durdur (Esc)');
    en();
    VexI18nUI.revert();
    TabManager.syncReloadButton({ loading: false });
    expect(btn.title).toBe('Reload (Ctrl+R)');
    TabManager.syncReloadButton({ loading: true });
    expect(btn.title).toBe('Stop loading this page (Esc)');
    delete globalThis.VexI18nUI;
  });
});
