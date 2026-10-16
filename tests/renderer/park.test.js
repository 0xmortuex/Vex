// @vitest-environment jsdom
//
// T1-019: park where you are, come back with one click (js/park.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let P, ledger, tabs, created;
const NOW = new Date(2026, 9, 14, 14, 0).getTime();

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.resetModules();
  ({ VexPark: P } = fresh(JS + 'park.js'));
  created = [];
  tabs = [
    { id: 't1', url: 'https://example.com/spec', title: 'Spec' },
    { id: 't2', url: 'https://example.com/other', title: 'Other' },
    { id: 't3', url: 'about:blank', title: 'Blank' },
  ];
  const undos = new Map();
  ledger = { note: vi.fn(), registerUndo: vi.fn((k, f) => undos.set(k, f)), undos };
  globalThis.VexLedger = ledger;
  globalThis.WorkspaceManager = { activeId: 'ws_work', getActive: () => ({ name: 'Work' }) };
  globalThis.TabManager = {
    tabs,
    getActiveTab: () => tabs[0],
    createTab: vi.fn((url, activate, group, opts) => { const id = 'new' + created.length; created.push({ id, url, activate, opts }); return id; }),
    closeTab: vi.fn(),
  };
  globalThis.WebviewManager = { getActiveWebview: () => ({ executeJavaScript: async () => ({ x: 0, y: 1200 }) }) };
  globalThis.VexSettingsGroups = {
    register: () => {},
    button: (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.addEventListener('click', fn); return b; },
    note: (t) => { const d = document.createElement('div'); d.textContent = t; return d; },
    dialog: () => ({ body: document.body, close() {} }),
  };
  window.VexTabPolicy = { canRestore: (t) => !!t && /^https?:/.test(t.url) };
});

describe('capture() (pure)', () => {
  it('keeps the line, the restorable tabs and the front tab with its scroll', () => {
    const c = P.capture({ note: '  reading   the spec ', tabs, activeUrl: 'https://example.com/other', scroll: { x: 0, y: 900 }, wsId: 'ws_work', wsName: 'Work', now: NOW, id: 'pk1' });
    expect(c).toMatchObject({ id: 'pk1', note: 'reading the spec', wsId: 'ws_work', front: 1, scroll: { x: 0, y: 900 }, resumedAt: 0, dismissedAt: 0 });
    expect(c.tabs.map(t => t.url)).toEqual(['https://example.com/spec', 'https://example.com/other']);   // about:blank is not kept
  });
  it('refuses an empty or over-long line and a missing workspace', () => {
    expect(() => P.capture({ note: '  ', tabs, wsId: 'w' })).toThrow(/one line/);
    expect(() => P.capture({ note: 'x'.repeat(300), tabs, wsId: 'w' })).toThrow(/Keep it to one line/);
    expect(() => P.capture({ note: 'ok', tabs, wsId: '' })).toThrow(/no workspace/);
  });
  it('drops a non-numeric scroll', () => {
    expect(P.capture({ note: 'a', tabs, activeUrl: tabs[0].url, scroll: { x: 'a', y: 2 }, wsId: 'w' }).scroll).toBe(null);
  });
});

describe('cardFor()', () => {
  it('is the newest card of that workspace that is neither resumed nor dismissed', () => {
    const cards = [
      { id: 'a', wsId: 'w1', at: 1, resumedAt: 0, dismissedAt: 0 },
      { id: 'b', wsId: 'w1', at: 3, resumedAt: 0, dismissedAt: 0 },
      { id: 'c', wsId: 'w1', at: 5, resumedAt: 9, dismissedAt: 0 },
      { id: 'd', wsId: 'w2', at: 7, resumedAt: 0, dismissedAt: 0 },
    ];
    expect(P.cardFor(cards, 'w1').id).toBe('b');
    expect(P.cardFor(cards, 'w3')).toBe(null);
  });
});

describe('park()', () => {
  it('saves a card under the workspace and writes it in the ledger with an undo', async () => {
    const card = await P.park('reading the spec');
    expect(P.cards()).toHaveLength(1);
    expect(card).toMatchObject({ wsId: 'ws_work', wsName: 'Work', note: 'reading the spec', scroll: { x: 0, y: 1200 } });
    expect(card.tabs).toHaveLength(2);
    expect(ledger.note).toHaveBeenCalledWith(expect.objectContaining({ feature: 'park-resume', undo: { kind: 'park-delete', id: card.id } }));
  });

  it('still parks when the page does not answer for the scroll, and says so in Problems', async () => {
    const note = vi.fn();
    window.VexProblems = { note };
    globalThis.WebviewManager = { getActiveWebview: () => ({ executeJavaScript: () => Promise.reject(new Error('hung')) }) };
    const card = await P.park('x');
    expect(card.scroll).toBe(null);
    expect(note).toHaveBeenCalledTimes(1);
    delete window.VexProblems;
  });
});

describe('resume()', () => {
  it('reopens every tab next to the open ones, the front one active and scrolled, and can be undone', async () => {
    const card = await P.park('reading');
    const ids = await P.resume(card.id, { now: NOW });
    expect(created.map(c => c.url)).toEqual(['https://example.com/spec', 'https://example.com/other']);
    expect(created[0]).toMatchObject({ activate: true, opts: { allowDuplicate: true, scrollPosition: { x: 0, y: 1200 } } });
    expect(created[1].activate).toBe(false);
    expect(ids).toEqual(['new0', 'new1']);
    expect(P.cards()[0].resumedAt).toBe(NOW);
    const entry = ledger.note.mock.calls.at(-1)[0];
    expect(entry.undo).toEqual({ kind: 'park-unresume', id: card.id, tabIds: ['new0', 'new1'] });

    P.init();
    tabs.push({ id: 'new0' });
    await ledger.undos.get('park-unresume')(entry.undo);
    expect(TabManager.closeTab).toHaveBeenCalledTimes(1);
    expect(TabManager.closeTab).toHaveBeenCalledWith('new0');
    expect(P.cards()[0].resumedAt).toBe(0);
  });

  it('refuses a card that is gone and one with no tabs', async () => {
    await expect(P.resume('nope')).rejects.toThrow(/gone/);
    localStorage.setItem(P.KEY, JSON.stringify([{ id: 'e', wsId: 'w', tabs: [], note: 'n', at: 1 }]));
    await expect(P.resume('e')).rejects.toThrow(/no tabs/);
  });

  it('undoing a park removes the card', async () => {
    const card = await P.park('x');
    P.init();
    await ledger.undos.get('park-delete')({ id: card.id });
    expect(P.cards()).toHaveLength(0);
    await expect(ledger.undos.get('park-delete')({ id: card.id })).rejects.toThrow(/already gone/);
  });
});

describe('the card on return', () => {
  it('shows for the workspace, hides on Dismiss and does not come back', async () => {
    await P.park('reading the spec');
    expect(P.showBannerFor('ws_dev')).toBe(false);
    expect(P.showBannerFor('ws_work')).toBe(true);
    expect(document.getElementById('vex-park-banner').textContent).toContain('reading the spec');
    [...document.querySelectorAll('#vex-park-banner button')].find(b => b.textContent === 'Dismiss').click();
    expect(document.getElementById('vex-park-banner')).toBe(null);
    expect(P.showBannerFor('ws_work')).toBe(false);
    expect(P.cards()).toHaveLength(1);          // the card stays in the list
  });

  it('shows nothing when switched off', async () => {
    await P.park('x');
    P.setEnabled(false);
    expect(P.showBannerFor('ws_work')).toBe(false);
  });

  it('keeps the newest twenty cards', () => {
    const list = Array.from({ length: 25 }, (_, i) => ({ id: 'c' + i, wsId: 'w', tabs: [], note: 'n', at: i }));
    expect(P._save(list)).toHaveLength(20);
    expect(P.cards().some(c => c.id === 'c0')).toBe(false);
  });
});
