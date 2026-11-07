// @vitest-environment jsdom
//
// Ctrl+K commands for the language and for the settings people reach for most (2026-11-07, owner: "why cant i change the language of vex from
// ctrl k"). Static checks on the real command list: every one has a name, a hint and search words, a Turkish text, and opens a control that exists.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const JS = path.join(ROOT, 'src/renderer/js');
const { VexTr } = require('../../src/renderer/js/vex-tr.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = require('../../src/renderer/js/turkish-lemma.js').VexTrLemma;
const { VexSmartSearch } = require('../../src/renderer/js/smart-search.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { CommandBar } = require('../../src/renderer/js/command.js');

const TR = VexI18nUI.TABLE.tr;
const byId = (id) => CommandBar.commands.find(c => c.id === id);

describe('language commands', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { delete globalThis.VexI18nUI; });

  it('the three commands exist with a label, hint and search words in both languages', () => {
    for (const id of ['language-turkish', 'language-english', 'language']) {
      const c = byId(id);
      expect(c, id).toBeTruthy();
      expect(c.label && c.hint && c.keywords, id).toBeTruthy();
    }
    expect(byId('language-turkish').keywords).toMatch(/türkçe/);
    expect(byId('language-turkish').keywords).toMatch(/\bdil\b/);
    expect(byId('language-english').keywords).toMatch(/ingilizce/);
    expect(byId('language').keywords).toMatch(/language/);
  });

  it('only the other language is offered to switch to', () => {
    const tr = byId('language-turkish'), en = byId('language-english');
    localStorage.setItem('vex.lang', 'en');
    expect(CommandBar._lang()).toBe('en');
    expect([tr.when(), en.when()]).toEqual([true, false]);
    localStorage.setItem('vex.lang', 'tr');
    expect(CommandBar._lang()).toBe('tr');
    expect([tr.when(), en.when()]).toEqual([false, true]);
    // never both, never neither
    for (const v of ['en', 'tr', '']) {
      localStorage.setItem('vex.lang', v);
      expect(tr.when() !== en.when(), v).toBe(true);
    }
  });

  it('reads a JSON-quoted stored language too, and defaults to English', () => {
    localStorage.setItem('vex.lang', '"tr"');
    expect(CommandBar._lang()).toBe('tr');
    localStorage.clear();
    expect(CommandBar._lang()).toBe('en');
  });

  it('"Change Language" stays available in either language', () => {
    expect(byId('language').when).toBeUndefined();
    expect(CommandBar._shown(byId('language'))).toBe(true);
  });

  it('switching calls Onboarding.setLanguage, the same call as the Settings list', () => {
    const setLanguage = vi.fn();
    window.Onboarding = { setLanguage };
    byId('language-turkish').action();
    byId('language-english').action();
    expect(setLanguage.mock.calls).toEqual([['tr'], ['en']]);
    delete window.Onboarding;
  });

  it('a switch that cannot run says so in a toast and in the console, not silently', () => {
    const toast = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.showToast = toast;
    delete window.Onboarding;
    byId('language-turkish').action();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatch(/^The language could not be changed: /);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    delete window.showToast;
  });

  it('Change Language opens the Settings control setting-language', () => {
    const openSection = vi.fn();
    window.SettingsUI = { openSection };
    byId('language').action();
    expect(openSection).toHaveBeenCalledWith('setting-language');
    delete window.SettingsUI;
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html).toContain('id="setting-language"');
  });

  it('has a Turkish text for the label and the hint of each', () => {
    for (const id of ['language-turkish', 'language-english', 'language']) {
      const c = byId(id);
      expect(TR[c.label], c.label).toBeTruthy();
      expect(TR[c.label]).not.toBe(c.label);
      expect(TR[c.hint], c.hint).toBeTruthy();
      expect(TR[c.hint]).not.toBe(c.hint);
    }
  });

  it('typing dil / language / turkce / turkish / english / ingilizce finds them', () => {
    const saved = CommandBar.commands;
    globalThis.VexI18nUI = VexI18nUI;
    globalThis.VexSmartSearch = VexSmartSearch;
    VexSmartSearch._wordCache.clear(); VexSmartSearch._rev = null;
    try {
      for (const lang of ['en', 'tr']) {
        localStorage.setItem('vex.lang', lang);
        const other = lang === 'en' ? 'language-turkish' : 'language-english';
        for (const q of ['language', 'dil']) {
          const ids = CommandBar._rankCommands(q).map(c => c.id);
          expect(ids, q + ' in ' + lang).toContain(other);
          expect(ids, q + ' in ' + lang).toContain('language');
        }
      }
      localStorage.setItem('vex.lang', 'en');
      for (const q of ['turkce', 'türkçe', 'turkish']) expect(CommandBar._rankCommands(q).map(c => c.id), q).toContain('language-turkish');
      localStorage.setItem('vex.lang', 'tr');
      for (const q of ['english', 'ingilizce']) expect(CommandBar._rankCommands(q).map(c => c.id), q).toContain('language-english');
    } finally { CommandBar.commands = saved; delete globalThis.VexSmartSearch; }
  });
});

describe('command ids', () => {
  it('are unique across command.js', () => {
    const src = fs.readFileSync(path.join(JS, 'command.js'), 'utf8');
    const ids = [...src.matchAll(/^\s*\{ id: '([^']+)', label:/gm)].map(m => m[1]);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dup).toEqual([]);
  });
});
