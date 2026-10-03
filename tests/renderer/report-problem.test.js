// @vitest-environment jsdom
//
// Report a problem: a GitHub issue filled in with versions, look and Vex's own
// problem and crash lists. What matters most is what must NOT leave the
// machine — query strings, the Windows user name, emails, tokens — and that
// the link stays under the length GitHub and Vex's open-external accept.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let VexReport;
beforeEach(async () => {
  vi.resetModules();
  ({ VexReport } = await import('../../src/renderer/js/report-problem.js?' + Math.random()));
});

const INFO = { version: '2.35.2', electron: '42.11.0', chrome: '148.0.7778.0', os: '10.0.26200', arch: 'x64', style: 'firefox', colors: 'theme', theme: 'solarized' };

describe('scrubbing', () => {
  it('takes the query string and fragment off every address, keeping the site and path', () => {
    const out = VexReport.scrub('page crashed https://mail.example.com/inbox/42?user=bob&sid=abc#access_token=xyz — oom');
    expect(out).toBe('page crashed https://mail.example.com/inbox/42?[query removed] — oom');
    expect(VexReport.scrub('vex://settings#privacy')).toBe('vex://settings#[removed]');
  });

  it('replaces the Windows user folder in every spelling, including a name with a space', () => {
    expect(VexReport.scrub('C:\\Users\\Jane Doe\\AppData\\Roaming\\Vex\\crash-log.json'))
      .toBe('%USERPROFILE%\\AppData\\Roaming\\Vex\\crash-log.json');
    expect(VexReport.scrub('file:///C:/Users/fadi/Downloads/a.pdf')).toBe('file:///%USERPROFILE%/Downloads/a.pdf');
    expect(VexReport.scrub('\\\\?\\c:\\users\\bob\\x')).toBe('\\\\?\\%USERPROFILE%\\x');
    // A web path that merely says "users" is not a Windows folder.
    expect(VexReport.scrub('GET https://api.github.com/users/octocat failed')).toBe('GET https://api.github.com/users/octocat failed');
  });

  it('removes emails and anything shaped like a token, but not ordinary words or versions', () => {
    expect(VexReport.scrub('sync failed for someone@example.org')).toBe('sync failed for [email removed]');
    expect(VexReport.scrub('auth ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 refused')).toBe('auth [token removed] refused');
    expect(VexReport.scrub('Authorization: Bearer abc.def-123456789')).toBe('Authorization: Bearer [removed]');
    expect(VexReport.scrub('password=hunter22 apikey=xyz123')).toBe('password=[removed] apikey=[removed]');
    expect(VexReport.scrub('{"token":"s3cr3t-value"}')).toBe('{"token":"[removed]"}');
    expect(VexReport.scrub('id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')).toBe('id [token removed]');
    expect(VexReport.scrub('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'))
      .toBe('[token removed]');
    const plain = 'Vex 2.35.2 · Electron 42.11.0 — the session could not be restored: helper process gone';
    expect(VexReport.scrub(plain)).toBe(plain);
  });
});

describe('the report', () => {
  it('names the versions, Windows build, look and theme, and the log oldest first', () => {
    const d = {
      startedAt: 2000,
      crashHistory: [{ at: 1000, kind: 'page crashed', detail: 'https://x.test/a?b=c — oom', version: '2.35.1' }, { at: 2500, kind: 'page hung', detail: 'now' }],
      events: [{ at: 2500, kind: 'page hung', detail: 'now' }],
    };
    const problems = [{ at: 3000, area: 'Sync', message: 'could not reach C:\\Users\\bob\\x', detail: 'ENOENT', n: 2 }];
    const lines = VexReport.logLines(d, problems);
    expect(lines).toHaveLength(3);                     // the in-launch crash is listed once, as an event
    expect(lines[0]).toMatch(/crash log — page crashed/);
    expect(lines[2]).toMatch(/problem — Sync: could not reach/);
    const { title, body, left } = VexReport.build(INFO, lines);
    expect(title).toBe('Problem in Vex 2.35.2');
    expect(left).toBe(0);
    expect(body).toContain('- Vex: 2.35.2');
    expect(body).toContain('- Electron: 42.11.0 · Chromium: 148.0.7778.0');
    expect(body).toContain('- Windows: 10.0.26200 (x64)');
    expect(body).toContain('- Look: firefox (theme colours) · Theme: solarized');
    expect(body).toContain('https://x.test/a?[query removed]');
    expect(body).toContain('%USERPROFILE%\\x');
    expect(body).not.toContain('bob');
  });

  it('keeps only the last lines, and drops the oldest until the link fits, saying how many went', () => {
    const many = Array.from({ length: 40 }, (_, i) => `line ${i} ` + 'x'.repeat(10));
    const r = VexReport.build(INFO, many);
    expect(r.left).toBe(40 - VexReport.LOG_LINES);
    expect(r.body).toContain('line 39');
    expect(r.body).not.toContain('line 14 ');

    const huge = Array.from({ length: 25 }, (_, i) => `entry ${i} ` + 'é'.repeat(300));
    const h = VexReport.build(INFO, huge);
    expect(VexReport.issueUrl(h.title, h.body).length).toBeLessThanOrEqual(VexReport.MAX_URL);
    expect(h.left).toBeGreaterThan(0);
    expect(h.body).toMatch(/older lines? left out to fit GitHub's link length/);
    expect(h.body).toContain('entry 24');            // the newest survive
  });

  it('cuts an over-long edited text and says so, without breaking an escape', () => {
    const body = 'ü'.repeat(5000);
    const f = VexReport.fitText('t', body);
    expect(f.cut).toBe(true);
    expect(f.body).toMatch(/Shortened to fit GitHub's link length/);
    const url = VexReport.issueUrl('t', f.body);
    expect(url.length).toBeLessThanOrEqual(VexReport.MAX_URL);
    expect(() => decodeURIComponent(url.split('&body=')[1])).not.toThrow();
    expect(VexReport.fitText('t', 'short').cut).toBe(false);
  });

  it('reads an edited title from the first line', () => {
    expect(VexReport.splitTitle('Title: Tabs vanish\n\nbody', 'x')).toEqual({ title: 'Tabs vanish', body: 'body' });
    expect(VexReport.splitTitle('no title line', 'Fallback')).toEqual({ title: 'Fallback', body: 'no title line' });
  });

  it('points at the repository\'s new-issue page with the title and body encoded', () => {
    const url = VexReport.issueUrl('A & B', 'line 1\nline 2');
    expect(url).toBe('https://github.com/0xmortuex/Vex/issues/new?title=A%20%26%20B&body=line%201%0Aline%202');
  });
});

describe('opening it', () => {
  it('shows the text first and opens nothing when the preview is cancelled', async () => {
    window.vex = { diagnostics: vi.fn(async () => ({ version: '2.35.2', electron: '42', chrome: '148', os: '10.0.26200', arch: 'x64', events: [] })) };
    window.vexPrompt = vi.fn(async () => null);
    globalThis.TabManager = { createTab: vi.fn() };
    try {
      expect(await VexReport.open()).toBe(false);
      expect(window.vexPrompt).toHaveBeenCalledTimes(1);
      const opts = window.vexPrompt.mock.calls[0][0];
      expect(opts.multiline).toBe(true);
      expect(opts.value).toMatch(/^Title: Problem in Vex 2\.35\.2\n/);
      expect(opts.value).toContain('- Windows: 10.0.26200 (x64)');
      expect(globalThis.TabManager.createTab).not.toHaveBeenCalled();
    } finally { delete globalThis.TabManager; delete window.vex; delete window.vexPrompt; }
  });

  it('opens exactly the edited text, and shows a shortened text again before opening it', async () => {
    window.vex = { diagnostics: vi.fn(async () => ({ version: '2.35.2', events: [] })) };
    const answers = ['Title: Mine\n\n' + 'ü'.repeat(4000), null];
    window.vexPrompt = vi.fn(async (o) => {
      const a = answers.shift();
      return a === null ? o.value : a;                 // second time: accept what is shown
    });
    globalThis.TabManager = { createTab: vi.fn() };
    try {
      expect(await VexReport.open()).toBe(true);
      expect(window.vexPrompt).toHaveBeenCalledTimes(2);
      expect(window.vexPrompt.mock.calls[1][0].message).toMatch(/too long for a GitHub link/);
      const url = globalThis.TabManager.createTab.mock.calls[0][0];
      expect(url.startsWith('https://github.com/0xmortuex/Vex/issues/new?title=Mine&body=')).toBe(true);
      expect(url.length).toBeLessThanOrEqual(VexReport.MAX_URL);
      // What was opened is what was shown the second time.
      const shown = window.vexPrompt.mock.calls[1][0].value;
      expect(decodeURIComponent(url.split('&body=')[1])).toBe(VexReport.splitTitle(shown, '').body);
    } finally { delete globalThis.TabManager; delete window.vex; delete window.vexPrompt; }
  });
});
