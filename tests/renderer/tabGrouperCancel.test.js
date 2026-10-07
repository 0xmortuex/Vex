// @vitest-environment jsdom
// Organize My Tabs locked the window (walkthrough H2, 2026-10-07): the
// "Analyzing your tabs…" modal had no Cancel and ignored Escape, the proposal
// ignored Escape, an answer that arrived after the modal was gone still popped
// up, two empty New Tabs were proposed as a group, and "Remember these
// patterns" was pre-checked.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const START = 'file:///C:/Vex/resources/app.asar/src/renderer/start.html?theme=oxford';

function tabs() {
  return [
    { id: 'a', title: 'Claude', url: 'https://claude.ai/chat' },
    { id: 'b', title: 'Claude docs', url: 'https://docs.claude.com/' },
    { id: 'c', title: 'Roblox', url: 'https://www.roblox.com/' },
    { id: 'n1', title: 'New Tab', url: START },
    { id: 'n2', title: 'New Tab', url: 'vex://start' },
  ];
}

const REPLY = JSON.stringify({ groups: [{ name: 'AI', color: 'indigo', tabIds: ['t1', 't2'], pattern: 'claude', confidence: 0.9 }], ungrouped: ['t3'] });

let mod;
let pending;
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  globalThis.TabManager = { tabs: tabs(), groups: [], mayAskSiteForIcon: () => false, rebuildAllTabs() {}, persistTabs() {} };
  pending = null;
  globalThis.AIRouter = {
    callAI: vi.fn((feature, request) => new Promise((resolve) => { pending = { resolve, request }; })),
  };
  const p = require.resolve('../../src/renderer/js/tab-grouper.js');
  delete require.cache[p];
  mod = require(p);
});

const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const flush = () => new Promise(r => setTimeout(r, 0));

describe('blank tabs', () => {
  it('a New Tab, vex://start and about:blank are blank; a page is not', () => {
    expect(mod._isBlankTab({ url: START })).toBe(true);
    expect(mod._isBlankTab({ url: 'vex://start' })).toBe(true);
    expect(mod._isBlankTab({ url: 'about:blank' })).toBe(true);
    expect(mod._isBlankTab({ url: '' })).toBe(true);
    expect(mod._isBlankTab({ url: 'https://example.com/' })).toBe(false);
  });

  it('only pages are sent to the AI', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    expect(pending.request.tabs.map(t => t.title)).toEqual(['Claude', 'Claude docs', 'Roblox']);
    // the abort signal travels with the request but stays out of the JSON prompt
    expect(pending.request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(pending.request)).not.toMatch(/signal/);
  });
});

describe('loading modal', () => {
  it('Escape cancels: aborts the request, closes, and a late answer never shows', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    expect(document.querySelector('.group-loading-overlay')).not.toBeNull();
    esc();
    expect(document.querySelector('.group-loading-overlay')).toBeNull();
    expect(pending.request.signal.aborted).toBe(true);
    pending.resolve({ result: REPLY });
    await flush(); await flush();
    expect(document.querySelector('.group-preview-modal')).toBeNull();
  });

  it('the Cancel button does the same', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    document.querySelector('.group-loading-cancel').click();
    expect(pending.request.signal.aborted).toBe(true);
    pending.resolve({ result: REPLY });
    await flush(); await flush();
    expect(document.querySelector('.group-preview-modal')).toBeNull();
  });

  it('a modal removed by something else makes the answer stale too', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    document.querySelector('.group-loading-overlay').remove();
    pending.resolve({ result: REPLY });
    await flush(); await flush();
    expect(document.querySelector('.group-preview-modal')).toBeNull();
  });
});

describe('proposal modal', () => {
  it('opens with Remember unchecked and closes on Escape', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    pending.resolve({ result: REPLY });
    await flush(); await flush();
    expect(document.querySelector('.group-preview-modal')).not.toBeNull();
    expect(document.querySelector('#remember-patterns').checked).toBe(false);
    esc();
    expect(document.querySelector('.group-preview-modal')).toBeNull();
  });
});
