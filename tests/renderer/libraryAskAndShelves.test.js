// @vitest-environment jsdom
//
// Two things the Library needed: somewhere to ask for what you cannot name,
// and shelves. Twelve categories filed 221 features and "Productivity" alone
// was fifty-four of them under one heading, which is a list, not an order.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { FeatureLibrary } = require('../../src/renderer/js/feature-library.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { VexGuide } = require('../../src/renderer/js/vex-guide.js');
const { GuideTemplates } = require('../../src/renderer/js/guide-templates.js');
const { FeatureDetails } = require('../../src/renderer/js/feature-details.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="host"></div>';
  globalThis.VexFeatures = VexFeatures;
  globalThis.VexGuide = VexGuide;
  globalThis.GuideTemplates = GuideTemplates;
  globalThis.FeatureDetails = FeatureDetails;
  globalThis.FeatureLibrary = FeatureLibrary;
  globalThis.CommandBar = { commands: [{ id: 'ai', label: 'AI Panel', shortcut: 'Ctrl+Shift+A', action: vi.fn() }] };
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  Element.prototype.scrollIntoView = () => {};
  FeatureLibrary._query = '';
  FeatureLibrary._cat = null;
});

const host = () => document.getElementById('host');

describe('every feature is on a shelf', () => {
  it('nothing is lost and nothing is listed twice', () => {
    const seen = new Map();
    for (const [cat, shelves] of Object.entries(VexFeatures.GROUPS)) {
      for (const shelf of shelves) {
        for (const id of shelf.ids) {
          const f = VexFeatures.get(id);
          expect(f, `${cat}/${shelf.name}: no such feature "${id}"`).toBeTruthy();
          expect(f.cat, `${id} is filed under ${cat} but belongs to ${f.cat}`).toBe(cat);
          expect(seen.has(id), `${id} is on two shelves`).toBe(false);
          seen.set(id, cat);
        }
      }
    }
  });

  it('a category with shelves still returns all of its features', () => {
    for (const cat of VexFeatures.CATS) {
      const shelved = VexFeatures.groupsFor(cat.id).reduce((n, g) => n + g.items.length, 0);
      expect(shelved, cat.id).toBe(VexFeatures.byCat(cat.id).length);
    }
  });

  it('a feature nobody filed lands in "More" rather than disappearing', () => {
    const before = VexFeatures.GROUPS.work;
    try {
      VexFeatures.GROUPS.work = [{ name: 'Notes', ids: ['notes'] }];
      const groups = VexFeatures.groupsFor('work');
      expect(groups[0].name).toBe('Notes');
      expect(groups[groups.length - 1].name).toBe('More');
      expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(VexFeatures.byCat('work').length);
    } finally { VexFeatures.GROUPS.work = before; }
  });

  it('draws the shelf headings, with a count on each', () => {
    FeatureLibrary.render(host());
    const shelves = [...document.querySelectorAll('.flib-shelf')].map(e => e.textContent.trim());
    expect(shelves.length).toBeGreaterThan(20);
    expect(shelves.some(t => t.startsWith('Reminders and alarms'))).toBe(true);
    expect(document.querySelectorAll('.flib-card').length).toBe(VexFeatures.ITEMS.length);
  });

  it('a search is a flat list — you already said what you wanted', () => {
    FeatureLibrary.render(host());
    const q = host().querySelector('#flib-q');
    q.value = 'memory';
    q.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.flib-shelf').length).toBe(0);
    expect(document.querySelectorAll('.flib-group').length).toBe(0);
  });
});

describe('ask Vex what you do not know', () => {
  it('takes the problem, not the name of the feature', () => {
    const a = FeatureLibrary.answer('two accounts on one site');
    expect(a.headline).toMatch(/Container tabs/i);
    expect(a.items.some(f => f.id === 'containers')).toBe(true);
  });

  it('a complaint works as well as a question', () => {
    const a = FeatureLibrary.answer('it is using all my ram');
    expect(a.steps.join(' ')).toMatch(/Running Tasks|Free memory/i);
    expect(a.items.length).toBeGreaterThan(0);
  });

  it('falls through to the feature search when no template matches', () => {
    const a = FeatureLibrary.answer('record my screen');
    expect(a.items.some(f => f.id === 'record-screen')).toBe(true);
    expect(a.headline).toBe('These are the ones for that.');
  });

  it('says plainly when it has nothing, and offers the AI', () => {
    const a = FeatureLibrary.answer('xyzzy plugh');
    expect(a.items).toEqual([]);
    expect(a.headline).toMatch(/Nothing here matches/);
    FeatureLibrary.render(host());
    FeatureLibrary.answerInto(host(), 'xyzzy plugh');
    expect(document.querySelector('[data-ask-ai]').textContent).toBe('Ask the AI');
  });

  it('draws the answer as the Library’s own cards, which still work', () => {
    FeatureLibrary.render(host());
    FeatureLibrary.answerInto(host(), 'two accounts on one site');
    const card = document.querySelector('#flib-ask-out .flib-card');
    expect(card).not.toBeNull();
    card.querySelector('[data-open-card]').click();
    expect(card.classList.contains('open')).toBe(true);
  });

  it('nothing typed, nothing claimed', () => {
    expect(FeatureLibrary.answer('   ')).toBeNull();
  });

  it('suggests things you have never run, and opens one when clicked', () => {
    FeatureLibrary.render(host());
    const picks = [...document.querySelectorAll('[data-jump]')];
    expect(picks.length).toBe(FeatureLibrary.SUGGESTIONS);
    picks[0].click();
    expect(document.querySelector('#flib-ask-out .flib-card.open')).not.toBeNull();
  });

  it('what you have used is not suggested as new', () => {
    // Usage is read from the command bar's own counts and the sidebar's
    // per-panel timestamps, so both have to be set for nothing to be left.
    localStorage.setItem('vex.commandUsage', JSON.stringify(Object.fromEntries(
      VexFeatures.ITEMS.filter(f => f.cmd).map(f => [f.cmd, { n: 3 }]))));
    localStorage.setItem('vex.panelUsage', JSON.stringify(Object.fromEntries(
      VexFeatures.ITEMS.filter(f => f.panel).map(f => [f.panel, Date.now()]))));
    expect(FeatureLibrary.suggestions()).toEqual([]);
  });
});
