// @vitest-environment jsdom
//
// js/inbox-hub.js: one Inbox window with three tabs (Notices, Things I saved, Waiting on me). Each tab draws
// the existing list from the module that owns it; nothing is merged and no key moves. Fakes stand in for the
// settings dialog and for Needs me; the Attention Inbox, One inbox and the Needs me screen are the real files.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

const NAMES = ['AttentionInbox', 'VexInbox', 'VexInboxHub', 'PanelsCommsUI', 'NeedsMe', 'VexSettingsGroups', 'VexTriage', 'VexAttention', 'VexUsage'];
let hub, attention, inbox, comms, needsMe, triageOpen;

function fakeGroups() {
  return {
    register() {},
    dialog({ id, title }) {
      document.getElementById(id)?.remove();
      const overlay = document.createElement('div'); overlay.id = id;
      const h = document.createElement('span'); h.textContent = title;
      const body = document.createElement('div');
      overlay.append(h, body); document.body.appendChild(overlay);
      return { overlay, body, close: () => overlay.remove() };
    },
    note(t) { const d = document.createElement('div'); d.className = 'note'; d.textContent = t; return d; },
    button(t, fn, o = {}) { const b = document.createElement('button'); b.textContent = t; if (o.label) b.setAttribute('aria-label', o.label); b.addEventListener('click', fn); return b; },
  };
}

function load({ withHub = true } = {}) {
  attention = fresh('attention-inbox.js').AttentionInbox; globalThis.AttentionInbox = attention;
  inbox = fresh('inbox.js').VexInbox; globalThis.VexInbox = inbox;
  comms = fresh('panels-comms-ui.js').PanelsCommsUI; globalThis.PanelsCommsUI = comms;
  hub = fresh('inbox-hub.js').VexInboxHub;
  if (withHub) globalThis.VexInboxHub = hub; else delete globalThis.VexInboxHub;
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const selected = () => [...document.querySelectorAll('#vex-inbox-hub [role="tab"]')].filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.id.replace('vex-inbox-hub-tab-', ''));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-attention" hidden></button>';
  for (const n of NAMES) delete globalThis[n];
  window.showToast = vi.fn();
  globalThis.VexSettingsGroups = fakeGroups();
  triageOpen = vi.fn(() => Promise.resolve());
  globalThis.VexTriage = { open: triageOpen };
  needsMe = {
    enabled: () => true,
    ranked: () => false,
    setRanked() {},
    collect: vi.fn(async () => ({ rows: [{ id: 'r1', title: 'Mum wrote', why: ['kept notification'], origin: 'x', ref: {} }, { id: 'r2', title: 'Build failed', why: ['ci'], origin: 'x', ref: {} }], problems: [] })),
    open() {}, dismiss() {}, snooze() {}, muteConversation() {},
  };
  globalThis.NeedsMe = needsMe;
  load();
  attention.add({ feature: 'backup', title: 'Back up your notes', id: 'a' });
  attention.add({ feature: 'tabs', title: 'Tidy these tabs', id: 'b' });
  localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', title: 'Shopping list', content: 'milk', updatedAt: new Date().toISOString() }]));
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('every old way in opens the Inbox on the right tab', () => {
  const cases = [
    ['notices', 'notices'], ['saved', 'saved'], ['waiting', 'waiting'],
    ['attention-inbox', 'notices'], ['inbox-open', 'saved'], ['inbox-unified', 'saved'], ['weekly-triage', 'saved'], ['needs-me', 'waiting'],
  ];
  for (const [id, tab] of cases) {
    it('open("' + id + '") selects ' + tab, async () => {
      await hub.open(id);
      expect(selected()).toEqual([tab]);
      expect(document.getElementById('vex-inbox-hub-panel').getAttribute('aria-labelledby')).toBe('vex-inbox-hub-tab-' + tab);
    });
  }

  it('an unknown id throws instead of opening something else', async () => {
    await expect(hub.open('nope')).rejects.toThrow(/no tab/);
    expect(document.getElementById('vex-inbox-hub')).toBeNull();
  });

  it('the bell and Ctrl+K "Open the Inbox" (AttentionInbox.open / toggle) land on Notices', async () => {
    attention.open(); await flush();
    expect(selected()).toEqual(['notices']);
    expect(document.getElementById('attention-inbox-pop')).toBeNull();
    attention.toggle();
    expect(document.getElementById('vex-inbox-hub')).toBeNull();
  });

  it('Ctrl+K "Inbox" (VexInbox.open) lands on Things I saved and "Needs me" (openNeedsMe) on Waiting on me', async () => {
    await inbox.open(); expect(selected()).toEqual(['saved']);
    await comms.openNeedsMe(); expect(selected()).toEqual(['waiting']);
    expect(document.getElementById('needs-me-dialog')).not.toBeNull();
  });

  it('until the hub has loaded, each old surface still opens its own window', async () => {
    load({ withHub: false });
    attention.add({ feature: 'backup', title: 'Back up your notes', id: 'a' });
    attention.open();
    expect(document.getElementById('attention-inbox-pop')).not.toBeNull();
    await inbox.open();
    expect(document.getElementById('vex-inbox')).not.toBeNull();
    await comms.openNeedsMe();
    expect(document.getElementById('needs-me-dialog')).not.toBeNull();
    expect(document.getElementById('vex-inbox-hub')).toBeNull();
  });
});

describe('each tab shows the existing list unchanged', () => {
  it('Notices has the bell rows with the same three verbs', async () => {
    await hub.open('notices');
    const panel = document.getElementById('vex-inbox-hub-panel');
    expect(panel.textContent).toContain('Back up your notes');
    expect(panel.textContent).toContain('Tidy these tabs');
    const labels = [...panel.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toContain('Dismiss');
    expect(labels).toContain('Show less');
    expect(labels).toContain('Never for this feature');
    [...panel.querySelectorAll('button')].find(b => b.textContent === 'Dismiss').click();
    expect(attention.count()).toBe(1);
    expect(panel.textContent).not.toContain('Tidy these tabs');
    expect(panel.textContent).toContain('Back up your notes');
  });

  it('Things I saved is the One inbox list, with a Weekly triage button', async () => {
    await hub.open('saved'); await flush();
    const panel = document.getElementById('vex-inbox-hub-panel');
    expect(panel.textContent).toContain('Shopping list');
    const btn = [...panel.querySelectorAll('button')].find(b => b.textContent === 'Weekly triage');
    btn.click();
    expect(triageOpen).toHaveBeenCalledTimes(1);
  });

  it('Waiting on me is the Needs me screen', async () => {
    await hub.open('waiting'); await flush();
    const panel = document.getElementById('vex-inbox-hub-panel');
    expect(panel.textContent).toContain('Mum wrote');
    expect(panel.textContent).toContain('Why: kept notification');
  });

  it('switching tabs leaves nothing of the old tab behind and the bell list stops drawing into it', async () => {
    await hub.open('notices');
    const old = document.querySelector('#vex-inbox-hub-panel .ibh-view');
    document.getElementById('vex-inbox-hub-tab-saved').click(); await flush();
    expect(old.isConnected).toBe(false);
    attention.add({ feature: 'x', title: 'Late row', id: 'z' });
    expect(document.getElementById('vex-inbox-hub-panel').textContent).not.toContain('Late row');
  });

  it('a switched-off list says so on its tab', async () => {
    needsMe.enabled = () => false;
    await hub.open('waiting');
    expect(document.getElementById('vex-inbox-hub-panel').textContent).toContain('Needs me is switched off');
  });
});

describe('counts', () => {
  it('the tabs show the same numbers the three modules give, and the bell count does not move', async () => {
    const before = attention.count();
    await hub.open('saved'); await flush();
    const n = (id) => document.querySelector('#vex-inbox-hub-tab-' + id + ' .ibh-n');
    expect(n('notices').textContent).toBe(String(before));
    expect(n('saved').textContent).toBe('1');
    expect(n('waiting').textContent).toBe('2');
    expect(document.getElementById('vex-inbox-hub-tab-waiting').getAttribute('aria-label')).toBe('Waiting on me, 2');
    expect(attention.count()).toBe(before);
    const direct = await hub.counts();
    expect(direct).toMatchObject({ notices: before, saved: (await inbox.count()).unseen === 0 ? 0 : direct.saved, waiting: 2 });
  });

  it('a list that cannot be counted is named, not hidden', async () => {
    needsMe.collect = vi.fn(async () => { throw new Error('autopilot is down'); });
    const c = await hub.counts();
    expect(c.waiting).toBe(0);
    expect(c.problems.join(' ')).toContain('autopilot is down');
  });
});

describe('saved order and the panel data are untouched', () => {
  it('opening every tab writes no sidebar key and no key of its own', async () => {
    localStorage.setItem('vex.sidebarOrder', '["notes","calendar"]');
    localStorage.setItem('vex.panelOverrides', '{"notes":{"hidden":true}}');
    const before = { ...localStorage };
    for (const t of ['notices', 'saved', 'waiting']) { await hub.open(t); await flush(); }
    expect(localStorage.getItem('vex.sidebarOrder')).toBe('["notes","calendar"]');
    expect(localStorage.getItem('vex.panelOverrides')).toBe('{"notes":{"hidden":true}}');
    const added = Object.keys(localStorage).filter(k => !(k in before)).sort();
    // only the two "when did you last look" stamps the lists wrote before this file existed
    expect(added.every(k => ['vex.attention.seenAt', 'vex.inbox.seen'].includes(k))).toBe(true);
  });
});

describe('keyboard and roles', () => {
  it('is a tablist with one tab stop; arrows, Home and End move and select', async () => {
    await hub.open('notices'); await flush();
    const list = document.querySelector('#vex-inbox-hub [role="tablist"]');
    expect(list.getAttribute('aria-label')).toBe('Inbox sections');
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    expect(tabs.map(t => t.tabIndex)).toEqual([0, -1, -1]);
    const key = (k) => tabs.find(t => t.tabIndex === 0).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowRight'); await flush(); expect(selected()).toEqual(['saved']);
    expect(document.activeElement.id).toBe('vex-inbox-hub-tab-saved');
    key('End'); await flush(); expect(selected()).toEqual(['waiting']);
    key('ArrowRight'); await flush(); expect(selected()).toEqual(['notices']);
    key('ArrowLeft'); await flush(); expect(selected()).toEqual(['waiting']);
    key('Home'); await flush(); expect(selected()).toEqual(['notices']);
    expect(tabs.map(t => t.tabIndex)).toEqual([0, -1, -1]);
  });
});
