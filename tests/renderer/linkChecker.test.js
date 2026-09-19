// @vitest-environment jsdom
//
// The link checker's sheet: broken first, "moved" split out of "working",
// and never run in a private tab.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/page-export.js');
const { LinkChecker } = require('../../src/renderer/js/link-checker.js');

const LINKS = [
  { url: 'https://a.example/ok', text: 'Fine', index: 0 },
  { url: 'https://a.example/dead', text: 'Old article', index: 1 },
  { url: 'http://b.example/p', text: 'Tidy redirect', index: 2 },
  { url: 'https://c.example/old', text: 'Really moved', index: 3 },
  { url: 'https://d.example/members', text: 'Members', index: 4 },
];
const RESULTS = [
  { url: 'https://a.example/ok', status: 200, verdict: 'ok', redirected: false, finalUrl: 'https://a.example/ok' },
  { url: 'https://a.example/dead', status: 404, verdict: 'broken', redirected: false, finalUrl: 'https://a.example/dead' },
  { url: 'http://b.example/p', status: 200, verdict: 'ok', redirected: true, finalUrl: 'https://www.b.example/p/' },
  { url: 'https://c.example/old', status: 200, verdict: 'ok', redirected: true, finalUrl: 'https://c.example/new-home' },
  { url: 'https://d.example/members', status: 403, verdict: 'blocked', redirected: false, finalUrl: 'https://d.example/members' },
];

let wv;
beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  wv = { getAttribute: () => 'persist:main' };
  globalThis.WebviewManager = { getActiveWebview: () => wv };
  globalThis.TabManager = { createTab: vi.fn() };
  window.VexTabPolicy = { canReadWebview: (w) => w.getAttribute('partition').startsWith('persist:') };
  window.vexGuestEval = vi.fn(async (_wv, code) => (code.includes('data-vex-link="') ? true : LINKS));
  window.vex = { checkLinks: vi.fn(async () => ({ ok: true, results: RESULTS, skipped: 0 })) };
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

describe('sorting the answers', () => {
  it('a real move is "moved"; http→https, www and a slash are the site tidying up', () => {
    expect(LinkChecker.groupOf(RESULTS[3])).toBe('moved');
    expect(LinkChecker.groupOf(RESULTS[2])).toBe('ok');
    expect(LinkChecker.groupOf(RESULTS[1])).toBe('broken');
  });
});

describe('running it', () => {
  it('checks every link and opens on the problems, broken first', async () => {
    await LinkChecker.run();
    expect(window.vex.checkLinks).toHaveBeenCalledWith(LINKS.map(l => l.url));
    const text = document.querySelector('.vex-links-overlay').textContent;
    expect(text).toMatch(/1 broken/);
    expect(text).toContain('Old article');
    expect(text).toContain('Really moved');
    expect(text).toContain('https://c.example/new-home');
    expect(text).toContain('Members');
    expect(text).not.toContain('Fine');                 // working links hidden until "All"
    expect(text.indexOf('Broken')).toBeLessThan(text.indexOf('Moved'));
  });

  it('"All" shows the working ones too', async () => {
    await LinkChecker.run();
    document.querySelector('[data-show="all"]').click();
    expect(document.querySelector('.vex-links-overlay').textContent).toContain('Fine');
  });

  it('"Show on page" outlines that exact link', async () => {
    await LinkChecker.run();
    const deadRow = [...document.querySelectorAll('[data-rows] > div')].find(r => r.textContent.includes('Old article'));
    deadRow.querySelector('[data-find]').click();
    const code = window.vexGuestEval.mock.calls.at(-1)[1];
    expect(code).toContain('[data-vex-link="1"]');
    expect(document.querySelector('.vex-links-overlay')).toBe(null);
  });

  it('copies a plain-text report', async () => {
    await LinkChecker.run();
    document.querySelector('[data-copy]').click();
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const report = navigator.clipboard.writeText.mock.calls[0][0];
    expect(report).toMatch(/Broken \(1\)\n {2}404 {2}https:\/\/a\.example\/dead/);
    expect(report).toContain('https://c.example/old  →  https://c.example/new-home');
    expect(report).toMatch(/2 working$/);
  });

  it('never checks a private tab', async () => {
    wv = { getAttribute: () => 'private-1' };
    await expect(LinkChecker.run()).rejects.toThrow(/private tab are not checked/);
    expect(window.vex.checkLinks).not.toHaveBeenCalled();
  });

  it('says so on a page with no links', async () => {
    window.vexGuestEval = vi.fn(async () => []);
    await expect(LinkChecker.run()).rejects.toThrow(/no links/);
  });

  it('a link text cannot become markup', async () => {
    window.vexGuestEval = vi.fn(async () => [{ url: 'https://a.example/dead', text: '<img src=x onerror=alert(1)>', index: 1 }]);
    window.vex.checkLinks = vi.fn(async () => ({ ok: true, results: [RESULTS[1]], skipped: 0 }));
    await LinkChecker.run();
    expect(document.querySelector('.vex-links-overlay img')).toBe(null);
  });
});
