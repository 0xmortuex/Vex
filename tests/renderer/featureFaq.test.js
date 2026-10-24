// @vitest-environment jsdom
//
// "Did you know?" in the Library (js/feature-faq.js): Frequently Asked FEATURES. The data is checked here (every
// question points at a real catalogue entry that can really be opened, has its Turkish, has no emoji, and is short),
// and the wiring in jsdom (a disclosure per question, Try it calls the Library's own Open, the search finds it in
// English and in Turkish). What it looks like and that Try it really does the thing is checked in the real app.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { FeatureLibrary } = require('../../src/renderer/js/feature-library.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { FeatureFaq } = require('../../src/renderer/js/feature-faq.js');
const { FeatureDetails } = require('../../src/renderer/js/feature-details.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
const tr = VexI18nUI.TABLE.tr;
globalThis.ThemeManager = require('../../src/renderer/js/theme-manager.js').ThemeManager;
const ROOT = path.join(__dirname, '..', '..');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="host"></div>';
  globalThis.VexFeatures = VexFeatures;
  globalThis.FeatureDetails = FeatureDetails;
  globalThis.FeatureFaq = FeatureFaq;
  globalThis.FeatureLibrary = FeatureLibrary;
  globalThis.VexIcons = VexIcons;
  globalThis.VexI18nUI = VexI18nUI;
  globalThis.CommandBar = { commands: [] };
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  FeatureLibrary._query = '';
  FeatureLibrary._cat = null;
});

const host = () => document.getElementById('host');
const sentences = (s) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

describe('the questions', () => {
  it('there are between 30 and 45, each with its own id', () => {
    const n = FeatureFaq.ENTRIES.length;
    expect(n).toBeGreaterThanOrEqual(30);
    expect(n).toBeLessThanOrEqual(45);
    expect(new Set(FeatureFaq.ENTRIES.map(e => e.id)).size).toBe(n);
  });

  it('every question is about a catalogue entry that can really be opened', () => {
    for (const e of FeatureFaq.ENTRIES) {
      const f = VexFeatures.get(e.f);
      expect(f, `${e.id}: no catalogue entry "${e.f}"`).toBeTruthy();
      if (e.act === 'settings') {
        expect(f.setting && (f.setting.id || f.setting.section), `${e.id}: no Settings section to open`).toBeTruthy();
        expect(e.path, `${e.id}: a Settings-only entry needs the path written out`).toMatch(/^Settings > /);
      } else {
        expect(f.cmd || f.panel, `${e.id}: ${e.f} has neither a Ctrl+K command nor a panel`).toBeTruthy();
      }
    }
  });

  it('is written as a question, with a short plain answer', () => {
    for (const e of FeatureFaq.ENTRIES) {
      expect(e.q.endsWith('?'), `${e.id}: the question does not end with ?`).toBe(true);
      expect(e.a.length, `${e.id}: answer too long`).toBeLessThan(420);
      expect(sentences(e.a).length, `${e.id}: answer should be 1 to 4 sentences`).toBeLessThanOrEqual(4);
      expect(e.k.length, `${e.id}: needs search words`).toBeGreaterThan(10);
    }
  });

  it('has no emoji, in the data or in the Turkish', () => {
    const emoji = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const e of FeatureFaq.ENTRIES) {
      for (const s of [e.q, e.a, tr[e.q], tr[e.a]]) expect(emoji.test(s), `${e.id}: emoji in "${s}"`).toBe(false);
    }
  });

  it('every question, answer and label has Turkish', () => {
    const labels = [FeatureFaq.NAME, FeatureFaq.BLURB, 'Try it', 'Find it again:', 'then type', 'Not tried yet',
      'Vex has no record of you running this. It remembers only your 60 most recent commands.',
      'No question here matches that. Try other words, or ask Vex above.', 'Everything Vex does'];
    for (const e of FeatureFaq.ENTRIES) {
      labels.push(e.q, e.a);
      if (e.path) labels.push(e.path);
    }
    for (const s of labels) expect(tr[s], `no Turkish for: ${s}`).toBeTruthy();
  });

  it('the Turkish is not the English, and has no Latin-only leftovers of the English sentence', () => {
    for (const e of FeatureFaq.ENTRIES) {
      expect(tr[e.q]).not.toBe(e.q);
      expect(tr[e.a]).not.toBe(e.a);
      // A translated answer is Turkish, which has letters English does not.
      expect(/[çğıöşüÇĞİÖŞÜ]/.test(tr[e.q] + tr[e.a]), `${e.id}: the Turkish has no Turkish letters`).toBe(true);
    }
  });

  it('is not listed in the files that must stay light', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html).not.toMatch(/<script src="js\/feature-faq\.js"><\/script>/);
  });
});

describe('the category and its items', () => {
  const draw = () => { FeatureLibrary.render(host()); host().querySelector('.flib-chip-faq').click(); };

  it('has a chip beside Everything with the number of questions', () => {
    FeatureLibrary.render(host());
    const chip = host().querySelector('.flib-chip-faq');
    expect(chip.textContent).toContain('Did you know?');
    expect(chip.textContent).toContain(String(FeatureFaq.ENTRIES.length));
    expect(chip.previousElementSibling.dataset.cat).toBe('');
  });

  it('draws one disclosure per question: a button with aria-expanded controlling a hidden region', () => {
    draw();
    const heads = host().querySelectorAll('.flib-faq-head');
    expect(heads.length).toBe(FeatureFaq.ENTRIES.length);
    const b = heads[0];
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    const region = document.getElementById(b.getAttribute('aria-controls'));
    expect(region.hidden).toBe(true);
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-labelledby')).toBe(b.id);
    b.click();
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
    b.click();
    expect(region.hidden).toBe(true);
  });

  it('says where to find it again, from the live command, and has a Try it', () => {
    globalThis.CommandBar = { commands: [{ id: 'readaloud', label: 'Read Aloud', action: vi.fn() }] };
    draw();
    const item = host().querySelector('[data-faq="read-aloud"]');
    expect(item.querySelector('.flib-faq-find').textContent.replace(/\s+/g, ' ')).toContain('Ctrl+K then type Read Aloud');
    expect(item.querySelector('[data-faq-try]').textContent).toBe('Try it');
    expect(item.querySelector('[data-faq-try]').disabled).toBe(false);
  });

  it('a Settings-only entry shows its Settings path', () => {
    draw();
    const item = host().querySelector('[data-faq="mouse-gestures"]');
    expect(item.querySelector('.flib-faq-find').textContent).toContain('Settings > Extras > Mouse gestures');
  });

  it('Try it is the Library\'s own Open button for that feature', () => {
    globalThis.CommandBar = { commands: [{ id: 'readaloud', label: 'Read Aloud', action: vi.fn() }] };
    const spy = vi.spyOn(FeatureLibrary, 'open').mockImplementation(() => undefined);
    draw();
    host().querySelector('[data-faq="read-aloud"] [data-faq-try]').click();
    expect(spy).toHaveBeenCalledWith('readaloud', 'command');
    host().querySelector('[data-faq="mouse-gestures"] [data-faq-try]').click();
    expect(spy).toHaveBeenLastCalledWith('gestures', 'settings');
    spy.mockRestore();
  });

  it('Try it on an entry that cannot open says so instead of doing nothing', () => {
    const toast = vi.fn();
    window.showToast = toast;
    draw();
    // no command registered for this one
    const c = FeatureLibrary.faqCard(FeatureFaq.ENTRIES.find(e => e.id === 'peek-link'));
    expect(c.act).toBe('');
    host().querySelector('[data-faq="peek-link"] [data-faq-try]').click();
    expect(host().querySelector('[data-faq="peek-link"] [data-faq-try]').disabled).toBe(true);
    delete window.showToast;
  });

  it('marks what has no record of use, and only that', () => {
    globalThis.CommandBar = { commands: [{ id: 'readaloud', label: 'Read Aloud', action: vi.fn() }, { id: 'copyunlock', label: 'Unlock Copy', action: vi.fn() }] };
    localStorage.setItem('vex.commandUsage', JSON.stringify({ readaloud: { n: 2, at: 1 } }));
    draw();
    expect(host().querySelector('[data-faq="read-aloud"] .flib-faq-new')).toBeNull();
    expect(host().querySelector('[data-faq="copy-unlock"] .flib-faq-new').textContent).toBe('Not tried yet');
    // a Settings-only feature has no usage record, so it is never marked
    expect(host().querySelector('[data-faq="mouse-gestures"] .flib-faq-new')).toBeNull();
  });
});

describe('searching', () => {
  const names = (q) => FeatureLibrary.faqEntries(q).map(e => e.id);

  it('finds a question by the words a person would use', () => {
    expect(names('read out loud')).toContain('read-aloud');
    expect(names('undo closing a window')).toContain('undo-window');
    expect(names('send to my phone')).toContain('to-phone');
    expect(names('what does a site know about me')).toContain('site-stored');
  });

  it('every word has to match', () => {
    expect(names('read out loud zzzzqq')).toEqual([]);
  });

  it('finds it in Turkish, with Turkish letters or without them', () => {
    expect(names('sesli oku')).toContain('read-aloud');
    expect(names('SESLİ OKU')).toContain('read-aloud');
    expect(names('telefonuma gonder')).toContain('to-phone');
    expect(names('Telefonuma gönder')).toContain('to-phone');
    expect(names('pencereyi geri al')).toContain('undo-window');
  });

  it('a stem finds a word with an ending', () => {
    expect(names('okuma')).toContain('read-aloud');
  });

  it('an empty search is all of them', () => {
    expect(names('')).toHaveLength(FeatureFaq.ENTRIES.length);
  });

  it('a search in Everything puts matching questions first, above the feature cards', () => {
    FeatureLibrary._query = 'read aloud';
    FeatureLibrary.render(host());
    const list = host().querySelector('#flib-list');
    expect(list.firstElementChild.textContent).toContain('Did you know?');
    expect(list.querySelector('.flib-faq')).toBeTruthy();
    expect(list.querySelector('.flib-card')).toBeTruthy();
    expect(list.querySelector('.flib-faq').compareDocumentPosition(list.querySelector('.flib-card')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a search inside Did you know? shows only questions, and an honest empty state', () => {
    FeatureLibrary.render(host());
    host().querySelector('.flib-chip-faq').click();
    const q = host().querySelector('#flib-q');
    q.value = 'zzzzqq'; q.dispatchEvent(new Event('input'));
    expect(host().querySelector('.flib-empty').textContent).toContain('No question here matches that');
    q.value = 'tor'; q.dispatchEvent(new Event('input'));
    expect(host().querySelectorAll('.flib-card').length).toBe(0);
  });
});

describe('lazy loading', () => {
  it('loads the questions the first time the Library is opened, through the lazy loader', async () => {
    delete globalThis.FeatureFaq;
    const ensure = vi.fn(async () => { globalThis.FeatureFaq = FeatureFaq; return true; });
    window.VexLazy = { ensure };
    FeatureLibrary.render(host());
    expect(host().querySelector('.flib-chip-faq')).toBeNull();
    await vi.waitFor(() => expect(host().querySelector('.flib-chip-faq')).toBeTruthy());
    expect(ensure).toHaveBeenCalledWith('js/feature-faq.js');
    delete window.VexLazy;
  });
});
