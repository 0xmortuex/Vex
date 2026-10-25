// The shared catch for documents Vex shows with a page of its own (src/main/doc-viewers.js).
// It must take over ONLY a main-frame, successful GET of a document in a Vex window, and nothing else.

import { describe, it, expect, vi } from 'vitest';

const { createDocViewers, headerValue } = require('../../src/main/doc-viewers');

function wc(id = 7, over = {}) {
  return { id, isDestroyed: () => false, getType: () => 'webview', getURL: () => over.url || '', ...over };
}
function details(over = {}) {
  return {
    resourceType: 'mainFrame', method: 'GET', statusCode: 200, url: 'https://example.test/a/pic.png',
    responseHeaders: { 'Content-Type': ['image/png'] }, webContents: wc(), ...over,
  };
}
function make(opts = {}) {
  const docs = createDocViewers({ owner: opts.owner || (() => ({})) });
  docs.register({ id: 'img', isEnabled: opts.isEnabled, match: (_u, type) => /^image\//i.test(type), page: (u, f) => 'vex-img://view/?u=' + encodeURIComponent(u) + (f ? '#' + f : '') });
  return docs;
}
const run = (docs, d) => { const cb = vi.fn(); const took = docs.take(d, cb); return { took, cb }; };

describe('registering a viewer', () => {
  it('needs an id, match() and page(), and refuses a second one with the same id', () => {
    const docs = createDocViewers({ owner: () => ({}) });
    expect(() => docs.register({ id: 'x' })).toThrow(/match\(\) and page\(\)/);
    docs.register({ id: 'x', match: () => false, page: () => '' });
    expect(() => docs.register({ id: 'x', match: () => false, page: () => '' })).toThrow(/already registered/);
  });
  it('createDocViewers needs owner()', () => { expect(() => createDocViewers({})).toThrow(/owner/); });
});

describe('what is taken over', () => {
  it('a main-frame 200 whose Content-Type is an image becomes a 302 to the viewer page', () => {
    const { took, cb } = run(make(), details());
    expect(took).toBe(true);
    const answer = cb.mock.calls[0][0];
    expect(answer.statusLine).toMatch(/302/);
    expect(answer.responseHeaders.location[0]).toBe('vex-img://view/?u=' + encodeURIComponent('https://example.test/a/pic.png'));
  });
  it('goes by the Content-Type, not the file name', () => {
    expect(run(make(), details({ url: 'https://example.test/noext/photo' })).took).toBe(true);
    expect(run(make(), details({ responseHeaders: { 'content-type': 'text/html' } })).took).toBe(false);
  });
  it('keeps a #fragment the tab was going to', () => {
    const d = details({ webContents: wc(7, { url: 'https://example.test/a/pic.png#frag' }) });
    const { cb } = run(make(), d);
    expect(cb.mock.calls[0][0].responseHeaders.location[0]).toMatch(/#frag$/);
  });
});

describe('what is never taken over', () => {
  for (const [name, over] of [
    ['an <img> or a script (not a main frame)', { resourceType: 'image' }],
    ['a sub-frame', { resourceType: 'subFrame' }],
    ['a POST', { method: 'POST' }],
    ['a 404', { statusCode: 404 }],
    ['a redirect', { statusCode: 302 }],
    ['a data: address', { url: 'data:image/png;base64,AAAA' }],
    ['a blob: address', { url: 'blob:https://example.test/1234' }],
    ['a file: address', { url: 'file:///C:/a.png' }],
    ['a download (attachment)', { responseHeaders: { 'Content-Type': ['image/png'], 'Content-Disposition': ['attachment; filename="a.png"'] } }],
  ]) {
    it(name, () => { const { took, cb } = run(make(), details(over)); expect(took).toBe(false); expect(cb).not.toHaveBeenCalled(); });
  }
  it('a page that is not a Vex window page', () => {
    expect(run(make({ owner: () => null }), details()).took).toBe(false);
    expect(run(make(), details({ webContents: wc(7, { getType: () => 'window' }) })).took).toBe(false);
    expect(run(make(), details({ webContents: null })).took).toBe(false);
  });
  it('a viewer that is switched off', () => { expect(run(make({ isEnabled: () => false }), details()).took).toBe(false); });
});

describe('open in the browser\'s own view', () => {
  it('lets exactly one navigation of that tab and address through', () => {
    const docs = make();
    docs.allowOnce(7, 'https://example.test/a/pic.png#x');
    expect(run(docs, details()).took).toBe(false);
    expect(run(docs, details()).took).toBe(true);
  });
  it('is only for that tab', () => {
    const docs = make();
    docs.allowOnce(8, 'https://example.test/a/pic.png');
    expect(run(docs, details()).took).toBe(true);
  });
  it('runs out after a while', () => {
    vi.useFakeTimers();
    try {
      const docs = make();
      docs.allowOnce(7, 'https://example.test/a/pic.png');
      vi.advanceTimersByTime(21000);
      expect(run(docs, details()).took).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('serving the viewer\'s own scheme', () => {
  it('wires each viewer once per session', () => {
    const docs = createDocViewers({ owner: () => ({}) });
    const wire = vi.fn();
    docs.register({ id: 'a', match: () => false, page: () => '', wire });
    const ses = {};
    docs.wireSession(ses, 'persist:main');
    docs.wireSession(ses, 'persist:main');
    expect(wire).toHaveBeenCalledTimes(1);
    docs.wireSession({}, 'x');
    expect(wire).toHaveBeenCalledTimes(2);
  });
});

describe('headerValue', () => {
  it('reads a header whatever its case and whether it is a list', () => {
    expect(headerValue({ 'CONTENT-TYPE': ['image/png'] }, 'content-type')).toBe('image/png');
    expect(headerValue({ 'content-type': 'image/gif' }, 'Content-Type')).toBe('image/gif');
    expect(headerValue(null, 'x')).toBe('');
  });
});
