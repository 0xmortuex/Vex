import { describe, it, expect, vi } from 'vitest';
import { resolveAndReplaceMisspelling } from '../../src/main-helpers.js';

// Bug 2 — clicking a spellcheck suggestion must replace the misspelled word.
// replaceMisspelling lives on Electron `webContents`, not on the <webview>
// tag element, so the renderer routes through IPC into this helper.
//
// `webContents` is injected as a fake module so the helper can be tested
// under plain Node (main-helpers.js stays free of require('electron')).

function fakeWc(id, { url = 'https://example.com/', destroyed = false, replace } = {}) {
  return {
    id,
    isDestroyed: () => destroyed,
    getURL: () => url,
    replaceMisspelling: replace || vi.fn(),
  };
}

function fakeModule({ byId = {}, all = [] } = {}) {
  return {
    fromId: (id) => byId[id] || null,
    getAllWebContents: () => all,
  };
}

describe('resolveAndReplaceMisspelling', () => {
  it('calls replaceMisspelling on the webContents found by id', () => {
    const replace = vi.fn();
    const wc = fakeWc(7, { replace });
    const mod = fakeModule({ byId: { 7: wc } });

    const result = resolveAndReplaceMisspelling(mod, 7, 'features');

    expect(replace).toHaveBeenCalledWith('features');
    expect(result).toEqual({ ok: true, id: 7 });
  });

  it('returns ok:false when no webContents is found', () => {
    const mod = fakeModule({ byId: {}, all: [] });

    const result = resolveAndReplaceMisspelling(mod, 999, 'features');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('webContents not found');
    expect(result.requestedId).toBe(999);
  });

  it('falls back to a URL match when the id is -1 (unattached guest)', () => {
    const replace = vi.fn();
    const wc = fakeWc(3, { url: 'https://openl.io/', replace });
    // id lookup fails (byId empty); URL lookup across all webContents succeeds.
    const mod = fakeModule({ byId: {}, all: [fakeWc(1, { url: 'https://other/' }), wc] });

    const result = resolveAndReplaceMisspelling(mod, -1, 'feedback', 'https://openl.io/');

    expect(replace).toHaveBeenCalledWith('feedback');
    expect(result).toEqual({ ok: true, id: 3 });
  });

  it('ignores a destroyed webContents found by id', () => {
    const wc = fakeWc(7, { destroyed: true });
    const mod = fakeModule({ byId: { 7: wc } });

    const result = resolveAndReplaceMisspelling(mod, 7, 'features');

    expect(result.ok).toBe(false);
    expect(wc.replaceMisspelling).not.toHaveBeenCalled();
  });

  it('rejects an empty or non-string suggestion (would delete the word)', () => {
    expect(resolveAndReplaceMisspelling(fakeModule(), 7, '').ok).toBe(false);
    expect(resolveAndReplaceMisspelling(fakeModule(), 7, null).ok).toBe(false);
    expect(resolveAndReplaceMisspelling(fakeModule(), 7, undefined).ok).toBe(false);
  });

  it('returns ok:false with the error message when replaceMisspelling throws', () => {
    const wc = fakeWc(7, { replace: () => { throw new Error('boom'); } });
    const mod = fakeModule({ byId: { 7: wc } });

    const result = resolveAndReplaceMisspelling(mod, 7, 'features');

    expect(result).toEqual({ ok: false, error: 'boom', id: 7 });
  });

  it('does not attempt a URL match when no fallbackUrl is given', () => {
    const wc = fakeWc(5, { url: 'https://openl.io/' });
    const mod = fakeModule({ byId: {}, all: [wc] });

    const result = resolveAndReplaceMisspelling(mod, -1, 'feedback'); // no URL

    expect(result.ok).toBe(false);
    expect(wc.replaceMisspelling).not.toHaveBeenCalled();
  });
});
