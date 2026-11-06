// @vitest-environment jsdom
//
// Skip intro / recap / next episode on streaming sites: the selector table, the scanner (driven here on synthetic pages that
// mimic the buttons' DOM with a fake clock), and the per-site switches. The LIVE sites cannot be tested here: these tests prove
// the matching and clicking logic, not that Netflix, Prime Video or Disney+ still build their buttons this way.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';

const { STREAMING_SKIP, streamingSiteFor, createStreamingSkipper } = require('../../src/site-tweaks.js');
const { createStreamingSkipStore } = require('../../src/main/streaming-skip.js');
const { VexStreamingSkip } = require('../../src/renderer/js/streaming-skip.js');

// A fake clock: timers run only when advanced.
function clock() {
  let t = 0; let id = 0; const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { id++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (i) => timers.delete(i),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      t = end;
    },
    count: () => timers.size,
  };
}

function page(html) {
  document.body.innerHTML = html;
  return document;
}
function make(site, { visible = () => true } = {}) {
  const c = clock();
  const reported = [];
  const skipper = createStreamingSkipper({ doc: document, win: window, site, report: (m) => reported.push(m), isVisible: visible, setTimer: c.setTimer, clearTimer: c.clearTimer, now: c.now });
  return { c, skipper, reported };
}

describe('the selector table', () => {
  it('is versioned and says plainly that it is not verified live', () => {
    expect(STREAMING_SKIP.version).toBeGreaterThanOrEqual(1);
    expect(STREAMING_SKIP.verified).toBe(false);
    expect(STREAMING_SKIP.delayMs).toBeGreaterThanOrEqual(500);
  });
  it('describes the three sites with all four buttons, with valid selectors and patterns', () => {
    expect(Object.keys(STREAMING_SKIP.sites).sort()).toEqual(['disney', 'netflix', 'prime']);
    for (const [id, site] of Object.entries(STREAMING_SKIP.sites)) {
      expect(site.label, id).toBeTruthy();
      expect(() => new RegExp(site.hosts)).not.toThrow();
      expect(site.buttons.map((b) => b.kind), id).toEqual(['intro', 'recap', 'next', 'continue']);
      for (const b of site.buttons) {
        for (const sel of b.css) expect(() => document.querySelector(sel), sel).not.toThrow();
        for (const re of [...(b.text || []), ...(b.guard || [])]) expect(() => new RegExp(re, 'i')).not.toThrow();
        expect(b.css.length + (b.text || []).length, id + ' ' + b.kind).toBeGreaterThan(0);
      }
    }
  });
  it('matches its sites and not look-alike hosts', () => {
    expect(streamingSiteFor('www.netflix.com')).toBe('netflix');
    expect(streamingSiteFor('netflix.com')).toBe('netflix');
    expect(streamingSiteFor('www.primevideo.com', '/detail/x')).toBe('prime');
    expect(streamingSiteFor('www.disneyplus.com')).toBe('disney');
    expect(streamingSiteFor('evilnetflix.com')).toBe('');
    expect(streamingSiteFor('netflix.com.evil.example')).toBe('');
    expect(streamingSiteFor('youtube.com')).toBe('');
  });
  it('treats amazon as a streaming site only on its video pages', () => {
    expect(streamingSiteFor('www.amazon.com', '/gp/video/detail/B0ABC')).toBe('prime');
    expect(streamingSiteFor('www.amazon.com', '/dp/B000123')).toBe('');
    expect(streamingSiteFor('www.amazon.com', '/')).toBe('');
  });
});

describe('the scanner on synthetic pages', () => {
  it('presses Netflix Skip Intro, but only after the delay, and only once', () => {
    page('<video></video><button data-uia="player-skip-intro">Skip Intro</button>');
    const click = vi.fn();
    document.querySelector('button').addEventListener('click', click);
    const { c, skipper, reported } = make('netflix');
    skipper.scan();
    c.advance(STREAMING_SKIP.delayMs - 1);
    expect(click).not.toHaveBeenCalled();
    c.advance(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([{ site: 'netflix', kind: 'intro' }]);
    skipper.scan(); c.advance(STREAMING_SKIP.delayMs * 2);
    expect(click).toHaveBeenCalledTimes(1);   // the button is still there: it is not pressed again within the cooldown
  });

  it('presses each of the four Netflix buttons with its own kind', () => {
    page('<video></video><button data-uia="player-skip-intro">x</button><button data-uia="player-skip-recap">x</button>' +
      '<button data-uia="next-episode-seamless-button">x</button><div data-uia="interrupt-autoplay-continue" role="button">x</div>');
    const { c, skipper, reported } = make('netflix');
    skipper.scan(); c.advance(STREAMING_SKIP.delayMs);
    expect(reported.map((r) => r.kind).sort()).toEqual(['continue', 'intro', 'next', 'recap']);
  });

  it('does nothing when the button goes away before the delay', () => {
    page('<video></video><button data-uia="player-skip-intro">Skip Intro</button>');
    const click = vi.fn();
    document.querySelector('button').addEventListener('click', click);
    const { c, skipper } = make('netflix');
    skipper.scan(); c.advance(300);
    document.querySelector('button').remove();
    skipper.scan(); c.advance(2000);
    expect(click).not.toHaveBeenCalled();
    expect(c.count()).toBe(0);
  });

  it('does nothing when the button is hidden at the moment of the press', () => {
    page('<video></video><button data-uia="player-skip-intro">Skip Intro</button>');
    const click = vi.fn();
    const btn = document.querySelector('button');
    btn.addEventListener('click', click);
    let shown = true;
    const { c, skipper } = make('netflix', { visible: () => shown });
    skipper.scan(); c.advance(300);
    shown = false;
    c.advance(1000);
    expect(click).not.toHaveBeenCalled();
  });

  it('never presses a button that is not in view', () => {
    page('<video></video><button data-uia="player-skip-intro">Skip Intro</button>');
    const click = vi.fn();
    document.querySelector('button').addEventListener('click', click);
    const { c, skipper } = make('netflix', { visible: () => false });
    skipper.scan(); c.advance(5000);
    expect(click).not.toHaveBeenCalled();
  });

  it('does nothing on a page with no video (a browse page with a "Next episode" tile)', () => {
    page('<button>Next episode</button><button data-uia="player-skip-intro">Skip Intro</button>');
    const click = vi.fn();
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', click));
    const { c, skipper } = make('netflix');
    skipper.scan(); c.advance(5000);
    expect(click).not.toHaveBeenCalled();
  });

  it('finds a button by its text when the selector no longer fits (English and Turkish)', () => {
    page('<video></video><div><button class="renamed-by-the-site">  Skip   Intro </button></div>');
    const a = make('netflix'); a.skipper.scan(); a.c.advance(STREAMING_SKIP.delayMs);
    expect(a.reported).toEqual([{ site: 'netflix', kind: 'intro' }]);
    page('<video></video><button>Girişi Atla</button><button>Sonraki Bölüm</button>');
    const b = make('netflix'); b.skipper.scan(); b.c.advance(STREAMING_SKIP.delayMs);
    expect(b.reported.map((r) => r.kind).sort()).toEqual(['intro', 'next']);
  });

  it('does not press a button whose text only contains the words', () => {
    page('<video></video><button>Skip intro of the next episode forever and ever and ever</button><button>Go to next episode list</button><button>Skip ad</button>');
    const click = vi.fn();
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', click));
    const { c, skipper } = make('netflix'); skipper.scan(); c.advance(5000);
    expect(click).not.toHaveBeenCalled();
  });

  it('Prime Video: the generic skip class is pressed only if it says intro or recap, never for an ad', () => {
    page('<video></video><button class="atvwebplayersdk-skipelement-button">Skip Ads</button>');
    const a = make('prime'); a.skipper.scan(); a.c.advance(3000);
    expect(a.reported).toEqual([]);
    page('<video></video><button class="atvwebplayersdk-skipelement-button">Skip Recap</button><div class="atvwebplayersdk-nextupcard-button" role="button">Next episode</div>');
    const b = make('prime'); b.skipper.scan(); b.c.advance(STREAMING_SKIP.delayMs);
    expect(b.reported.map((r) => r.kind).sort()).toEqual(['next', 'recap']);
  });

  it('Disney+: finds Skip Intro by its text and "Continue watching"', () => {
    page('<video></video><button>SKIP INTRO</button><button>Continue Watching</button>');
    const { c, skipper, reported } = make('disney'); skipper.scan(); c.advance(STREAMING_SKIP.delayMs);
    expect(reported.map((r) => r.kind).sort()).toEqual(['continue', 'intro']);
  });

  it('presses the same kind again only after the cooldown (a new episode, a new intro)', () => {
    page('<video></video><button data-uia="player-skip-intro">Skip Intro</button>');
    const click = vi.fn();
    document.querySelector('button').addEventListener('click', click);
    const { c, skipper } = make('netflix');
    skipper.scan(); c.advance(STREAMING_SKIP.delayMs);
    expect(click).toHaveBeenCalledTimes(1);
    c.advance(STREAMING_SKIP.cooldownMs);
    skipper.scan(); c.advance(STREAMING_SKIP.delayMs);
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('stop() cancels what is waiting', () => {
    page('<video></video><button data-uia="player-skip-intro">Skip Intro</button>');
    const click = vi.fn();
    document.querySelector('button').addEventListener('click', click);
    const { c, skipper } = make('netflix');
    skipper.scan(); skipper.stop(); c.advance(5000);
    expect(click).not.toHaveBeenCalled();
  });

  it('a bad selector in the table is reported and does not stop the others', () => {
    const table = JSON.parse(JSON.stringify(STREAMING_SKIP));
    table.sites.netflix.buttons[0].css = ['button[[', 'button[data-uia="player-skip-intro"]'];
    page('<video></video><button data-uia="player-skip-intro">Skip Intro</button>');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = clock(); const reported = [];
    const s = createStreamingSkipper({ doc: document, win: window, site: 'netflix', table, report: (m) => reported.push(m), isVisible: () => true, setTimer: c.setTimer, clearTimer: c.clearTimer, now: c.now });
    s.scan(); c.advance(table.delayMs);
    expect(reported).toEqual([{ site: 'netflix', kind: 'intro' }]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('refuses an unknown site', () => {
    expect(() => createStreamingSkipper({ doc: document, site: 'hulu', report() {} })).toThrow(/Unknown streaming site/);
  });
});

describe('the per-site switches', () => {
  const memFs = () => { const files = new Map(); return { files, existsSync: (f) => files.has(f), readFileSync: (f) => files.get(f), writeFileSync: (f, d) => files.set(f, d) }; };
  const mk = (fsx = memFs(), now = () => 1000) => ({ fsx, store: createStreamingSkipStore({ fs: fsx, file: 'x.json', table: STREAMING_SKIP, now }) });

  it('every site is off until it is turned on', () => {
    const { store } = mk();
    expect(store.enabledSites()).toEqual([]);
    expect(store.state().sites.every((s) => s.enabled === false && s.last === null)).toBe(true);
  });
  it('turns one site on and off, and remembers it', () => {
    const { store, fsx } = mk();
    store.set('netflix', true);
    expect(store.enabledSites()).toEqual(['netflix']);
    expect(mk(fsx).store.enabledSites()).toEqual(['netflix']);
    store.set('netflix', false);
    expect(store.enabledSites()).toEqual([]);
  });
  it('refuses an unknown site and a non-boolean', () => {
    const { store } = mk();
    expect(() => store.set('hulu', true)).toThrow(/Unknown/);
    expect(() => store.set('netflix', 'yes')).toThrow(/on or off/);
  });
  it('records the last matched button only for a site that is on', () => {
    const { store } = mk();
    expect(store.recordMatch('netflix', 'intro')).toBe(false);
    store.set('netflix', true);
    expect(store.recordMatch('netflix', 'intro')).toBe(true);
    expect(store.state().sites.find((s) => s.id === 'netflix').last).toEqual({ kind: 'intro', at: 1000 });
    expect(() => store.recordMatch('netflix', 'rm-rf')).toThrow(/Unknown button/);
    expect(() => store.recordMatch('hulu', 'intro')).toThrow(/Unknown/);
  });
  it('a damaged file leaves every site off, and says so', () => {
    const fsx = memFs(); fsx.files.set('x.json', '{not json');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(mk(fsx).store.enabledSites()).toEqual([]);
    expect(err).toHaveBeenCalled(); err.mockRestore();
  });
  it('a failed save is an error, not a silent success', () => {
    const fsx = memFs(); fsx.writeFileSync = () => { throw new Error('disk full'); };
    expect(() => mk(fsx).store.set('netflix', true)).toThrow(/Could not save/);
  });
});

describe('the settings dialog text', () => {
  it('says what a site did last, or that it has not matched', () => {
    expect(VexStreamingSkip.describeSite({ enabled: false, last: null }, 0)).toBe('Off');
    expect(VexStreamingSkip.describeSite({ enabled: true, last: null }, 0)).toMatch(/Not matched yet/);
    expect(VexStreamingSkip.describeSite({ enabled: true, last: { kind: 'intro', at: 0 } }, 5 * 60000)).toBe('Last matched: Skip intro, 5 minutes ago');
  });
  it('the report names the table version and that it is unverified', () => {
    const text = VexStreamingSkip.reportText({ version: 1, updated: '2026-11-06', verified: false, sites: [{ label: 'Netflix', enabled: true, last: null }] }, 0);
    expect(text).toMatch(/version 1/);
    expect(text).toMatch(/NOT verified/);
    expect(text).toMatch(/Netflix: on, never matched/);
  });
});

describe('the wiring', () => {
  const read = (f) => fs.readFileSync(f, 'utf8');
  it('main answers the preload with the sites that are on, none for private tabs, and checks the page that reports a press', () => {
    const main = read('src/main.js');
    expect(main).toMatch(/streamingSkip: _passkeys\.whyRefused\(e\.sender\) \? \[\] : _streamSkip\.enabledSites\(\)/);
    expect(main).toMatch(/streamingSiteFor\(url\.hostname, url\.pathname\) !== site/);
  });
  it('nothing is on by default: the preload does nothing unless main lists the site', () => {
    const src = read('src/site-tweaks.js');
    expect(src).toMatch(/Array\.isArray\(options\.streamingSkip\) && options\.streamingSkip\.includes\(site\)/);
  });
});
