// @vitest-environment jsdom
//
// Help and FAQ (js/faq-data.js, js/faq-ui.js): every question has an answer of two to four sentences, a button that
// goes somewhere that really exists, and Turkish text for the question, the answer and the topic. The search needs
// every typed word, ranks a word in the question above one in the answer, and reads the language on screen.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const JS = path.join(ROOT, 'src', 'renderer', 'js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { VexFaqData } = require('../../src/renderer/js/faq-data.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
globalThis.VexI18nUI = VexI18nUI;
require('../../src/renderer/js/faq-tr.js');   // the Turkish of the questions and answers joins the table as the file loads
const { VexFaq } = require('../../src/renderer/js/faq-ui.js');
const { VexSettingsGroups } = require('../../src/renderer/js/vex-settings-groups.js');
const tr = VexI18nUI.TABLE.tr;

const html = read('src/renderer/index.html');
const pageIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const jsSources = fs.readdirSync(JS).filter(n => n.endsWith('.js')).map(n => fs.readFileSync(path.join(JS, n), 'utf8')).join('\n');
const hasCommand = (label) => jsSources.includes("label: '" + label.replace(/'/g, "\\'") + "'") || jsSources.includes('label: "' + label + '"');
const sentences = (text) => text.split(/[.!?](?:\s|$)/).filter(s => s.trim()).length;

describe('every FAQ entry', () => {
  const entries = VexFaqData.ENTRIES;
  const cats = new Map(VexFaqData.CATEGORIES.map(c => [c.id, c.name]));

  it('has the topics and enough questions to matter', () => {
    expect(cats.size).toBeGreaterThanOrEqual(6);
    expect(entries.length).toBeGreaterThanOrEqual(40);
  });

  it('covers the critical things the owner listed', () => {
    const ids = new Set(entries.map(e => e.id));
    for (const id of ['default-browser', 'import-bookmarks', 'import-passwords', 'sync', 'passwords', 'lock-pin', 'passkeys', 'block-ads', 'fingerprint',
      'private-window', 'tor-tab', 'clear-data', 'search-engine', 'language', 'theme', 'sidebar', 'wallpapers', 'theme-packs', 'tab-sleep', 'game-mode',
      'downloads', 'updates', 'whats-new', 'extensions', 'screen-share', 'discord', 'shortcuts', 'developer-mode', 'reset', 'data-location', 'report']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('has unique ids', () => {
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
  });

  for (const e of entries) {
    describe(e.id, () => {
      it('has a topic, a question and a short plain answer', () => {
        expect(cats.has(e.cat), 'topic ' + e.cat).toBe(true);
        expect(e.q.trim().endsWith('?')).toBe(true);
        expect(e.a.trim().length).toBeGreaterThan(40);
        const n = sentences(e.a);
        expect(n, 'sentences in the answer').toBeGreaterThanOrEqual(2);
        expect(n, 'sentences in the answer').toBeLessThanOrEqual(4);
        expect(e.kw.trim().length).toBeGreaterThan(0);
        expect(/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(e.q + e.a)).toBe(false);
      });

      it('goes to exactly one place that exists', () => {
        expect(Boolean(e.set) !== Boolean(e.cmd), 'one of set / cmd').toBe(true);
        if (e.set) {
          expect(pageIds.has(e.set), 'Settings element #' + e.set + ' is in index.html').toBe(true);
          expect(Array.isArray(e.path) && e.path.length >= 2 && e.path[0] === 'Settings').toBe(true);
        }
        if (e.cmd) expect(hasCommand(e.cmd), 'Ctrl+K command "' + e.cmd + '"').toBe(true);
      });

      it('has Turkish for the topic, the question, the answer and every word of the where line', () => {
        for (const s of [cats.get(e.cat), e.q, e.a, ...(e.path || []), ...(e.cmd ? [e.cmd] : [])]) {
          expect(tr[s], 'Turkish for: ' + s.slice(0, 70)).toBeTruthy();
        }
        expect(tr[e.q]).not.toBe(e.q);
        expect(tr[e.a]).not.toBe(e.a);
      });
    });
  }
});

describe('the words of the screen have Turkish', () => {
  it('has every string faq-ui.js shows', () => {
    const src = read('src/renderer/js/faq-ui.js');
    const used = [...src.matchAll(/(?:L|this\._L)\('((?:[^'\\]|\\.)*)'\)/g)].map(m => m[1].replace(/\\'/g, '\''));
    expect(used.length).toBeGreaterThan(8);
    for (const s of used) expect(tr[s], 'Turkish for: ' + s).toBeTruthy();
    for (const s of ['question', 'questions', 'Help and FAQ', 'Report a Problem', 'Open Help and FAQ', 'Questions? Help and FAQ is always one click away.',
      'Help and FAQ is not available in this window']) expect(tr[s], s).toBeTruthy();
  });
});

describe('the search', () => {
  const build = (lang) => {
    localStorage.setItem('vex.lang', lang);
    globalThis.VexFaqData = VexFaqData;
    globalThis.VexI18nUI = VexI18nUI;
    return VexFaq.items();
  };
  const top = (items, q) => VexFaq.rank(items, q).map(i => i.id);

  it('keeps everything, in order, for an empty search', () => {
    const items = build('en');
    expect(top(items, '')).toEqual(items.map(i => i.id));
    expect(top(items, '   ')).toEqual(items.map(i => i.id));
  });

  it('puts the obvious answer first', () => {
    const items = build('en');
    expect(top(items, 'default browser')[0]).toBe('default-browser');
    expect(top(items, 'tor')[0]).toBe('tor-tab');
    expect(top(items, 'sync')[0]).toBe('sync');
    expect(top(items, 'search engine')[0]).toBe('search-engine');
    expect(top(items, 'fingerprint')[0]).toBe('fingerprint');
    expect(top(items, 'master pin')[0]).toBe('lock-pin');
    expect(top(items, 'developer mode')[0]).toBe('developer-mode');
  });

  it('understands a question typed the way a person asks it', () => {
    const items = build('en');
    expect(top(items, 'how do I change the language')[0]).toBe('language');
    expect(top(items, 'how can I make vex my default browser?')[0]).toBe('default-browser');
    expect(top(items, 'where is my data stored')[0]).toBe('data-location');
    expect(top(items, 'how do i report a bug')).toContain('report');
  });

  it('needs every word, and finds nothing for nonsense', () => {
    const items = build('en');
    expect(top(items, 'default browser banana')).toEqual([]);
    expect(top(items, 'xyzzyplugh')).toEqual([]);
  });

  it('ranks a word in the question above the same word only in the answer', () => {
    const fixture = [
      { id: 'body', q: 'About pears', a: 'Apples are discussed here.', kw: '', cat: 'Fruit' },
      { id: 'title', q: 'About apples', a: 'Pears are discussed here.', kw: '', cat: 'Fruit' },
    ];
    expect(VexFaq.rank(fixture, 'apples').map(i => i.id)).toEqual(['title', 'body']);
    expect(VexFaq.rank(fixture, 'apples pears').map(i => i.id).sort()).toEqual(['body', 'title']);
  });

  it('searches the language on screen, and the hidden keywords in either language', () => {
    const items = build('tr');
    expect(items.find(i => i.id === 'default-browser').q).toBe(tr[VexFaqData.ENTRIES.find(e => e.id === 'default-browser').q]);
    expect(top(items, 'varsayılan tarayıcı')[0]).toBe('default-browser');
    expect(top(items, 'parmak izi')[0]).toBe('fingerprint');
    expect(top(items, 'sync')).toContain('sync');
    localStorage.setItem('vex.lang', 'en');
  });
});

describe('the screen', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = () => {};   // jsdom has none
    localStorage.setItem('vex.lang', 'en');
    globalThis.VexFaqData = VexFaqData;
    globalThis.VexI18nUI = VexI18nUI;
    globalThis.VexSettingsGroups = VexSettingsGroups;
    globalThis.SettingsUI = { opened: [], openSection(id) { this.opened.push(id); } };
    globalThis.CommandBar = { opened: 0, searched: [], open() { this.opened++; }, search(q) { this.searched.push(q); } };
    const input = document.createElement('input');
    input.id = 'command-input';
    document.body.appendChild(input);
  });

  it('lists every question, filters them as you type, and opens one on click', async () => {
    await VexFaq.open();
    const rows = () => [...document.querySelectorAll('#vex-faq .faq-item')];
    expect(rows().length).toBe(VexFaqData.ENTRIES.length);
    expect(document.querySelectorAll('#vex-faq .faq-chip').length).toBe(VexFaqData.CATEGORIES.length + 1);
    const box = document.querySelector('#vex-faq .faq-search');
    box.value = 'passwords';
    box.dispatchEvent(new Event('input'));
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThan(12);
    const first = rows()[0];
    first.querySelector('.faq-q').click();
    expect(first.querySelector('.faq-q').getAttribute('aria-expanded')).toBe('true');
    expect(first.querySelector('.faq-a').hidden).toBe(false);
    box.value = 'zzzzqqqq';
    box.dispatchEvent(new Event('input'));
    expect(rows().length).toBe(0);
    expect(document.querySelector('#vex-faq .faq-empty')).toBeTruthy();
  });

  it('a topic chip narrows the list', async () => {
    await VexFaq.open();
    const chip = [...document.querySelectorAll('#vex-faq .faq-chip')].find(b => b.dataset.cat === 'privacy');
    chip.click();
    const n = VexFaqData.ENTRIES.filter(e => e.cat === 'privacy').length;
    expect(document.querySelectorAll('#vex-faq .faq-item').length).toBe(n);
  });

  it('the button opens the Settings section, or fills in Ctrl+K', async () => {
    await VexFaq.open({ id: 'language' });
    const row = document.querySelector('#faq-a-language').closest('.faq-item');
    expect(row.querySelector('.faq-a').hidden).toBe(false);
    row.querySelector('.faq-go').click();
    expect(SettingsUI.opened).toEqual(['setting-language']);
    expect(document.getElementById('vex-faq')).toBeNull();

    await VexFaq.open({ id: 'import-bookmarks' });
    document.querySelector('#faq-a-import-bookmarks').closest('.faq-item').querySelector('.faq-go').click();
    expect(CommandBar.opened).toBe(1);
    expect(document.getElementById('command-input').value).toBe('Import from Another Browser');
    expect(CommandBar.searched).toEqual(['Import from Another Browser']);
  });

  it('from the setup there are no buttons, only the where line', async () => {
    await VexFaq.open({ fromSetup: true });
    expect(document.querySelectorAll('#vex-faq .faq-go').length).toBe(0);
    expect(document.querySelectorAll('#vex-faq .faq-where').length).toBe(VexFaqData.ENTRIES.length);
    expect(document.querySelector('#vex-faq .faq-foot').children.length).toBe(0);
  });

  it('reads in Turkish when the language is Turkish', async () => {
    localStorage.setItem('vex.lang', 'tr');
    await VexFaq.open();
    expect(document.querySelector('#vex-faq .vexsr-title').textContent).toBe(tr['Help and FAQ']);
    const q = VexFaqData.ENTRIES[0].q;
    expect(document.querySelector('#vex-faq .faq-q-text').textContent).toBe(tr[q]);
    localStorage.setItem('vex.lang', 'en');
  });

  it('refuses plainly when a target is missing', () => {
    delete globalThis.SettingsUI;
    expect(() => VexFaq.go({ id: 'x', set: 'setting-language' })).toThrow(/Settings is not available/);
    expect(() => VexFaq.go({ id: 'x' })).toThrow(/nowhere to go/);
  });
});

describe('where it is wired in', () => {
  it('loads late, with its own sheet before a11y.css, and no new blocking script tag', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("{ src: 'js/faq-ui.js', usage: [] }");
    expect(html).not.toMatch(/<script[^>]+faq-/);
    // The 45 KB of Turkish answers is read only when Help and FAQ opens, not at start-up (the start-up byte budget).
    expect(read('src/renderer/js/faq-ui.js')).toContain("VexLazy.ensure('js/faq-tr.js')");
    expect(read('src/renderer/js/i18n-ui.js')).not.toContain('Ayarlar’da Varsayılan tarayıcı yap düğmesine');
    const faq = html.indexOf('css/faq.css');
    expect(faq).toBeGreaterThan(-1);
    expect(faq).toBeLessThan(html.indexOf('css/a11y.css'));
  });

  it('is in Ctrl+K, in Settings next to About, and on the last step of both setups', () => {
    const ui = read('src/renderer/js/faq-ui.js');
    expect(ui).toContain("registerCommand({ id: 'help-faq', label: 'Help and FAQ'");
    expect(ui).toContain("VexSettingsGroups.register({ id: 'help-faq', title: 'Help and FAQ'");
    const onboarding = read('src/renderer/js/onboarding.js');
    expect(onboarding).toContain('id="ob-open-faq"');
    expect(onboarding).toContain("VexLazy.ensure('js/faq-ui.js')");
    const done = onboarding.split("key: 'done'")[1].split('\n')[0];
    expect(done).toContain('quick: true');
    expect(read('src/renderer/js/settings-ui.js')).toContain("'help and faq'");
  });
});
