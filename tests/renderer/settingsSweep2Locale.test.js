// Settings in Turkish, second sweep (2026-11-01): the rules and the strings that were still English in the live scan
// (scripts/turkish-scan/). The late data file js/settings-sweep2-tr.js holds most of them; the rest are in the marked block at the end of the
// Turkish table in js/i18n-ui.js. Two tables with one key would let the later one win without a word, so none may be in both.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { VexSettingsTr2 } = require('../../src/renderer/js/settings-sweep2-tr.js');

const ROOT = path.join(__dirname, '..', '..');
const tr = (s) => VexI18nUI.lookup(s, 'tr');
// before the file joins the table, as in the app: which of its keys the main table already has
const keysInBoth = Object.keys(VexSettingsTr2).filter(k => k in VexI18nUI.TABLE.tr);
Object.assign(VexI18nUI.TABLE.tr, VexSettingsTr2);
VexI18nUI.resetTemplates();

describe('Settings Turkish: the late file', () => {
  it('is loaded late, and none of its keys is also in the main table', () => {
    expect(fs.readFileSync(path.join(ROOT, 'src/renderer/js/lazy-boot.js'), 'utf8')).toContain("{ src: 'js/settings-sweep2-tr.js', usage: [] }");
    expect(keysInBoth, 'Keep each key in one place: ' + keysInBoth.join(' | ')).toEqual([]);
  });
  it('every entry has Turkish text, and a template keeps the holes of its English', () => {
    for (const [k, v] of Object.entries(VexSettingsTr2)) {
      expect(v, k).toBeTruthy();
      const holes = (s) => [...s.matchAll(/\{\d\}/g)].map(m => m[0]).sort().join(',');
      // a plural ending ("setting{2}") is a hole the Turkish does not need; every other hole must stay
      for (const h of holes(v).split(',').filter(Boolean)) expect(k, k).toContain(h);
      if (!/[a-z]\{\d\}/.test(k)) expect(holes(v), k).toBe(holes(k));
    }
  });
  it('a text with a hole is found by its template once the file has joined the table', () => {
    expect(tr('Under 3 months: 4')).toBe('3 aydan az: 4');
    expect(tr('Agent context size set to 8192')).toBe('Aracı bağlam boyutu 8192 olarak ayarlandı');
    expect(tr('This puts 3 settings back to the default.')).toBe('3 ayar varsayılana geri döner.');
    expect(tr('Master volume is at 150%, louder than the source')).toBe('Ana ses %150 düzeyinde, kaynaktan yüksek');
  });
});

describe('Settings Turkish: the rules', () => {
  it('a fold lists the names of its rows, each one translated', () => {
    expect(tr('Advanced: Volume, Pitch, Hear typing')).toBe('Gelişmiş: Ses, Ton, Yazma sesini dinle');
    expect(tr('Advanced: Some row nobody translated')).toBe('Gelişmiş: Some row nobody translated');
  });
  it('a panel name in a button label comes through "Show {1}" / "Hide {1}", with or without a shortcut after it', () => {
    expect(tr('Hide Notlar')).toBe('Notlar öğesini gizle');
    expect(tr('Show Bellek (Ctrl+Shift+M)')).toBe('Bellek öğesini göster (Ctrl+Shift+M)');
  });
  it('the built-in search keywords are code, only the label is language', () => {
    expect(tr('Built in: @g Google · ddg DuckDuckGo')).toBe('Yerleşik: @g Google · ddg DuckDuckGo');
  });
  it('a note in brackets after a label is translated on its own', () => {
    expect(tr('Library (what you saved)')).toBe('Kitaplık (kaydettikleriniz)');
    expect(tr('Off (use system DNS)')).toBe('Kapalı (sistem DNS’ini kullan)');
  });
  it('a row\'s sentence that used to carry an English half is whole Turkish', () => {
    for (const k of ['Show the timers in the second-screen window', 'Show the dictionary form and gloss when I point at a word', 'Show a strip of panel state at the bottom']) {
      expect(tr(k), k).toMatch(/göster$/);
      expect(tr(k), k).not.toMatch(/\b(the|and|when|at)\b/);
    }
    expect(tr('Hide the floating video while a game is fullscreen')).toBe('Bir oyun tam ekranken yüzen videoyu gizle');
  });
  it('the privacy lists\' phrases are Turkish (a sample), and the storage rows name their policy', () => {
    expect(tr('whether each tab is loading')).toBe('her sekmenin yüklenip yüklenmediği');
    expect(tr('your list of blocked sites')).toBe('engellenen sitelerinizin listesi');
    expect(tr('Game log: 3 KB of 256 KB, kept 90 days')).toBe('Oyun günlüğü: 256 KB’ın 3 KB’ı, 90 gün saklanır');
  });
  it('the parts of Settings that built English from pieces now use the whole-string path', () => {
    const read = (f) => fs.readFileSync(path.join(ROOT, 'src/renderer/js', f), 'utf8');
    expect(read('wallpaper-store-ui.js')).toContain("L('Kept on this computer:') + ' '");
    expect(read('sync-settings.js')).toContain("window.vexTr('Could not forget it:')");
    expect(read('backup.js')).toContain("window.vexTr('It includes AI conversations.')");
    expect(read('vex-health.js')).toContain("scan.checked.map(c => window.vexTr(c))");
  });
});

describe('Settings Turkish: country names', () => {
  it('geo-search names countries in Turkish whatever the system language is', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/js/geo-search.js'), 'utf8');
    expect(src).toMatch(/VexI18nUI\.locale\(\) === 'tr'/);
    expect(new Intl.DisplayNames(['tr'], { type: 'region' }).of('DE')).toBe('Almanya');
  });
});
