// @vitest-environment jsdom
//
// T2-081: one plain control over the existing keys (no new key, nothing
// migrated), a conflict shown rather than silently fixed, and the reason for
// the backend that answered.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { AIRouteControl } = require('../../src/renderer/js/ai-route-control.js');

function fakeRouter(state = {}) {
  const s = { preferLocal: false, forceCloud: false, available: true, routing: { chat: 'auto', translate: 'cloud', agent: 'cloud', historySearch: 'local' }, ...state };
  const r = {
    getOllamaStatus: () => ({ preferLocal: s.preferLocal, forceCloud: s.forceCloud, available: s.available }),
    getRoutingPrefs: () => ({ ...s.routing }),
    setPreferLocal: vi.fn((v) => { s.preferLocal = !!v; if (v) s.forceCloud = false; }),
    setForceCloud: vi.fn((v) => { s.forceCloud = !!v; if (v) s.preferLocal = false; }),
    callAI: vi.fn(async (f) => ({ result: 'x', backend: s.answer || 'cloud', model: 'm' })),
  };
  return { r, s };
}

let router;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  const f = fakeRouter();
  router = f; globalThis.AIRouter = f.r;
  delete globalThis.WebLLM;
  AIRouteControl._last = null;
  window.showToast = vi.fn();
});

describe('mode', () => {
  it('reads the three existing flags as Auto, Private local or Fast cloud', () => {
    expect(AIRouteControl.mode()).toBe('auto');
    router.s.preferLocal = true;
    expect(AIRouteControl.mode()).toBe('local');
    router.s.preferLocal = false; router.s.forceCloud = true;
    expect(AIRouteControl.mode()).toBe('cloud');
  });
  it('shows a conflict instead of fixing it', () => {
    router.s.preferLocal = true; router.s.forceCloud = true;
    expect(AIRouteControl.mode()).toBe('conflict');
    expect(AIRouteControl.summary().lines[0]).toMatch(/nothing was changed for you/);
    expect(router.r.setPreferLocal).not.toHaveBeenCalled();
  });
  it('sets only through the existing setters and keeps the radios in step', () => {
    document.body.innerHTML = '<input type="radio" name="ai-mode" value="auto" checked><input type="radio" name="ai-mode" value="cloud">';
    AIRouteControl.setMode('cloud');
    expect(router.r.setForceCloud).toHaveBeenCalledWith(true);
    expect(document.querySelector('input[value="cloud"]').checked).toBe(true);
    AIRouteControl.setMode('local');
    expect(router.s).toMatchObject({ preferLocal: true, forceCloud: false });
    AIRouteControl.setMode('auto');
    expect(router.s).toMatchObject({ preferLocal: false, forceCloud: false });
    expect(() => AIRouteControl.setMode('both')).toThrow(/Auto, Private local or Fast cloud/);
  });
  it('writes no storage key of its own', () => {
    AIRouteControl.setMode('local');
    expect(localStorage.length).toBe(0);
  });
});

describe('summary', () => {
  it('lists only what the person pinned, not the defaults', () => {
    expect(AIRouteControl.pins()).toEqual([]);
    router.s.routing.chat = 'local';
    router.s.routing.historySearch = 'cloud';
    expect(AIRouteControl.pins()).toEqual([{ feature: 'chat', to: 'local' }]);
  });
  it('says that Fast cloud overrides on-device AI', () => {
    globalThis.WebLLM = { preferred: () => true };
    router.s.forceCloud = true;
    expect(AIRouteControl.summary().lines[0]).toMatch(/overrides on-device/);
  });
  it('says when the local model is not running under Private local', () => {
    router.s.preferLocal = true; router.s.available = false;
    expect(AIRouteControl.summary().lines[0]).toMatch(/not right now/);
  });
});

describe('which one answered, and why', () => {
  it('wraps callAI once and records the backend with a reason', async () => {
    expect(AIRouteControl.wrap()).toBe(true);
    expect(AIRouteControl.wrap()).toBe(false);
    const seen = [];
    document.addEventListener('vex:ai-answered', (e) => seen.push(e.detail));
    router.s.forceCloud = true;
    const out = await AIRouter.callAI('chat', {});
    expect(out.backend).toBe('cloud');
    expect(AIRouteControl.lastAnswer()).toMatchObject({ feature: 'chat', backend: 'cloud', reason: 'You chose Fast cloud.' });
    expect(seen).toHaveLength(1);
  });
  it('explains a pinned feature, an on-device answer and a plain Auto', () => {
    expect(AIRouteControl.reasonFor({ mode: 'auto', backend: 'local', pinned: 'local' })).toMatch(/pinned to local/);
    expect(AIRouteControl.reasonFor({ mode: 'auto', backend: 'cloud', pinned: 'local' })).toMatch(/but cloud answered/);
    expect(AIRouteControl.reasonFor({ mode: 'auto', backend: 'ondevice', pinned: 'auto' })).toMatch(/On-device/);
    expect(AIRouteControl.reasonFor({ mode: 'auto', backend: 'cloud', pinned: 'auto' })).toBe('Auto picked it.');
  });
  it('passes the answer through unchanged and an error through untouched', async () => {
    AIRouteControl.wrap();
    router.r.callAI.mockRejectedValueOnce(new Error('boom'));
    // the wrapper holds the ORIGINAL it saw, so a fresh router is needed to test the error path
    const f = fakeRouter(); f.r.callAI = vi.fn(async () => { throw new Error('boom'); }); globalThis.AIRouter = f.r;
    AIRouteControl.wrap();
    await expect(AIRouter.callAI('chat', {})).rejects.toThrow('boom');
    expect(AIRouteControl.lastAnswer()).toBe(null);
  });
});
