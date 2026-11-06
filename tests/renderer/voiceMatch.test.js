// @vitest-environment jsdom
// Voice control: what was said -> which Ctrl+K command (js/voice-match.js), run against the REAL command list and the REAL
// Turkish table, with the sentences the speech engine really produced for Windows text-to-speech clips (Base model:
// "Yeni sikme.", "Sekmeleri düzende.", "Saifayı yakınlaştır."). Phrases in English and Turkish, with diacritics and suffixes.
import { describe, it, expect, beforeAll } from 'vitest';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexTrLemma } = require('../../src/renderer/js/turkish-lemma.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = VexTrLemma;
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
globalThis.VexI18nUI = VexI18nUI;
const { VexSmartSearch } = require('../../src/renderer/js/smart-search.js');
globalThis.VexSmartSearch = VexSmartSearch;
const { CommandBar } = require('../../src/renderer/js/command.js');
const { VexVoiceMatch: M } = require('../../src/renderer/js/voice-match.js');

let commands;
beforeAll(() => { localStorage.setItem('vex.lang', JSON.stringify('en')); commands = CommandBar.commands.filter(c => c && c.id && c.label); });
const decide = (t, extra) => M.decide(t, extra ? [...commands, ...extra] : commands);
const idOf = (d) => d.command && d.command.id;

describe('English phrases', () => {
  it('runs the command named, however it is wrapped in politeness', () => {
    for (const t of ['new tab', 'New tab.', 'open a new tab', 'please open new tab', 'could you open the new tab']) {
      const d = decide(t);
      expect(d.action, t).toBe('run');
      expect(idOf(d), t).toBe('new');
    }
  });
  it('organize my tabs', () => {
    for (const t of ['organize my tabs', 'Organize my tabs.', 'please organize my tabs']) {
      const d = decide(t);
      expect(d.action, t).toBe('run');
      expect(idOf(d), t).toBe('group-tabs');
    }
  });
  it('open downloads', () => {
    const dl = commands.find(c => c.id === 'downloads');
    expect(dl, 'the Downloads command exists').toBeTruthy();
    for (const t of ['open downloads', 'Open downloads.', 'show me the downloads', 'downloads']) {
      const d = decide(t);
      expect(d.action, t).toBe('run');
      expect(idOf(d), t).toBe('downloads');
    }
  });
});

describe('Turkish phrases', () => {
  it('yeni sekme, with the slip the Base model makes', () => {
    for (const t of ['yeni sekme', 'Yeni sekme.', 'Yeni sikme.', 'yeni sekme aç', 'lütfen yeni sekme aç']) {
      const d = decide(t);
      expect(d.action, t).toBe('run');
      expect(idOf(d), t).toBe('new');
    }
  });
  it('sekmeleri düzenle, with its ending and the slip the engine makes ("düzende")', () => {
    for (const t of ['sekmeleri düzenle', 'Sekmeleri düzenle.', 'Sekmeleri düzende.', 'sekmelerimi düzenle', 'SEKMELERİ DÜZENLE', 'sekmeleri duzenle']) {
      const d = decide(t);
      expect(d.action, t).toBe('run');
      expect(idOf(d), t).toBe('group-tabs');
    }
  });
  it('indirmeleri aç', () => {
    for (const t of ['indirmeleri aç', 'İndirmeleri aç.', 'indirilenleri aç', 'indirmeleri göster']) {
      const d = decide(t);
      expect(['run', 'choose'], t).toContain(d.action);
      expect(d.candidates.map(c => c.command.id), t).toContain('downloads');
    }
  });
  it("GitHub'u aç: the ending after the apostrophe is not part of the word", () => {
    const gh = commands.find(c => /github/i.test(c.label));
    expect(gh, 'a GitHub command exists').toBeTruthy();
    for (const t of ["GitHub'u aç", "github’u aç", 'GitHub aç', 'open GitHub']) {
      const d = decide(t);
      expect(d.candidates.length, t).toBeGreaterThan(0);
      expect(d.candidates[0].command.label.toLowerCase(), t).toContain('github');
    }
  });
  it('sayfayı yakınlaştır finds a zoom command among its choices', () => {
    const d = decide('Saifayı yakınlaştır.');
    expect(d.candidates.map(c => c.command.label.toLowerCase()).join('|')).toMatch(/zoom|yak/);
    expect(['run', 'choose']).toContain(d.action);
  });
});

describe('not sure: choices, never a guess', () => {
  it('says nothing matched for words that are no command', () => {
    for (const t of ['what is the weather in Paris', 'zzzz qqqq', 'bugün hava çok güzel']) {
      const d = decide(t);
      expect(d.action, t).toBe('none');
      expect(d.command).toBe(null);
    }
  });
  it('offers "Did you mean" (at most 3, best first) instead of acting below the threshold', () => {
    const d = decide('downlods mgr');
    expect(['choose', 'none']).toContain(d.action);
    if (d.action === 'choose') {
      expect(d.command).toBe(null);
      expect(d.candidates.length).toBeLessThanOrEqual(3);
      for (const c of d.candidates) expect(c.confidence).toBeLessThan(1);
    }
  });
  it('two equally good commands are offered, not picked', () => {
    const a = { id: 'a-x', label: 'Open Reading List', action() {} };
    const b = { id: 'b-x', label: 'Open Reading Lists', action() {} };
    const d = M.decide('reading list', [a, b]);
    expect(d.action).toBe('choose');
    expect(d.candidates.map(c => c.command.id).sort()).toEqual(['a-x', 'b-x']);
  });
  it('an empty or unheard text is nothing', () => {
    expect(decide('').action).toBe('none');
    expect(decide('   ').action).toBe('none');
  });
  it('the confidence is a number between 0 and 1 and the threshold is the one in the design', () => {
    expect(M.ACT).toBe(0.85);
    const d = decide('new tab');
    expect(d.confidence).toBeGreaterThanOrEqual(M.ACT);
    expect(d.confidence).toBeLessThanOrEqual(1);
  });
  it('a shortcut word the person made counts as a name of its command', () => {
    const d = M.decide('pr', commands, { aliases: { pr: 'group-tabs' } });
    expect(idOf(d)).toBe('group-tabs');
    expect(d.action).toBe('run');
  });
});

describe('destructive and outward commands ALWAYS ask', () => {
  const risky = [
    ['Clear Browsing Data', 'clear browsing data'], ['Delete All Bookmarks', 'delete all bookmarks'], ['Send to My Devices', 'send to my devices'],
    ['Buy Now', 'buy now'], ['Close All Tabs', 'close all tabs'], ['Quit Vex', 'quit vex'], ['Sign Out Everywhere', 'sign out everywhere'],
    ['Tarama Verilerini Temizle', 'tarama verilerini temizle'], ['Hepsini Kapat', 'hepsini kapat'], ['Gönder', 'gönder'], ['Çıkış', 'çıkış'],
    ['Reset Command Order', 'reset command order'], ['Empty Trash', 'empty trash'], ['Uninstall Extension', 'uninstall extension'],
  ];
  for (const [label, said] of risky) {
    it(`"${said}" is a confirm, even at full confidence`, () => {
      const cmd = { id: label.toLowerCase().replace(/\W+/g, '-'), label, action() {} };
      const d = M.decide(said, [cmd]);
      expect(d.confidence).toBeGreaterThanOrEqual(M.ACT);
      expect(d.action).toBe('confirm');
      expect(d.risky).toBe(true);
    });
  }
  it('the real Ctrl+K commands that clear, delete or send are all confirms', () => {
    const named = commands.filter(c => M.isRisky(c, ''));
    expect(named.length).toBeGreaterThan(3);
    for (const c of named) expect(M.decide(c.label, [c]).action, c.label).not.toBe('run');
  });
  it('plain safe commands are not mistaken for risky ones', () => {
    for (const label of ['New Tab', 'Downloads', 'Bookmarks', 'Organize My Tabs', 'Dark Mode', 'Close Tab', 'Zoom In']) expect(M.isRisky({ id: 'x', label }, label.toLowerCase())).toBe(false);
  });
  it('words that ask for a change never run a harmless command they happen to match', () => {
    const bm = { id: 'bookmarks', label: 'Bookmarks', action() {} };
    for (const t of ['delete my bookmarks', 'bookmarks sil', 'send the bookmarks', 'clear bookmarks']) {
      const d = M.decide(t, [bm]);
      expect(d.action, t).not.toBe('run');
      expect(d.command, t).toBe(null);
    }
  });
});

describe('answering "Run it?"', () => {
  it('understands yes and no in both languages, and refuses to guess', () => {
    for (const t of ['yes', 'Yes.', 'yeah do it', 'okay', 'evet', 'Evet.', 'tamam', 'onayla']) expect(M.interpretAnswer(t), t).toBe('yes');
    for (const t of ['no', 'No.', 'cancel', 'stop', 'hayır', 'iptal', 'vazgeç']) expect(M.interpretAnswer(t), t).toBe('no');
    for (const t of ['maybe', 'open downloads', '']) expect(M.interpretAnswer(t), t).toBe(null);
    expect(M.interpretAnswer('no do not do it')).toBe('no');
  });
});
