// @vitest-environment jsdom
// Ctrl+Shift+G ("Organize My Tabs") reported by the owner as "the browser gets a bit whiter, no groups". Whatever the AI does, the
// person is told plainly why nothing happened, the dimmed layer always goes away, a second press does not stack a second layer, and a
// wait that is not 3-8 seconds says so.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function pages(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ id: 'id' + i, title: 'Page ' + i, url: 'https://site' + i + '.example/' });
  return out;
}
const REPLY = JSON.stringify({ groups: [{ name: 'Pages', color: 'indigo', tabIds: ['t1', 't2'], pattern: 'pages', confidence: 0.9 }], ungrouped: ['t3'], reasoning: 'They are all pages.' });

let mod, pending, toasts;
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  toasts = [];
  window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn((msg, kind, dur) => toasts.push({ msg, kind, dur }));
  globalThis.TabManager = { tabs: pages(4), groups: [], mayAskSiteForIcon: () => false, rebuildAllTabs() {}, persistTabs() {} };
  pending = null;
  globalThis.AIRouter = { callAI: vi.fn((feature, request) => new Promise((resolve, reject) => { pending = { resolve, reject, request }; })) };
  const p = require.resolve('../../src/renderer/js/tab-grouper.js');
  delete require.cache[p];
  mod = require(p);
});
afterEach(() => { vi.useRealTimers(); });

const flush = () => new Promise(r => setTimeout(r, 0));
const loadingUp = () => document.querySelector('.group-loading-overlay') !== null;
const anyLayer = () => document.querySelectorAll('.sync-modal-overlay').length;
const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('what the person is told', () => {
  it('names the kind of failure and keeps the real reason', () => {
    const unreachable = mod._failureText(new Error('No AI to answer: Ollama at http://localhost:11434 is not running, and no cloud AI Worker is configured.'));
    expect(unreachable).toMatch(/^Vex AI could not be reached, so no tabs were grouped\. No AI to answer: Ollama/);
    const unusable = mod._failureText(new Error('the AI reply was not JSON: “Sorry”'));
    expect(unusable).toMatch(/^Vex AI answered, but not with groups Vex can use, so nothing was changed\. The AI reply was not JSON/);
    expect(mod._failureText(new Error('Not now: a game is running. Try again in a moment.'))).toBe('Grouping failed: Not now: a game is running. Try again in a moment.');
  });

  it('judges "Both local (A) and cloud (B) AI failed" by the local half, which was asked first', () => {
    const emptyThenNoCloud = mod._failureText(new Error('Both local (qwen3.5:latest returned an empty reply) and cloud (Cloud AI is not configured: no AI Worker URL is set) AI failed'));
    expect(emptyThenNoCloud).toMatch(/^Vex AI answered, but not with groups Vex can use/);
    const crashThenNoCloud = mod._failureText(new Error('Both local (Ollama: model runner has unexpectedly stopped) and cloud (Cloud AI is not configured) AI failed'));
    expect(crashThenNoCloud).toMatch(/^Grouping failed: Both local \(Ollama: model runner/);
  });

  it('too few tabs says how many there are; no groups says nothing was grouped', () => {
    expect(mod._tooFewText(2)).toBe('Organize My Tabs needs at least 3 ungrouped tabs with a page open; you have 2.');
    expect(mod._noGroupsText('nothing in common')).toBe('Vex AI found no tabs that belong together, so nothing was grouped. Nothing in common');
    expect(mod._noGroupsText('')).toBe('Vex AI found no tabs that belong together, so nothing was grouped.');
    expect(mod._applyLabel(1)).toBe('Apply 1 group');
    expect(mod._applyLabel(3)).toBe('Apply 3 groups');
  });
});

describe('Ctrl+Shift+G through the grouper', () => {
  it('fewer than 3 tabs: a toast with the count, no dimmed layer, the AI is not asked', async () => {
    TabManager.tabs = pages(2);
    await mod.TabGrouper.analyzeAndPropose();
    expect(anyLayer()).toBe(0);
    expect(AIRouter.callAI).not.toHaveBeenCalled();
    expect(toasts[0].msg).toBe('Organize My Tabs needs at least 3 ungrouped tabs with a page open; you have 2.');
    expect(toasts[0].kind).toBe('warn');
  });

  it('the AI cannot be reached: the layer goes away and the toast says so', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    expect(loadingUp()).toBe(true);
    pending.reject(new Error('No AI to answer: Ollama at http://localhost:11434 is not running, and no cloud AI Worker is configured.'));
    await flush(); await flush();
    expect(anyLayer()).toBe(0);
    expect(toasts.at(-1).kind).toBe('error');
    expect(toasts.at(-1).msg).toMatch(/^Vex AI could not be reached, so no tabs were grouped\./);
  });

  it('an empty answer: the layer goes away and the toast says it was unusable', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    pending.resolve({ result: '' });
    await flush(); await flush();
    expect(anyLayer()).toBe(0);
    expect(toasts.at(-1).msg).toMatch(/^Vex AI answered, but not with groups Vex can use, so nothing was changed\. The AI returned an empty reply/);
  });

  it('groups the AI invented ids for are dropped, and nothing is proposed or cached as empty', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    pending.resolve({ result: JSON.stringify({ groups: [{ name: 'Ghost', tabIds: ['x1', 'x2'] }], ungrouped: [] }) });
    await flush(); await flush();
    expect(anyLayer()).toBe(0);
    expect(toasts.at(-1).msg).toMatch(/^Vex AI found no tabs that belong together/);
    // asked again at once: a fresh request, not an empty proposal from the 30 s cache
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    expect(AIRouter.callAI).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.group-preview-modal')).toBeNull();
    expect(loadingUp()).toBe(true);
  });

  it('a good answer opens the proposal, which is a dialog; the key pressed again brings it forward instead of stacking', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    pending.resolve({ result: REPLY });
    await flush(); await flush();
    const preview = document.querySelector('.group-preview-modal').closest('.sync-modal-overlay');
    expect(preview.getAttribute('role')).toBe('dialog');
    expect(preview.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('#preview-apply').textContent).toBe('Apply 1 group');
    await mod.TabGrouper.analyzeAndPropose();
    await flush();
    expect(AIRouter.callAI).toHaveBeenCalledTimes(1);
    expect(anyLayer()).toBe(1);
    expect(document.activeElement.id).toBe('preview-apply');
  });

  it('the key pressed while it is already asking does not start a second run behind the first layer', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    await mod.TabGrouper.analyzeAndPropose();
    await flush();
    expect(AIRouter.callAI).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.group-loading-overlay').length).toBe(1);
    esc();
    expect(anyLayer()).toBe(0);
  });

  it('an answer that arrives after Esc is dropped and nothing is left on screen', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    esc();
    expect(toasts.at(-1).msg).toBe('Tab grouping cancelled');
    pending.resolve({ result: REPLY });
    await flush(); await flush();
    expect(anyLayer()).toBe(0);
  });
});

describe('a wait that is not 3-8 seconds', () => {
  it('says the router’s reason for a slow answer, and otherwise that it is still working', async () => {
    vi.useFakeTimers();
    mod.TabGrouper.analyzeAndPropose();
    await vi.advanceTimersByTimeAsync(0);
    const hint = () => document.querySelector('.loading-hint').textContent;
    expect(hint()).toBe('This usually takes a few seconds. Esc cancels.');
    pending.request.onSlow('qwen3.5 is loading…', null);
    expect(hint()).toBe('qwen3.5 is loading…');
    await vi.advanceTimersByTimeAsync(13000);
    expect(hint()).toBe('qwen3.5 is loading…');   // the router's own line stays
    esc();
  });

  it('with nothing from the router it says it is still working after 12 seconds', async () => {
    vi.useFakeTimers();
    mod.TabGrouper.analyzeAndPropose();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(12500);
    expect(document.querySelector('.loading-hint').textContent).toMatch(/^Still working\. A local model can take a minute/);
    esc();
  });

  it('the onSlow callback and the signal stay out of the prompt', async () => {
    mod.TabGrouper.analyzeAndPropose();
    await flush();
    expect(typeof pending.request.onSlow).toBe('function');
    expect(JSON.stringify(pending.request)).not.toMatch(/onSlow|signal/);
    esc();
  });

  it('after three minutes the run ends, is aborted, says why, and the layer is gone', async () => {
    vi.useFakeTimers();
    mod.TabGrouper.analyzeAndPropose();
    await vi.advanceTimersByTimeAsync(0);
    expect(loadingUp()).toBe(true);
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 100);
    expect(anyLayer()).toBe(0);
    expect(pending.request.signal.aborted).toBe(true);
    expect(toasts.at(-1).kind).toBe('error');
    expect(toasts.at(-1).msg).toMatch(/Vex AI did not answer within 3 minutes, so no tabs were grouped\./);
    // the request settling later changes nothing
    pending.reject(new Error('Stopped'));
    await vi.advanceTimersByTimeAsync(10);
    expect(anyLayer()).toBe(0);
    expect(toasts.length).toBe(1);
  });
});
