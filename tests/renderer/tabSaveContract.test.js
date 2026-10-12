// @vitest-environment jsdom
//
// "A background step failed: Error invoking remote method 'storage-save':
// Error: Invalid tab URL" — fifteen times in the owner's problem log, the
// last on 2026-10-03, two seconds after history refused an Xbox sign-in page.
// VexTabPolicy.snapshot screened tabs with a prefix test, /^(https?:|about:|
// file:|vex:)/, while the store checks with VexDataContracts.url: at most
// 8192 characters, no control characters, and it has to parse. A sign-in
// redirect longer than that passed the screen, and one such tab made the
// WHOLE save reject — every tab save, every workspace and named session —
// until it was closed. Every saver goes through snapshot(), so that is where
// it is screened.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dataContracts = require('../../src/renderer/js/data-contracts.js');
const { assertTabs } = require('../../src/main/contracts.js');

let policy;
beforeEach(async () => {
  vi.resetModules();
  window.history.replaceState({}, '', '/');
  window.VexDataContracts = dataContracts;
  await import('../../src/renderer/js/tab-policy.js');
  policy = window.VexTabPolicy;
});

// The shape of the address in the log: a Microsoft sign-in hop carrying its
// whole state in the query, longer than the store takes.
const longSignIn = 'https://login.live.com/ppsecure/post.srf?wa=wsignin1.0&wreply=' + encodeURIComponent('https://www.xbox.com/auth/msa?state=' + 'x'.repeat(9000));
const tab = (id, url, over = {}) => ({ id, url, title: 'Page ' + id, partition: 'persist:main', ...over });

describe('what a tab save sends', () => {
  it('leaves out a tab whose address is longer than the store takes, and saves the rest', () => {
    expect(longSignIn.length).toBeGreaterThan(8192);
    const tabs = [tab('a', 'https://example.org/'), tab('b', longSignIn), tab('c', 'vex://start')];
    const saved = policy.snapshot(tabs);
    expect(saved.map(t => t.id)).toEqual(['a', 'c']);
    // What storage-save checks, in the order ipc-policy runs it.
    expect(() => dataContracts.storage('tabs', saved)).not.toThrow();
    expect(() => assertTabs(saved)).not.toThrow();
  });

  it('leaves out an address that does not parse, or carries a control character', () => {
    const saved = policy.snapshot([tab('a', 'https://exa mple.org/'), tab('b', 'https://example.org/\nx'), tab('c', 'https://example.org/ok')]);
    expect(saved.map(t => t.id)).toEqual(['c']);
    expect(() => dataContracts.storage('tabs', saved)).not.toThrow();
  });

  it('still leaves out the pages that are nobody\'s address: extensions, the PDF viewer, view-source, data:, blob:, errors, DevTools', () => {
    const odd = ['chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', 'view-source:https://example.org/', 'data:text/html,hi',
      'blob:https://example.org/8b1', 'chrome-error://chromewebdata/', 'devtools://devtools/bundled/inspector.html'];
    const saved = policy.snapshot(odd.map((url, i) => tab('t' + i, url)).concat(tab('ok', 'https://example.org/')));
    expect(saved.map(t => t.id)).toEqual(['ok']);
    expect(() => dataContracts.storage('tabs', saved)).not.toThrow();
  });

  it('keeps named sessions and workspaces savable with the same tab in the window', () => {
    const saved = policy.snapshot([tab('a', 'https://example.org/'), tab('b', longSignIn)]);
    expect(() => dataContracts.storage('sessions', [{ id: 's1', name: 'Work', tabs: saved }])).not.toThrow();
    expect(() => dataContracts.storage('workspaces', { workspaces: [{ id: 'w1', name: 'Work', tabs: saved }] })).not.toThrow();
  });

  it('does not restore such a tab from an old save either', () => {
    expect(policy.canRestore(tab('b', longSignIn))).toBe(false);
    expect(policy.canRestore(tab('a', 'https://example.org/'))).toBe(true);
    expect(policy.canRestore(tab('s', 'about:blank'))).toBe(true);
  });
});
