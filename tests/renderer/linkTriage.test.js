// @vitest-environment jsdom
//
// Link triage at paste time: an offer, never a fetch until it is accepted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { LinkTriage: L } = require('../../src/renderer/js/link-triage.js');

const longText = 'word '.repeat(1100);       // 5 minutes at 220 wpm

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<textarea id="ai-input"></textarea><textarea id="other"></textarea>';
  globalThis.AgentTools = { readUrl: vi.fn().mockResolvedValue({ title: 'How kernels work | example.com', text: longText }), isPrivateHost: (h) => /^(localhost|127\.|10\.)/.test(h) };
  window.showToast = vi.fn();
  L._started = false;
  L._dismiss();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); L._dismiss(); });

describe('what counts as a pasted link', () => {
  it('one bare https address', () => {
    expect(L.extractUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1');
    expect(L.extractUrl('http://example.com/')).toBeNull();
    expect(L.extractUrl('see https://example.com/')).toBeNull();
    expect(L.extractUrl('https://a.test/ https://b.test/')).toBeNull();
    expect(L.extractUrl('https://user:pw@example.com/')).toBeNull();
    expect(L.extractUrl('not a url')).toBeNull();
  });

  it('refuses addresses on this PC or network, onion and http', () => {
    expect(L.mayFetch('https://localhost:8080/').ok).toBe(false);
    expect(L.mayFetch('https://10.0.0.5/').ok).toBe(false);
    expect(L.mayFetch('https://abc.onion/').ok).toBe(false);
    expect(L.mayFetch('http://example.com/').ok).toBe(false);
    expect(L.mayFetch('https://example.com/').ok).toBe(true);
  });
});

describe('the tag', () => {
  it('title, site and minutes, without saying the site twice', () => {
    expect(L.tag({ title: 'How kernels work | example.com', url: 'https://www.example.com/k', minutes: 5 })).toBe('How kernels work · example.com · 5 min read');
    expect(L.tag({ title: '', url: 'https://example.com/', minutes: 0 })).toBe('example.com');
  });

  it('short pages get no reading time', () => {
    expect(L.minutesFor('a few words')).toBe(0);
    expect(L.minutesFor(longText)).toBe(5);
  });

  it('is put straight after the link, once', () => {
    const url = 'https://example.com/k';
    const text = 'before ' + url + ' after';
    const next = L.appendTo(text, url, 'T · example.com · 5 min read');
    expect(next).toBe('before ' + url + ' — T · example.com · 5 min read after');
    expect(L.appendTo(next, url, 'T · example.com · 5 min read')).toBeNull();
    expect(L.appendTo('gone', url, 'T')).toBeNull();
  });
});

describe('the offer', () => {
  const paste = (el, text) => {
    el.value = text;
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { getData: () => text };
    el.dispatchEvent(ev);
    // The capture listener of start() is on the document; call the handler the same way.
    L.onPaste({ target: el, clipboardData: ev.clipboardData });
    vi.runOnlyPendingTimers();
  };

  it('shows a bar for a link pasted in the AI box, and fetches nothing', () => {
    paste(document.getElementById('ai-input'), 'https://example.com/k');
    expect(document.querySelector('.vex-link-triage')).not.toBeNull();
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
  });

  it('shows nothing in other fields, for sentences, for http, or when switched off', () => {
    paste(document.getElementById('other'), 'https://example.com/k');
    expect(document.querySelector('.vex-link-triage')).toBeNull();
    paste(document.getElementById('ai-input'), 'read https://example.com/k please');
    expect(document.querySelector('.vex-link-triage')).toBeNull();
    paste(document.getElementById('ai-input'), 'http://example.com/k');
    expect(document.querySelector('.vex-link-triage')).toBeNull();
    L.setEnabled(false);
    paste(document.getElementById('ai-input'), 'https://example.com/k');
    expect(document.querySelector('.vex-link-triage')).toBeNull();
  });

  it('"No thanks" leaves the text alone', () => {
    const field = document.getElementById('ai-input');
    paste(field, 'https://example.com/k');
    [...document.querySelectorAll('.vex-link-triage button')].find(b => b.textContent === 'No thanks').click();
    expect(document.querySelector('.vex-link-triage')).toBeNull();
    expect(field.value).toBe('https://example.com/k');
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
  });

  it('"Add details" fetches once and appends the tag', async () => {
    vi.useRealTimers();
    const field = document.getElementById('ai-input');
    const url = 'https://example.com/k';
    field.value = url;
    L.offer(field, url);
    [...document.querySelectorAll('.vex-link-triage button')].find(b => b.textContent === 'Add details').click();
    await vi.waitFor(() => expect(field.value).toContain('5 min read'));
    expect(field.value).toBe(url + ' — How kernels work · example.com · 5 min read');
    expect(AgentTools.readUrl).toHaveBeenCalledTimes(1);
    expect(AgentTools.readUrl).toHaveBeenCalledWith(url);
  });

  it('a failed lookup says so and leaves the text', async () => {
    vi.useRealTimers();
    AgentTools.readUrl.mockRejectedValueOnce(new Error('HTTP 404 from example.com'));
    const field = document.getElementById('ai-input');
    const url = 'https://example.com/k';
    field.value = url;
    L.offer(field, url);
    [...document.querySelectorAll('.vex-link-triage button')].find(b => b.textContent === 'Add details').click();
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalled());
    expect(field.value).toBe(url);
  });
});
