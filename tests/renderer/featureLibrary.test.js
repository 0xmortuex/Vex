// @vitest-environment jsdom
//
// The Library's "Everything Vex can do": every feature, with what it is for,
// where it lives and how to start it. The facts come from the catalogue and
// the guide, never from a second copy — that is the thing worth pinning down,
// because a reference that disagrees with the app is worse than none.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { FeatureLibrary } = require('../../src/renderer/js/feature-library.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { VexGuide } = require('../../src/renderer/js/vex-guide.js');
const { FeatureDetails } = require('../../src/renderer/js/feature-details.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="host"></div>';
  globalThis.VexFeatures = VexFeatures;
  globalThis.VexGuide = VexGuide;
  globalThis.FeatureLibrary = FeatureLibrary;
  globalThis.FeatureDetails = FeatureDetails;
  globalThis.CommandBar = { commands: [{ id: 'ai', label: 'AI Panel', shortcut: 'Ctrl+Shift+A', action: vi.fn() }] };
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  FeatureLibrary._query = '';
  FeatureLibrary._cat = null;
});

const host = () => document.getElementById('host');

describe('one feature, written out', () => {
  it('says what it is for, where it lives and what to do — from the catalogue', () => {
    const c = FeatureLibrary.card(VexFeatures.get('ai-panel'));
    expect(c.name).toBe('AI Panel');          // the live command's own label
    expect(c.what).toBe(VexFeatures.get('ai-panel').what);
    expect(c.category).toBe('AI');
    expect(c.where.join(' ')).toMatch(/command bar/i);
    expect(c.steps.length).toBeGreaterThan(0);
    expect(c.near.length).toBeGreaterThan(0);          // the rest of its area
    expect(c.canOpen).toBe(true);
  });

  it('a feature you do by hand offers no Open, and says so', () => {
    const c = FeatureLibrary.card(VexFeatures.get('find-in-page'));
    expect(c.canOpen).toBe(false);
    expect(c.keys).toBe('Ctrl+F');
    expect(c.where.join(' ')).toMatch(/not a command/);
  });
});

describe('the list', () => {
  it('draws every feature, grouped by area', () => {
    FeatureLibrary.render(host());
    expect(document.querySelectorAll('.flib-card').length).toBe(VexFeatures.ITEMS.length);
    expect(document.querySelectorAll('.flib-group').length).toBe(VexFeatures.CATS.filter(c => VexFeatures.byCat(c.id).length).length);
  });

  it('searches in the words people use, not only the names', () => {
    FeatureLibrary.render(host());
    const q = host().querySelector('#flib-q');
    q.value = 'memory';
    q.dispatchEvent(new Event('input'));
    const names = [...document.querySelectorAll('.flib-name')].map(e => e.textContent);
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThan(VexFeatures.ITEMS.length);
    expect(names.join(' ')).toMatch(/memory/i);
    expect(names.join(' ')).not.toMatch(/eyedropper/i);
  });

  it('one area at a time, when you pick one', () => {
    FeatureLibrary.render(host());
    host().querySelector('[data-cat="privacy"]').click();
    expect(document.querySelectorAll('.flib-card').length).toBe(VexFeatures.byCat('privacy').length);
  });

  it('says so when nothing matches, in a way that helps', () => {
    FeatureLibrary.render(host());
    const q = host().querySelector('#flib-q');
    q.value = 'zzzzqqq';
    q.dispatchEvent(new Event('input'));
    expect(document.querySelector('.flib-empty').textContent).toMatch(/Nothing matches/);
  });

  it('a card opens to the detail, and closes again', () => {
    FeatureLibrary.render(host());
    const card = document.querySelector('.flib-card');
    expect(card.classList.contains('open')).toBe(false);
    card.querySelector('[data-open-card]').click();
    expect(card.classList.contains('open')).toBe(true);
    card.querySelector('[data-open-card]').click();
    expect(card.classList.contains('open')).toBe(false);
  });
});

describe('the three buttons', () => {
  it('Open runs the feature through the guide, so there is one implementation', () => {
    const run = vi.spyOn(VexGuide, 'run').mockReturnValue(undefined);
    FeatureLibrary.run('ai-panel');
    expect(run).toHaveBeenCalledWith(VexFeatures.get('ai-panel'));
    run.mockRestore();
  });

  it('Ask Vex asks about THIS feature, with the catalogue as the facts', () => {
    const q = FeatureLibrary.question('ai-panel');
    expect(q).toContain('Feature: AI Panel');
    expect(q).toContain(VexFeatures.get('ai-panel').what);
    expect(q).toMatch(/Use only these facts/);
    expect(q).toMatch(/say you do not know/);
  });

  it('Ask Vex opens the panel and sends it', () => {
    const sent = [];
    globalThis.AIPanel = { open: vi.fn(), sendMessage: (m) => sent.push(m) };
    FeatureLibrary.ask('ai-panel');
    expect(AIPanel.open).toHaveBeenCalled();
    expect(sent[0]).toContain('Feature: AI Panel');
  });
});

describe('every entry in the catalogue', () => {
  it('has the long version written for it — all of them, not most', () => {
    const missing = VexFeatures.ITEMS.filter(f => !FeatureDetails[f.id]).map(f => f.id);
    expect(missing).toEqual([]);
    const stale = Object.keys(FeatureDetails).filter(id => !VexFeatures.get(id));
    expect(stale).toEqual([]);                    // nothing describing a feature that is gone
  });

  it('says something beyond the one-line description', () => {
    for (const f of VexFeatures.ITEMS) {
      const d = FeatureDetails[f.id];
      expect(d.length, f.id).toBeGreaterThan(60);
      expect(d.trim(), f.id).not.toBe(f.what.trim());
    }
  });

  it('can be written out without throwing, and says something useful', () => {
    for (const f of VexFeatures.ITEMS) {
      const c = FeatureLibrary.card(f);
      expect(c.name, f.id).toBeTruthy();
      expect(c.what, f.id).toBeTruthy();
      // Either it says where it lives, or it tells you what to do. A card
      // with neither would be a name and nothing else.
      expect(c.where.length + c.steps.length, f.id).toBeGreaterThan(0);
    }
  });
});
