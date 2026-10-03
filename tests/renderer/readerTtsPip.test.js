// @vitest-environment jsdom
//
// Reader view, Read Aloud and Picture-in-Picture, as found by using them on
// real-looking pages (2026-10-03):
//  - reader view took <article>/<main>/<body> whole, so a news page came out
//    with its sidebar and a blog with its menu; links were dead text, tables
//    and definition lists were dropped, the title showed twice, Esc did
//    nothing and leaving it reloaded the page at the top;
//  - Read Aloud spoke one 12,000-character utterance, menus and all, could not
//    pause or skip, and kept talking after its tab was closed;
//  - PiP floated the first playing video (a small preview) and never saw a
//    player in a shadow root or an embedded frame.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
const { ReadingMode } = require('../../src/renderer/js/reading-mode.js');
const { ReadAloud, vexTtsPage } = require('../../src/renderer/js/page-extras.js');
const { PiPManager, vexPipFrame } = require('../../src/renderer/js/pip-manager.js');

const runInPage = (js) => (0, eval)(js);
let toasts;
beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.title = '';
  toasts = [];
  window.showToast = (message, type) => toasts.push({ message, type });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); delete globalThis.TabManager; delete globalThis.WebviewManager; });

const LONG = 'The council voted on Tuesday night to approve a long-debated plan for a new bridge across the river, ending years of argument.';

// ---------------------------------------------------------------------------
describe('reader view finds the article', () => {
  const extract = () => runInPage(ReadingMode._extractScript());
  const flat = (r) => JSON.stringify(r);

  it('leaves out the sidebar, menu, comments and share bar around a story', () => {
    document.title = 'Bridge approved | Daily Planet';
    document.body.innerHTML = `
      <nav><a href="/">Home</a><a href="/w">World</a><a href="/s">Sport</a><a href="/t">Tech</a></nav>
      <aside><h3>Trending</h3><ul><li><a href="/a">Celebrity at cafe</a></li></ul></aside>
      <div class="content"><h1>Bridge approved</h1><div class="share"><button>Share</button></div>
        <div class="story-body"><p>${LONG}</p><p>${LONG} Again, with <a href="/schools">a link</a>.</p><p>${LONG}</p></div>
        <section class="comments"><p>Great news, everyone, this is a comment that is long enough.</p></section></div>
      <footer>Copyright</footer>`;
    const a = extract();
    expect(a.title).toBe('Bridge approved');
    const s = flat(a.blocks);
    expect(s).not.toMatch(/Trending|Celebrity|Share|Great news|Copyright|"Home"/);
    expect(s).toContain('"a":"http://localhost:3000/schools"');
  });

  it('keeps tables, code with its line breaks, and definition lists', () => {
    document.body.innerHTML = `<main><h1>map()</h1><p>${LONG}</p><p>${LONG}</p>
      <pre><code>const a = [1, 2];
const b = a.map(x =&gt; x * 2);</code></pre>
      <dl><dt><code>callbackFn</code></dt><dd>A function to execute for each element in the array.</dd></dl>
      <table><caption>Support</caption><tr><th>Browser</th><th>Version</th></tr><tr><td>Chrome</td><td colspan="2">1</td></tr></table></main>`;
    const a = extract();
    const pre = a.blocks.find(b => b.tag === 'PRE');
    expect(pre.text).toBe('const a = [1, 2];\nconst b = a.map(x => x * 2);');
    const dl = a.blocks.find(b => b.tag === 'DL');
    expect(flat(dl)).toContain('A function to execute');
    const table = a.blocks.find(b => b.tag === 'TABLE');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0].h).toBe(true);
    expect(table.rows[1][1].span).toBe(2);
    expect(flat(table.caption)).toContain('Support');
  });

  it('drops a Wikipedia-style contents box and [edit] links but keeps the infobox', () => {
    document.title = 'Honey bee - Wikipedia';
    document.body.innerHTML = `<div id="content"><h1>Honey bee</h1><div class="mw-parser-output">
      <table class="infobox"><tr><th>Kingdom</th><td>Animalia</td></tr></table>
      <p>${LONG}</p><div id="toc" class="toc"><ul><li><a href="#a">1 Etymology</a></li></ul></div>
      <h2><span>Etymology</span><span class="mw-editsection">[<a href="/e">edit</a>]</span></h2><p>${LONG}</p><p>${LONG}</p></div></div>`;
    const a = extract();
    const s = flat(a.blocks);
    expect(a.title).toBe('Honey bee');
    expect(s).toContain('Animalia');
    expect(s).not.toContain('1 Etymology');
    expect(s).not.toContain('edit');
  });

  it('takes the article title from the page title when there is no h1', () => {
    document.title = 'Why I switched to a mechanical keyboard - Sam\'s Blog';
    document.body.innerHTML = `<div class="entry"><p>${LONG}</p><p>${LONG}</p></div>`;
    expect(extract().title).toBe('Why I switched to a mechanical keyboard');
  });

  it('reports how far down the page you were', () => {
    document.body.innerHTML = `<article><p>${LONG}</p></article>`;
    window.scrollY = 0;
    expect(extract().scrollY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('the reader document', () => {
  const colors = { bg: '#fff', text: '#111', muted: '#555', link: '#00f', code: '#eee', border: '#ccc', accent: '#00f', dark: false };
  const build = (blocks, prefs, extra) => ReadingMode.buildHtml({ title: 'T', blocks, ...(extra || {}) }, 'https://site.test/a', prefs, colors);

  it('rebuilds links, only http(s) and mailto, attribute-escaped', () => {
    const html = build([{ tag: 'P', runs: [
      { a: 'https://x.test/?q="><script>', c: [{ t: 'ok' }] },
      { a: 'javascript:alert(1)', c: [{ t: 'bad' }] },
      { a: 'mailto:a@b.test', c: [{ t: 'mail' }] },
    ] }]);
    expect(html).toContain('<a href="https://x.test/?q=&quot;&gt;&lt;script&gt;">ok</a>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('bad');
    expect(html).toContain('<a href="mailto:a@b.test">mail</a>');
  });

  it('draws the title once, with the reading time', () => {
    const words = Array.from({ length: 460 }, () => 'word').join(' ');
    const html = build([{ tag: 'H2', runs: [{ t: 'T' }] }, { tag: 'P', runs: [{ t: words }] }]);
    expect(html.match(/>T<\/h[12]>/g)).toHaveLength(1);
    expect(html).toContain('2 min read');
    expect(html).toContain('460 words');
  });

  it('opens with the saved settings, and cleans what it is given', () => {
    const html = build([{ tag: 'P', runs: [{ t: 'x' }] }], { theme: 'sepia', font: 'mono', size: 99, width: 'nope' });
    expect(html).toContain('data-theme="sepia"');
    expect(html).toContain('"size":32');
    expect(html).toContain('"width":"medium"');
    expect(html).toContain('"font":"mono"');
  });

  it('carries the Vex theme colours only when they are plain colours', () => {
    const html = ReadingMode.buildHtml({ title: 'T', blocks: [{ tag: 'P', runs: [{ t: 'x' }] }] }, 'https://s.test/', null,
      { ...colors, bg: '#123456' });
    expect(html).toContain('--vr-bg:#123456');
    document.body.style.setProperty('--vex-bg-base', 'red;}body{display:none');
    expect(ReadingMode._vexColors().bg).toBe('#fdfcf9');
  });

  it('has an Exit button, Esc to leave, and labelled controls', () => {
    const html = build([{ tag: 'P', runs: [{ t: 'x' }] }]);
    expect(html).toContain('id="vr-exit"');
    expect(html).toContain("e.key==='Escape'");
    expect(html).toMatch(/<label for="vr-font">Font<select id="vr-font">/);
    expect(html).toContain('aria-label="Bigger text"');
    expect(html).toContain('role="toolbar"');
  });
});

// ---------------------------------------------------------------------------
describe('reader page commands and leaving reader view', () => {
  beforeEach(() => { ReadingMode._originalUrls.clear(); ReadingMode._scroll.clear(); });

  it('keeps the reader settings the page sends, cleaned', () => {
    expect(ReadingMode.onReaderCommand('t1', { type: 'reader-prefs', prefs: { theme: 'dark', size: '22', font: '<b>' } })).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.readerPrefs'))).toEqual({ font: 'serif', size: 22, width: 'medium', spacing: 'normal', theme: 'dark' });
  });

  it('ignores commands it does not know', () => {
    expect(ReadingMode.onReaderCommand('t1', { type: 'navigate', url: 'file:///c:/' })).toBe(false);
    expect(ReadingMode.onReaderCommand('t1', null)).toBe(false);
  });

  it('Listen reads the reader page of that tab', () => {
    const wv = {};
    globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
    const spy = vi.spyOn(ReadAloud, 'toggle').mockResolvedValue(true);
    expect(ReadingMode.onReaderCommand('t1', { type: 'reader-listen' })).toBe(true);
    expect(spy).toHaveBeenCalledWith({ wv, tabId: 't1' });
  });

  function readerTab() {
    const listeners = {};
    const wv = {
      loaded: [], back: 0, scripts: [],
      getURL: () => 'data:text/html;charset=utf-8,x',
      canGoBack: () => true,
      goBack() { this.back++; },
      loadURL(u) { this.loaded.push(u); },
      executeJavaScript(js) { this.scripts.push(js); return Promise.resolve(600); },
      addEventListener: (n, f) => { listeners[n] = f; },
      removeEventListener: (n) => { delete listeners[n]; },
    };
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
    ReadingMode._originalUrls.set('t1', 'https://site.test/a');
    ReadingMode._scroll.set('t1', { url: 'https://site.test/a', y: 600 });
    return { wv, listeners };
  }

  it('goes Back to the page instead of loading a second copy of it, and puts the scroll back', async () => {
    vi.useFakeTimers();
    const { wv, listeners } = readerTab();
    expect(ReadingMode.exitReadingMode('t1')).toBe(true);
    expect(wv.back).toBe(1);
    expect(wv.loaded).toEqual([]);
    listeners['did-navigate']({ url: 'https://site.test/a' });
    await vi.advanceTimersByTimeAsync(200);
    expect(wv.scripts[0]).toContain('window.scrollTo(0,y)');
    expect(wv.scripts[0]).toContain('var y=600');
  });

  it('loads the page when Back landed somewhere else', () => {
    const { wv, listeners } = readerTab();
    ReadingMode.exitReadingMode('t1');
    listeners['did-navigate']({ url: 'https://elsewhere.test/' });
    expect(wv.loaded).toEqual(['https://site.test/a']);
  });
});

// ---------------------------------------------------------------------------
describe('Read Aloud', () => {
  let spoken, synth;

  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  beforeEach(() => {
    spoken = [];
    synth = {
      speaking: false,
      speak: vi.fn((u) => { spoken.push(u); }),
      cancel: vi.fn(),
      getVoices: () => [{ name: 'Zira', lang: 'en-US', localService: true, default: true }, { name: 'Hortense', lang: 'fr-FR', localService: true }],
      addEventListener() {}, removeEventListener() {},
    };
    globalThis.speechSynthesis = synth;
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    ReadAloud._s = null;
    ReadAloud.volume = 0;
  });
  afterEach(() => { ReadAloud.stop(true); delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance; });

  function page(html) {
    document.body.innerHTML = html;
    const listeners = {};
    const wv = {
      dataset: { tabId: 't1' },
      getURL: () => 'https://site.test/story',
      executeJavaScript: (js) => Promise.resolve(runInPage(js)),
      addEventListener: (n, f) => { listeners[n] = f; },
      removeEventListener: (n) => { delete listeners[n]; },
    };
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    globalThis.WebviewManager = { getActiveWebview: () => wv, webviews: new Map([['t1', wv]]) };
    return { wv, listeners };
  }
  const article = `<nav><a href="/">Home</a><a href="/b">Blog</a><a href="/c">Contact</a><a href="/d">Shop</a></nav>
    <article><h1>The flood</h1><p>First sentence here. Second sentence here.</p><p>Third one. Fourth one.</p><p>Fifth.</p></article>`;

  it('speaks the article one sentence at a time, without the menu', async () => {
    page(article);
    expect(await ReadAloud.start()).toBe(true);
    expect(ReadAloud._s.segs.map(s => s.text)).toEqual(['The flood', 'First sentence here.', 'Second sentence here.', 'Third one.', 'Fourth one.', 'Fifth.']);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('The flood');
    expect(spoken[0].volume).toBe(0);
    spoken[0].onend();
    expect(spoken[1].text).toBe('First sentence here.');
    expect(document.querySelector('#vex-tts-bar .vex-tts-pos').textContent).toBe('Paragraph 1 of 3');
  });

  it('cuts a very long sentence so no utterance runs past what every voice will say', async () => {
    const words = Array.from({ length: 120 }, (_, i) => 'word' + i).join(' ');
    page(`<article><p>${words}, and then the end.</p></article>`);
    await ReadAloud.start();
    expect(ReadAloud._s.segs.length).toBeGreaterThan(1);
    for (const s of ReadAloud._s.segs) expect(s.text.length).toBeLessThanOrEqual(220);
    expect(ReadAloud._s.segs.map(s => s.text).join(' ')).toContain('word119');
  });

  it('pauses, and picks up at the same sentence', async () => {
    page(article);
    await ReadAloud.start();
    spoken[0].onend();
    ReadAloud.pause();
    expect(synth.cancel).toHaveBeenCalled();
    spoken[1].onerror({ error: 'interrupted' });     // what cancel() causes: ignored
    expect(spoken).toHaveLength(2);
    ReadAloud.resume();
    expect(spoken[2].text).toBe('First sentence here.');
  });

  it('skips forward and back by paragraph', async () => {
    page(article);
    await ReadAloud.start();
    spoken[0].onend();                               // now on "First sentence here."
    ReadAloud.nextParagraph();
    expect(spoken.at(-1).text).toBe('Third one.');
    ReadAloud._jump(4);                              // "Fourth one."
    ReadAloud.previousParagraph();
    expect(spoken.at(-1).text).toBe('Third one.');     // start of this paragraph
    ReadAloud.previousParagraph();
    expect(spoken.at(-1).text).toBe('First sentence here.');
  });

  it('stops when its tab closes or goes to another page', async () => {
    const { listeners } = page(article);
    await ReadAloud.start();
    document.dispatchEvent(new CustomEvent('vex:tab-closed', { detail: { tabId: 't1' } }));
    expect(ReadAloud._s).toBe(null);
    expect(document.getElementById('vex-tts-bar')).toBe(null);

    await ReadAloud.start();
    listeners['did-navigate']({ url: 'https://site.test/other' });
    expect(ReadAloud._s).toBe(null);
    expect(toasts.at(-1).message).toMatch(/page changed/);
  });

  it('a second press of the command stops it', async () => {
    page(article);
    await ReadAloud.toggle();
    expect(ReadAloud._s).not.toBe(null);
    await ReadAloud.toggle();
    expect(ReadAloud._s).toBe(null);
  });

  it('reads the selection when there is one', async () => {
    page(article);
    const p = document.querySelectorAll('article p')[1];
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    await ReadAloud.start({ selection: true });
    expect(ReadAloud._s.mode).toBe('selection');
    expect(ReadAloud._s.segs.map(s => s.text)).toEqual(['Third one.', 'Fourth one.']);
  });

  it('moves on when a voice never reports the end of a sentence', async () => {
    vi.useFakeTimers();
    page(article);
    await ReadAloud.start();
    expect(spoken).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(spoken.length).toBeGreaterThan(1);
  });

  it('remembers speed and a voice per language, and uses a voice that fits the page', async () => {
    page(article);
    document.documentElement.setAttribute('lang', 'fr');
    await ReadAloud.start();
    expect(spoken[0].voice.name).toBe('Hortense');
    ReadAloud.setRate(1.5);
    expect(spoken.at(-1).rate).toBe(1.5);
    ReadAloud.setVoice('Zira');
    expect(JSON.parse(localStorage.getItem('vex.readAloud')).voices).toEqual({ en: 'Zira' });
    expect(() => ReadAloud.setVoice('Nobody')).toThrow(/not installed/);
    document.documentElement.removeAttribute('lang');
  });

  it('page side: highlight and clear do not throw where the highlight API is missing', () => {
    document.body.innerHTML = article;
    const info = vexTtsPage(null, 'article');
    expect(info.segs.length).toBeGreaterThan(0);
    // jsdom has no Range.getBoundingClientRect: mark reports false, never throws.
    expect(typeof window.__vexTTS.mark(1)).toBe('boolean');
    expect(() => window.__vexTTS.clear()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('Picture-in-Picture picks the main video', () => {
  function video(id, { w, h, playing, disabled, inShadow }) {
    const v = document.createElement('video');
    v.id = id;
    v.src = 'https://cdn.test/' + id + '.mp4';
    Object.defineProperty(v, 'paused', { value: !playing });
    Object.defineProperty(v, 'ended', { value: false });
    Object.defineProperty(v, 'readyState', { value: 4 });
    Object.defineProperty(v, 'currentTime', { value: playing ? 3 : 0 });
    v.getBoundingClientRect = () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h });
    if (disabled) v.setAttribute('disablepictureinpicture', '');
    v.disablePictureInPicture = !!disabled;
    v.requestPictureInPicture = vi.fn(() => Promise.resolve({}));
    if (inShadow) {
      const host = document.createElement('x-player');
      document.body.appendChild(host);
      host.attachShadow({ mode: 'open' }).appendChild(v);
    } else document.body.appendChild(v);
    return v;
  }

  it('prefers the large playing player in a shadow root over a small preview', () => {
    video('small', { w: 160, h: 90, playing: true });
    video('big', { w: 720, h: 405, playing: true, inShadow: true });
    video('paused', { w: 1000, h: 600, playing: false });
    const r = vexPipFrame('scan');
    expect(r.count).toBe(3);
    expect(window.__vexPipPick.el.id).toBe('big');
    expect(r.best.playing).toBe(true);
  });

  it('only the frame holding the pick acts, and a disabled video needs the user to say so', async () => {
    const v = video('big', { w: 720, h: 405, playing: true, disabled: true });
    const r = vexPipFrame('scan');
    expect(r.best.disabled).toBe(true);
    expect(vexPipFrame('enter', 'someone-else')).toEqual({ mine: false });
    expect(vexPipFrame('enter', r.best.token, false)).toEqual({ mine: true, error: 'disabled' });
    expect(await vexPipFrame('enter', r.best.token, true)).toEqual({ mine: true, ok: true });
    expect(v.hasAttribute('disablepictureinpicture')).toBe(false);
    expect(v.requestPictureInPicture).toHaveBeenCalled();
  });
});

describe('Picture-in-Picture from Vex', () => {
  let calls, frames;
  const wv = { send: vi.fn(), getWebContentsId: () => 7, isConnected: true };
  beforeEach(() => {
    calls = [];
    frames = { scan: [], enter: [] };
    document.body.innerHTML = '<button id="pip-btn" style="display:none"></button><input type="checkbox" id="setting-auto-pip">';
    window.vex = {
      evalAllFrames: vi.fn(async (id, code) => {
        if (id !== 7) return { ok: true, results: [] };   // tab b has no video
        const mode = /^\(function vexPipFrame[\s\S]*\)\("(\w+)"/.exec(code)[1];
        calls.push(mode);
        return { ok: true, results: (frames[mode] || []).map(value => ({ ok: true, value })) };
      }),
      openPipWindow: vi.fn(async () => ({ ok: true, mode: 'video' })),
      isPipOpen: vi.fn(async () => false),
      onPipClosed: () => {},
    };
    window.vexConfirm = vi.fn(async () => true);
    globalThis.TabManager = { activeTabId: 'a', tabs: [{ id: 'a', url: 'https://v.test/' }, { id: 'b', url: 'https://o.test/' }], getActiveTab() { return this.tabs.find(t => t.id === this.activeTabId); }, switchTab() {} };
    globalThis.WebviewManager = { getActiveWebview: () => wv, webviews: new Map([['a', wv], ['b', { ...wv, getWebContentsId: () => 8 }]]) };
    PiPManager._autoTabs.clear();
    PiPManager._lastActive = 'a';
    PiPManager.init();
  });
  const best = (o) => ({ token: 'tk', score: 1, playing: true, disabled: false, enabled: true, media: null, ...o });

  it('floats the best video across frames', async () => {
    frames.scan = [{ inPip: false, best: best({ score: 5, token: 'small' }) }, { inPip: false, best: best({ score: 9, token: 'frame' }) }];
    frames.enter = [{ mine: false }, { mine: true, ok: true }];
    expect(await PiPManager.toggle()).toBe('entered');
    expect(window.vex.evalAllFrames.mock.calls[1][1]).toContain('"frame"');
    expect(window.vex.evalAllFrames.mock.calls[1][2]).toBe(true);    // as a user gesture
  });

  it('a second press brings it back', async () => {
    frames.scan = [{ inPip: true, best: null }];
    expect(await PiPManager.toggle()).toBe('exited');
    expect(calls).toEqual(['scan', 'exit']);
  });

  it('asks before overriding a site that turned PiP off, and respects no', async () => {
    frames.scan = [{ inPip: false, best: best({ disabled: true }) }];
    window.vexConfirm = vi.fn(async () => false);
    expect(await PiPManager.toggle()).toBe('declined');
    expect(calls).toEqual(['scan']);
    window.vexConfirm = vi.fn(async () => true);
    frames.enter = [{ mine: true, ok: true }];
    expect(await PiPManager.toggle()).toBe('entered');
    expect(window.vex.evalAllFrames.mock.calls.at(-1)[1]).toMatch(/,true\)$/);
  });

  it('uses the pop-out where the frame may not float a video', async () => {
    frames.scan = [{ inPip: false, best: best({ enabled: false, media: { src: 'https://cdn.test/a.mp4' } }) }];
    expect(await PiPManager.toggle()).toBe('popout');
    expect(window.vex.openPipWindow).toHaveBeenCalledWith('https://v.test/', { src: 'https://cdn.test/a.mp4' });
  });

  it('says so when there is no video', async () => {
    frames.scan = [{ inPip: false, best: null }];
    expect(await PiPManager.toggle()).toBe('none');
    expect(toasts.at(-1).message).toMatch(/no video/i);
  });

  it('floats on tab switch only when turned on, and puts the video back on return', async () => {
    frames.scan = [{ inPip: false, best: best() }];
    frames.enter = [{ mine: true, ok: true }];
    TabManager.activeTabId = 'b';
    PiPManager._tabsChanged();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual([]);                        // off by default

    const box = document.getElementById('setting-auto-pip');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.autoPip')).toBe('on');
    TabManager.activeTabId = 'a'; PiPManager._tabsChanged();
    TabManager.activeTabId = 'b'; PiPManager._tabsChanged();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual(['scan', 'enter']);
    expect(PiPManager._autoTabs.has('a')).toBe(true);

    calls.length = 0;
    frames.scan = [{ inPip: true, best: null }];
    TabManager.activeTabId = 'a'; PiPManager._tabsChanged();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual(['scan', 'exit']);
  });

  it('does not float a paused video on tab switch', async () => {
    PiPManager.setAutoEnabled(true);
    frames.scan = [{ inPip: false, best: best({ playing: false }) }];
    TabManager.activeTabId = 'b'; PiPManager._tabsChanged();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual(['scan']);
  });

  it('shows the button for a video playing in an embedded frame', () => {
    wv.tagName = 'WEBVIEW';
    const ev = new Event('media-started-playing');
    Object.defineProperty(ev, 'target', { value: wv });
    PiPManager._onMedia(ev);
    expect(document.getElementById('pip-btn').style.display).toBe('flex');
    delete wv._vexMediaPlaying;
  });
});
