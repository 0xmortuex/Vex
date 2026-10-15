// @vitest-environment jsdom
// js/archive-library.js — when "Open your copy" is offered, and what refuses.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { ArchiveLibrary: A } = require('../../src/renderer/js/archive-library.js');

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  delete window.VexTabPolicy;
  delete window.LinkRot;
  delete window.vex;
  delete globalThis.Recall;
  delete globalThis.WebviewManager;
});

describe('which failures count as "the page is gone"', () => {
  it('offers for a page that cannot be reached and for 404 / 410 / 5xx', () => {
    expect(A.deadKind({ errorCode: -105 })).toBe('unreachable');   // name not resolved
    expect(A.deadKind({ errorCode: -102 })).toBe('unreachable');   // connection refused
    expect(A.deadKind({ httpStatus: 404 })).toBe('gone');
    expect(A.deadKind({ httpStatus: 410 })).toBe('gone');
    expect(A.deadKind({ httpStatus: 503 })).toBe('unreachable');
  });
  it('says nothing for a superseded or blocked load, a certificate problem, a sub-frame or a fine page', () => {
    expect(A.deadKind({ errorCode: -3 })).toBeNull();
    expect(A.deadKind({ errorCode: -20 })).toBeNull();
    expect(A.deadKind({ errorCode: -27 })).toBeNull();
    expect(A.deadKind({ errorCode: -202 })).toBeNull();
    expect(A.deadKind({ isMainFrame: false, errorCode: -105 })).toBeNull();
    expect(A.deadKind({ httpStatus: 200 })).toBeNull();
    expect(A.deadKind({ httpStatus: 403 })).toBeNull();
  });
});

describe('the offer on a dead page', () => {
  const entry = { id: '0123456789abcdef', url: 'https://example.com/guide', title: 'Guide', at: Date.UTC(2026, 8, 1), bytes: 2048 };

  it('offers your copy, with Wayback beside it, only for a page in the library', async () => {
    window.LinkRot = { viewArchived: vi.fn() };
    window.vex = { pageArchiveFind: vi.fn(async (url) => ({ ok: true, entry: url === entry.url ? entry : null })), pageArchiveOpen: vi.fn(async () => ({ ok: true })) };
    expect(await A.offerForDeadPage(entry.url, { errorCode: -105 })).toEqual(entry);
    const [message, , , opts] = window.showToast.mock.calls[0];
    expect(message).toMatch(/will not load/);
    expect(opts.actions.map(a => a.label)).toEqual(['Open your copy', 'Wayback Machine']);
    opts.actions[0].run();
    expect(window.vex.pageArchiveOpen).toHaveBeenCalledWith(entry.id);
    opts.actions[1].run();
    expect(window.LinkRot.viewArchived).toHaveBeenCalledWith(entry.url);

    window.showToast.mockClear();
    expect(await A.offerForDeadPage('https://example.com/never-kept', { errorCode: -105 })).toBeNull();
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('says "gone" for a 404', async () => {
    window.vex = { pageArchiveFind: vi.fn(async () => ({ ok: true, entry })) };
    await A.offerForDeadPage(entry.url, { httpStatus: 404 });
    expect(window.showToast.mock.calls[0][0]).toMatch(/is gone/);
  });

  it('does not even ask the library for a load that is not a dead page', async () => {
    window.vex = { pageArchiveFind: vi.fn() };
    await A.offerForDeadPage(entry.url, { errorCode: -3 });
    await A.offerForDeadPage(entry.url, { httpStatus: 200 });
    expect(window.vex.pageArchiveFind).not.toHaveBeenCalled();
  });

  it('is silent when switched off, in a private window, and for a non-web address', async () => {
    window.vex = { pageArchiveFind: vi.fn(async () => ({ ok: true, entry })) };
    A.setOfferEnabled(false);
    expect(await A.offerForDeadPage(entry.url, { errorCode: -105 })).toBeNull();
    A.setOfferEnabled(true);
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(await A.offerForDeadPage(entry.url, { errorCode: -105 })).toBeNull();
    window.VexTabPolicy = { isPrivateWindow: false };
    expect(await A.offerForDeadPage('file:///C:/x.html', { errorCode: -105 })).toBeNull();
    expect(window.showToast).not.toHaveBeenCalled();
  });
});

describe('archiving the page in front', () => {
  const wv = (url) => ({ getURL: () => url, getWebContentsId: () => 7, executeJavaScript: vi.fn(async () => ({ title: 'T', text: 'words' })) });

  it('refuses a private, Tor or routed tab without reading it', async () => {
    const view = wv('https://example.com/a');
    globalThis.WebviewManager = { getActiveWebview: () => view };
    window.VexTabPolicy = { canReadWebview: () => false };
    window.vex = { pageArchiveSave: vi.fn() };
    await expect(A.archiveActive()).rejects.toThrow(/never archived/);
    expect(view.executeJavaScript).not.toHaveBeenCalled();
    expect(window.vex.pageArchiveSave).not.toHaveBeenCalled();
  });

  it('refuses a site on the Recall exclusion list', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => wv('https://example.com/a') };
    globalThis.Recall = { isExcluded: (u) => u.includes('example.com'), _extractor: () => '1' };
    window.vex = { pageArchiveSave: vi.fn() };
    await expect(A.archiveActive()).rejects.toThrow(/does not remember/);
    expect(window.vex.pageArchiveSave).not.toHaveBeenCalled();
  });

  it('sends the tab and its text, and returns the entry; a refusal from main reaches the caller', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => wv('https://example.com/a') };
    globalThis.Recall = { isExcluded: () => false, _extractor: () => 'extract()' };
    window.vex = { pageArchiveSave: vi.fn(async () => ({ ok: true, entry: { id: 'x', title: 'T', bytes: 10 } })) };
    expect((await A.archiveActive()).id).toBe('x');
    expect(window.vex.pageArchiveSave).toHaveBeenCalledWith(7, { title: 'T', text: 'words' });

    window.vex.pageArchiveSave = vi.fn(async () => ({ ok: false, refused: 'library-full', error: 'The library is full', suggest: [{ id: 'o' }] }));
    const err = await A.archiveActive().catch(e => e);
    expect(err.message).toBe('The library is full');
    expect(err.refused).toBe('library-full');
    expect(err.suggest).toEqual([{ id: 'o' }]);
  });
});
