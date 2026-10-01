// @vitest-environment jsdom
//
// The "page" area of the 2026-09-29 bug sweep: media volume, night mode,
// reading mode, mark up, citations, Escape on panels, the calculator, focus,
// onboarding, the dictionary and plain sentences in Ctrl+K.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
require('../../src/renderer/js/vex-utils.js');
// Night mode and Master Volume run their page scripts through this (site-volume.js).
require('../../src/renderer/js/site-volume.js');

const escape = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.showToast = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); delete globalThis.TabManager; delete globalThis.WebviewManager; });

// A Web Audio stand-in that counts the one call that may only happen once per element.
function fakeAudio() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } });
  const param = () => ({ value: 0 });
  const made = { sources: 0 };
  class Ctx {
    constructor() { this.state = 'running'; this.destination = {}; }
    addEventListener() {}
    resume() { return Promise.resolve(); }
    createMediaElementSource(m) {
      if (m.__routed) { const e = new Error('already connected'); e.name = 'InvalidStateError'; throw e; }
      m.__routed = true; made.sources++; return node();
    }
    createGain() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
  }
  window.AudioContext = Ctx;
  return made;
}
const runInPage = (js) => (0, eval)(js);

describe('Master Volume', () => {
  const { MasterVolume } = require('../../src/renderer/js/master-volume.js');
  beforeEach(() => { delete window.__vexMV; delete window.__vexAudio; delete window.__vexNight; delete window.__vexVolume; delete window.AudioContext; });

  it('opening the panel applies nothing to any page', () => {
    const wv = { executeJavaScript: vi.fn(() => Promise.resolve()) };
    globalThis.WebviewManager = { webviews: new Map([[1, wv]]) };
    MasterVolume.show();
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    MasterVolume.close();
  });

  it('at 100% it leaves the site\'s own volume alone', () => {
    document.body.innerHTML = '<video></video>';
    const v = document.querySelector('video');
    v.volume = 0.3;
    runInPage(MasterVolume._script(1));
    expect(v.volume).toBe(0.3);
  });

  it('turned down and back up, a video gets its per-site figure back', () => {
    document.body.innerHTML = '<video></video>';
    const v = document.querySelector('video');
    window.__vexVolume = 0.4;
    runInPage(MasterVolume._script(0.5));
    expect(v.volume).toBe(0.2);        // half of the 40% the site is kept at, never louder (found 2026-09-29)
    window.__vexMV.set(1);
    expect(v.volume).toBe(0.4);
  });

  it('tick labels sit at their real slider positions', () => {
    MasterVolume.show();
    const at = [...document.querySelectorAll('.mastervol-ticks span')].map(s => s.style.getPropertyValue('--at'));
    expect(at).toEqual(['0', '0.2', '0.5', '1']);
    MasterVolume.close();
  });
});

describe('Night mode and Master Volume share one route per element', () => {
  const { MasterVolume } = require('../../src/renderer/js/master-volume.js');
  const { NightAudio } = require('../../src/renderer/js/night-audio.js');
  beforeEach(() => { delete window.__vexMV; delete window.__vexAudio; delete window.__vexNight; });

  it('boost then night mode routes the element once, and both work', () => {
    const made = fakeAudio();
    document.body.innerHTML = '<video></video>';
    runInPage(MasterVolume._script(2));
    const res = runInPage(NightAudio.script(true));
    expect(res).toMatchObject({ ok: true, touched: 1 });
    expect(made.sources).toBe(1);
  });

  it('night mode first, then boost, does not throw either', () => {
    const made = fakeAudio();
    document.body.innerHTML = '<video></video>';
    expect(runInPage(NightAudio.script(true)).ok).toBe(true);
    runInPage(MasterVolume._script(2));
    expect(made.sources).toBe(1);
    expect(window.__vexAudio.nodes.get(document.querySelector('video')).out.gain.value).toBe(2);
  });

  it('cross-origin media without CORS is left alone and named as such', async () => {
    fakeAudio();
    document.body.innerHTML = '<video src="https://elsewhere.example/film.mp4"></video>';
    const res = runInPage(NightAudio.script(true));
    expect(res).toMatchObject({ ok: false, name: 'CrossOrigin' });
    expect(document.querySelector('video').__routed).toBeUndefined();
    window.vexGuestEval = async () => res;
    await expect(NightAudio.apply({}, true)).rejects.toThrow(/another site that does not allow it/);
  });

  it('a page that routed its own audio is not blamed on another site', async () => {
    window.vexGuestEval = async () => ({ ok: false, name: 'InvalidStateError', error: 'already connected' });
    await expect(NightAudio.apply({}, true)).rejects.toThrow(/its own audio processing/);
  });
});

describe('Reading mode', () => {
  const { ReadingMode } = require('../../src/renderer/js/reading-mode.js');
  beforeEach(() => ReadingMode._originalUrls.clear());

  function tab(html) {
    document.body.innerHTML = html;
    const wv = {
      loaded: [],
      getURL() { return this.loaded[this.loaded.length - 1] || 'https://origin.test/a'; },
      loadURL(u) { this.loaded.push(u); },
      executeJavaScript: (js) => Promise.resolve(runInPage(js)),
    };
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    globalThis.WebviewManager = { getActiveWebview: () => wv, webviews: new Map([['t1', wv]]) };
    return wv;
  }

  it('running it again exits and goes back to the original page', async () => {
    const wv = tab('<article><p>Hello there</p></article>');
    await ReadingMode.activate();
    expect(wv.loaded[0]).toMatch(/^data:text\/html/);
    await ReadingMode.activate();
    expect(wv.loaded).toEqual([wv.loaded[0], 'https://origin.test/a']);
  });

  it('text nested in a picked block is not repeated', async () => {
    const wv = tab('<article><p>Call <code>map()</code> on it</p><ul><li><p>item one</p></li></ul></article>');
    await ReadingMode.activate();
    const html = decodeURIComponent(wv.loaded[0].replace(/^data:text\/html;charset=utf-8,/, ''));
    expect(html.match(/map\(\)/g)).toHaveLength(1);
    expect(html.match(/item one/g)).toHaveLength(1);
  });
});

describe('Mark up and the screenshot preview', () => {
  const { ScreenshotTool } = require('../../src/renderer/js/screenshot.js');

  it('Escape closes the preview', () => {
    ScreenshotTool.showPreview('data:image/png;base64,');
    expect(document.getElementById('screenshot-overlay').classList.contains('visible')).toBe(true);
    escape('Escape');
    expect(document.getElementById('screenshot-overlay').classList.contains('visible')).toBe(false);
  });

  it('Escape closes the editor, and the text tool keeps focus for its prompt', async () => {
    window.vexPrompt = vi.fn(async () => null);
    const wrap = ScreenshotTool.annotate('data:image/png;base64,');
    wrap.querySelector('[data-tool="text"]').click();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    wrap.querySelector('#an-canvas').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(window.vexPrompt).toHaveBeenCalled();
    escape('Escape');
    await Promise.resolve();
    expect(document.getElementById('vex-annotate')).toBeNull();
  });

  it('a very tall capture fits the width and scrolls', () => {
    const ctx = { drawImage() {}, getImageData: () => ({}), putImageData() {} };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    const RealImage = window.Image;
    window.Image = class { set src(v) { this.width = 714; this.height = 16000; this.onload(); } };
    try {
      const wrap = ScreenshotTool.annotate('data:image/png;base64,');
      expect(wrap.querySelector('#an-canvas').style.maxHeight).toBe('none');
      expect(wrap.querySelector('#an-scroll').style.overflow).toBe('auto');
    } finally { window.Image = RealImage; }
  });
});

describe('Citations and file names', () => {
  const { PageExport } = require('../../src/renderer/js/page-export.js');
  const TODAY = new Date(2026, 8, 29);
  const WIKI = { title: 'Array', authors: [{ org: 'Contributors to Wikimedia projects' }], date: '2024-03-03', site: 'Wikimedia Foundation, Inc.', url: 'https://en.wikipedia.org/wiki/Array' };

  it('an organisation author stays whole', () => {
    expect(PageExport.cite(WIKI, 'apa', TODAY)).toMatch(/^Contributors to Wikimedia projects \(2024/);
    expect(PageExport.cite(WIKI, 'mla', TODAY)).toMatch(/^Contributors to Wikimedia projects\. "Array\."/);
  });

  it('a site name ending in a full stop does not get a second', () => {
    expect(PageExport.cite(WIKI, 'apa', TODAY)).toContain('Wikimedia Foundation, Inc. https://');
    expect(PageExport.cite(WIKI, 'chicago', TODAY)).not.toContain('Inc..');
  });

  it('the in-page reader keeps an Organization author as one', () => {
    document.head.innerHTML = '<script type="application/ld+json">{"@type":"Article","author":{"@type":"Organization","name":"Contributors to Wikimedia projects"}}</script>';
    expect(runInPage(PageExport.CITE_SCRIPT).authors).toEqual([{ org: 'Contributors to Wikimedia projects' }]);
    document.head.innerHTML = '';
  });

  it('a PDF tab is not saved as name.pdf.pdf', async () => {
    window.vex = { pageSave: vi.fn(async () => ({ ok: true, path: 'C:/x/dummy.pdf' })) };
    globalThis.WebviewManager = { getActiveWebview: () => ({ getWebContentsId: () => 3 }) };
    globalThis.TabManager = { getActiveTab: () => ({ title: 'dummy.pdf' }) };
    await PageExport.savePage('pdf');
    expect(window.vex.pageSave).toHaveBeenCalledWith(3, 'pdf', 'dummy');
    expect(PageExport._fileName('notes.md', 'md')).toBe('notes.md');
  });
});

describe('Escape closes the panels', () => {
  it('Developer dashboard', () => {
    const { VexDevMode } = require('../../src/renderer/js/dev-mode.js');
    window.escapeHtml = (v) => String(v == null ? '' : v);
    VexDevMode.openDashboard();
    escape('Escape');
    expect(document.getElementById('vex-devdash')).toBeNull();
  });

  it('Send to phone', async () => {
    const { SendToPhone } = require('../../src/renderer/js/send-to-phone.js');
    window.vex = { qrGenerate: async () => '' };
    const open = SendToPhone.open('https://example.com/');
    expect(document.getElementById('vex-sendphone').textContent).not.toContain('\u2715');
    escape('Escape');
    expect(document.getElementById('vex-sendphone')).toBeNull();
    await open;
  });

  it('Why is Vex slow', () => {
    const { WhySlow } = require('../../src/renderer/js/why-slow.js');
    vi.spyOn(WhySlow, 'gather').mockReturnValue(new Promise(() => {}));
    WhySlow.open();
    escape('Escape');
    expect(document.getElementById('vex-whyslow')).toBeNull();
  });

  it('Setup gallery', () => {
    require('../../src/renderer/js/setup-gallery.js');
    window.SetupGallery.open();
    escape('Escape');
    expect(document.getElementById('vex-setupgallery')).toBeNull();
  });

  it('a dialog on top keeps its own Escape', () => {
    require('../../src/renderer/js/setup-gallery.js');
    window.SetupGallery.open();
    document.body.insertAdjacentHTML('beforeend', '<div class="vex-dialog-overlay"></div>');
    escape('Escape');
    expect(document.getElementById('vex-setupgallery')).not.toBeNull();
  });
});

describe('Responsive preview', () => {
  it('opens instead of failing on this.esc', () => {
    const { ResponsivePreview } = require('../../src/renderer/js/devtools-pack.js');
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/' }) };
    expect(() => ResponsivePreview.open()).not.toThrow();
    expect(document.getElementById('vex-responsive')).not.toBeNull();
  });
});

describe('Calculator', () => {
  const { VexCalc } = require('../../src/renderer/js/calc.js');
  afterEach(() => { VexCalc._rates = null; });

  it('three-letter units are units, with or without rates', () => {
    expect(VexCalc.evaluate('5000 lbs to ton').text).toBe('2.267962 ton');
    VexCalc._rates = { EUR: 0.9 };
    expect(VexCalc.evaluate('5000 lbs to ton').text).toBe('2.267962 ton');
    expect(VexCalc.evaluate('10 usd to eur').text).toBe('9 EUR');
  });

  it('copies the value it shows', () => {
    expect(VexCalc.evaluate('0.1+0.2')).toEqual({ text: '= 0.3', value: '0.3' });
  });

  it('kelvin has no degree sign', () => {
    expect(VexCalc.evaluate('32 f to k').text).toBe('273.15 K');
    expect(VexCalc.evaluate('100 c to f').text).toBe('212°F');
  });
});

describe('Focus', () => {
  const { FocusMode } = require('../../src/renderer/js/focus-mode.js');
  afterEach(() => FocusMode.stop());

  it('a different length restarts with that length; the same length ends it and says so', () => {
    FocusMode.toggle(25);
    FocusMode.toggle(50);
    expect(FocusMode.active).toBe(true);
    expect(FocusMode.minutes).toBe(50);
    FocusMode.toggle(50);
    expect(FocusMode.active).toBe(false);
    expect(window.showToast).toHaveBeenLastCalledWith('Focus ended');
  });
});

describe('Onboarding', () => {
  const { Onboarding } = require('../../src/renderer/js/onboarding.js');

  // The step said "Leave blank for none" but refuses a blank answer, on
  // purpose (setupValidation.test.js): Skip is how you choose none. The words
  // now say so (found 2026-09-29).
  it('the name step tells you to press Skip for no name, since a blank is refused', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/onboarding.js'), 'utf8');
    expect(src).not.toMatch(/Leave blank for none/);
    expect(src).toMatch(/Press Skip for none/);
    const overlay = document.createElement('div');
    overlay.innerHTML = '<input id="ob-name" value="">';
    expect(Onboarding._validate('name', overlay)).not.toBeNull();
  });

  it('the language step no longer promises what already exists', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/onboarding.js'), 'utf8');
    expect(src).not.toMatch(/on the roadmap/);
  });
});

describe('Dictionary', () => {
  const { Dictionary } = require('../../src/renderer/js/dictionary.js');
  beforeEach(() => Dictionary._cache.clear());

  it('a capitalised word is looked up in lower case first', async () => {
    window.vex = { dictLookup: vi.fn(async (w) => ({ ok: true, word: w, meanings: [] })) };
    const r = await Dictionary.lookup('Running');
    expect(window.vex.dictLookup).toHaveBeenCalledWith('running');
    expect(r.word).toBe('running');
  });

  it('a name the dictionary has only capitalised still resolves', async () => {
    window.vex = { dictLookup: vi.fn(async (w) => (w === 'Smith' ? { ok: true, word: w, meanings: [] } : { ok: false, notFound: true })) };
    expect((await Dictionary.lookup('Smith')).word).toBe('Smith');
  });
});

describe('Plain sentences in Ctrl+K', () => {
  const { VexQuickReminder } = require('../../src/renderer/js/quick-reminder.js');
  const { VexClock } = require('../../src/renderer/js/clock-panel.js');
  const { VexQuickCommands } = require('../../src/renderer/js/quick-commands.js');
  beforeEach(() => {
    globalThis.VexQuickReminder = VexQuickReminder; globalThis.VexClock = VexClock;
    globalThis.VexSettingsControl = require('../../src/renderer/js/settings-control.js').VexSettingsControl;
    globalThis.GitHubWatch = require('../../src/renderer/js/github-watch.js').GitHubWatch;
  });

  it('"make me a timer for 10 minutes" is a timer', () => {
    expect(VexQuickCommands.results('make me a timer for 10 minutes')[0].id).toBe('quick-timer');
  });

  it('"set an alarm for 7am" is an alarm', () => {
    expect(VexQuickCommands.results('set an alarm for 7am')[0].label).toBe('Alarm 07:00 once');
  });

  it('a length out of range says so', () => {
    expect(VexQuickCommands.results('timer 99999 hours')[0].label).toMatch(/at most 24 hours/);
  });
});

describe('Extracted text', () => {
  const { DocExtract } = require('../../src/renderer/js/doc-extract.js');

  it('says when the copy failed instead of claiming it', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    await DocExtract._showResult('some words', 'OCR');
    expect(document.getElementById('vex-docextract').textContent).toContain('not copied');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Could not copy the text \(denied\)/), 'error');
    expect(document.getElementById('de-close').textContent).not.toContain('\u2715');
  });
});

describe('No text-glyph close buttons', () => {
  it('image zoom and the watches manager use the icon', () => {
    const fs = require('fs'), path = require('path');
    for (const f of ['image-zoom.js', 'web-monitor.js', 'doc-extract.js', 'send-to-phone.js', 'why-slow.js']) {
      expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/js', f), 'utf8')).not.toContain('\u2715');
    }
  });
});
