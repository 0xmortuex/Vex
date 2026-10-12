// @vitest-environment jsdom
//
// The "What's new" card after an update (src/renderer/js/update-log.js): what
// it lists, when it shows (once per version, until closed; never on a first
// run, in a private window, or when turned off), and that "See everything"
// opens the full notes for every version missed since the last run.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const { parseChangelogList } = require('../../src/main-helpers.js');
const { VexUpdateNotes } = require('../../src/renderer/js/update-log.js');

const CHANGELOG = [
  '# Changelog',
  '',
  '## v3.2.0 (2026-10-08) — Three',
  '',
  '### Privacy and security',
  '- **Links that open programs ask first**, and never from private tabs.',
  '- **"All of Vex through Tor" now covers everything**: every tab.',
  '- A plain point with no lead.',
  '### Extensions',
  '- **Extensions update themselves**: checked every six hours.',
  '- **`.crx` installs are checked** like the store.',
  '- **[Material Icons](https://example.test) work on GitHub.**',
  '- **Six**',
  '- **Seven**',
  '- **Eight**',
  '- **Nine**',
  '',
  '## v3.1.0 (2026-10-05) — Two',
  '',
  '### Fixes',
  '- A question from a page in full screen froze Vex. Now it does not.',
  '- Every page question is listed under Problems.',
  '',
  '## v3.0.1 (2026-10-04) — One and a bit',
  '',
  '- **Web Store installs**: for real.',
  '',
  '## v3.0.0 (2026-10-01) — One',
  '',
  '- **The base release.**',
  '',
].join('\n');
const LIST = parseChangelogList(CHANGELOG);

describe('VexUpdateNotes: what the card lists', () => {
  it('compares versions numerically, with or without the v', () => {
    expect(VexUpdateNotes.cmp('v2.10.0', '2.9.9')).toBe(1);
    expect(VexUpdateNotes.cmp('2.37.0', 'v2.37.0')).toBe(0);
    expect(VexUpdateNotes.cmp('2.36.4', '2.37.0')).toBe(-1);
  });

  it('takes the releases after the last run up to this one', () => {
    expect(VexUpdateNotes.between(LIST, '3.0.0', '3.2.0').map(e => e.version)).toEqual(['v3.2.0', 'v3.1.0', 'v3.0.1']);
    expect(VexUpdateNotes.between(LIST, '3.1.0', '3.2.0').map(e => e.version)).toEqual(['v3.2.0']);
    expect(VexUpdateNotes.between(LIST, '3.2.0', '3.2.0')).toEqual([]);
  });

  it('lists the bold lead of each point, in plain text, without the trailing punctuation', () => {
    const points = VexUpdateNotes.points(LIST[0].body);
    expect(points.slice(0, 5)).toEqual([
      'Links that open programs ask first',
      '"All of Vex through Tor" now covers everything',
      'Extensions update themselves',
      '.crx installs are checked',
      'Material Icons work on GitHub',
    ]);
    expect(points).not.toContain('A plain point with no lead.');
  });

  it('uses the first sentence when a release has no bold leads', () => {
    expect(VexUpdateNotes.points(LIST[1].body)).toEqual([
      'A question from a page in full screen froze Vex',
      'Every page question is listed under Problems',
    ]);
  });

  it('shows at most eight, shared between the missed releases', () => {
    const one = VexUpdateNotes.highlights(VexUpdateNotes.between(LIST, '3.1.0', '3.2.0'));
    expect(one).toHaveLength(1);
    expect(one[0].points).toHaveLength(8);
    expect(one[0].title).toBe('Three');

    const three = VexUpdateNotes.highlights(VexUpdateNotes.between(LIST, '3.0.0', '3.2.0'));
    expect(three.map(g => g.version)).toEqual(['v3.2.0', 'v3.1.0', 'v3.0.1']);
    expect(three.reduce((n, g) => n + g.points.length, 0)).toBe(8);
    expect(three[1].points).toHaveLength(2);
    expect(three[2].points).toEqual(['Web Store installs']);
  });

  it('reads the real CHANGELOG: the newest release has a title and highlights', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8');
    const list = parseChangelogList(md);
    const [g] = VexUpdateNotes.highlights(list.slice(0, 1));
    expect(g.title.length).toBeGreaterThan(0);
    expect(g.points.length).toBeGreaterThan(0);
    expect(g.points.length).toBeLessThanOrEqual(8);
    for (const p of g.points) expect(p).not.toMatch(/\*\*|`/);
  });
});

// ---------------------------------------------------------------------------
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function load({ version = '3.2.0', privateWindow = false } = {}) {
  vi.resetModules();
  window.VexTabPolicy = { isPrivateWindow: privateWindow };
  window.VexProblems = { note: vi.fn() };
  globalThis.VexProblems = window.VexProblems;
  window.vex = {
    getAppVersion: vi.fn(async () => version),
    getReleaseNotes: vi.fn(async () => LIST.find(e => e.version === 'v' + version) || LIST[0]),
    getReleaseList: vi.fn(async () => LIST),
    openExternal: vi.fn(),
  };
  // A fresh run of the script each time, as on a start of Vex.
  const file = require.resolve('../../src/renderer/js/update-log.js');
  delete require.cache[file];
  require(file);
}
const card = () => document.querySelector('.whatsnew-tip');
const modal = () => document.querySelector('.whatsnew-ov');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function start(opts) {
  load(opts);
  await flush();
  vi.advanceTimersByTime(1300);
  await flush();
}

describe('the card after an update', () => {
  it('a first run records the version and shows nothing (the setup wizard welcomes)', async () => {
    await start();
    expect(localStorage.getItem('vex.lastSeenVersion')).toBe('3.2.0');
    expect(localStorage.getItem('vex.whatsNewPending')).toBe(null);
    expect(card()).toBe(null);
  });

  it('after an update it shows the version, the title and the highlights, focused and labelled', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    await start();
    const el = card();
    expect(el).not.toBe(null);
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.querySelector('.whatsnew-tip-kicker').textContent).toBe('Updated to Vex 3.2.0');
    expect(el.querySelector('#whatsnew-tip-title').textContent).toBe('Three');
    expect(el.querySelectorAll('.whatsnew-tip-list li')).toHaveLength(8);
    expect(el.querySelector('.whatsnew-tip-sub')).toBe(null);
    expect(el.querySelector('svg')).not.toBe(null);              // VexIcons, not emoji
    expect(document.activeElement).toBe(el.querySelector('[data-act="all"]'));
    expect(localStorage.getItem('vex.lastSeenVersion')).toBe('3.2.0');
  });

  it('comes back on the next start until it is closed; closed is final for that version', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    await start();
    expect(card()).not.toBe(null);
    document.body.innerHTML = '';                  // Vex closed with the card still up
    await start();
    expect(card()).not.toBe(null);
    card().querySelector('.whatsnew-tip-close').click();
    expect(card()).toBe(null);
    expect(localStorage.getItem('vex.whatsNewPending')).toBe(null);
    await start();
    expect(card()).toBe(null);
  });

  it('Escape closes it and puts the keyboard back where it was', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    const input = document.createElement('input');
    document.body.appendChild(input);
    load();
    await flush();
    vi.advanceTimersByTime(1300);
    await flush();
    // Focus was on the body when the card came, so the card took it.
    card().querySelector('[data-act="all"]').focus();
    card().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card()).toBe(null);
    expect(localStorage.getItem('vex.whatsNewPending')).toBe(null);
  });

  it('does not take the keyboard from something already focused', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await start();
    expect(card()).not.toBe(null);
    expect(document.activeElement).toBe(input);
  });

  it('Escape from the address bar closes it too, unless something else used that Escape', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await start();
    const used = (e) => e.preventDefault();
    input.addEventListener('keydown', used);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(card()).not.toBe(null);                       // a menu or the field took it
    input.removeEventListener('keydown', used);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(card()).toBe(null);
    expect(document.activeElement).toBe(input);
    expect(localStorage.getItem('vex.whatsNewPending')).toBe(null);
  });

  it('covers every missed update, and See everything opens all of them as one page', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.0.0');
    await start();
    const el = card();
    expect(el.querySelector('.whatsnew-tip-sub').textContent).toBe('3 updates since v3.0.0');
    expect([...el.querySelectorAll('.whatsnew-tip-ver')].map(h => h.textContent)).toEqual(['v3.2.0 — Three', 'v3.1.0 — Two', 'v3.0.1 — One and a bit']);
    el.querySelector('[data-act="all"]').click();
    expect(card()).toBe(null);
    expect(localStorage.getItem('vex.whatsNewPending')).toBe(null);
    await flush();
    expect(modal()).not.toBe(null);
    expect(modal().querySelector('.whatsnew-title').textContent).toBe('Everything since v3.0.0 (3 updates)');
    const headings = [...modal().querySelectorAll('.whatsnew-body h3')].map(h => h.textContent);
    expect(headings).toEqual(['v3.2.0 — Three', 'v3.1.0 — Two', 'v3.0.1 — One and a bit']);
    expect(modal().querySelector('.whatsnew-select').value).toBe('0');
    expect(document.activeElement).toBe(modal().querySelector('.whatsnew-btn'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal()).toBe(null);
  });

  it('two updates without closing the card: it widens to cover both', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.0.1');
    await start({ version: '3.1.0' });
    expect(JSON.parse(localStorage.getItem('vex.whatsNewPending'))).toEqual({ from: '3.0.1', to: '3.1.0' });
    document.body.innerHTML = '';
    await start({ version: '3.2.0' });
    expect(JSON.parse(localStorage.getItem('vex.whatsNewPending'))).toEqual({ from: '3.0.1', to: '3.2.0' });
    expect(card().querySelector('.whatsnew-tip-sub').textContent).toBe('2 updates since v3.0.1');
  });

  it('See everything for a single update opens that release', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    await start();
    card().querySelector('[data-act="all"]').click();
    await flush();
    expect(modal().querySelector('.whatsnew-title').textContent).toBe('v3.2.0 — Three');
  });

  it('never in a private window', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    await start({ privateWindow: true });
    expect(card()).toBe(null);
    expect(localStorage.getItem('vex.lastSeenVersion')).toBe('3.1.0');
  });

  it('turned off in Settings: no card, and nothing left waiting', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    load();
    window.VexWhatsNew.setCardEnabled(false);
    expect(localStorage.getItem('vex.whatsNewCard')).toBe('off');
    await flush();
    vi.advanceTimersByTime(1300);
    await flush();
    expect(card()).toBe(null);
    expect(localStorage.getItem('vex.whatsNewPending')).toBe(null);
    window.VexWhatsNew.setCardEnabled(true);
    expect(localStorage.getItem('vex.whatsNewCard')).toBe('on');
    expect(window.VexWhatsNew.cardEnabled()).toBe(true);
  });

  it('turning it off closes a card that is up', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    await start();
    expect(card()).not.toBe(null);
    window.VexWhatsNew.setCardEnabled(false);
    expect(card()).toBe(null);
  });

  it('going back to an older Vex shows nothing', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.2.0');
    await start({ version: '3.1.0' });
    expect(card()).toBe(null);
  });

  it('no notes in the bundled CHANGELOG for the version: says so under Problems, no card', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.2.0');
    await start({ version: '3.3.0' });
    expect(card()).toBe(null);
    expect(window.VexProblems.note).toHaveBeenCalledWith("What's new", expect.stringMatching(/no notes for v3\.3\.0/), expect.any(Error));
    expect(localStorage.getItem('vex.whatsNewPending')).toBe(null);
  });

  it('a release list that cannot be read is said, not swallowed', async () => {
    localStorage.setItem('vex.lastSeenVersion', '3.1.0');
    load();
    window.vex.getReleaseList = vi.fn(async () => { throw new Error('disk gone'); });
    await flush();
    vi.advanceTimersByTime(1300);
    await flush();
    expect(card()).toBe(null);
    expect(window.VexProblems.note).toHaveBeenCalledWith("What's new", expect.stringMatching(/Could not read the release notes/), expect.any(Error));
  });
});
