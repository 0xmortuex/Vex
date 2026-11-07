// @vitest-environment jsdom
//
// js/sound-policy.js: "one sound at a time" and "quiet during calls". Both OFF by default; the call tab is never paused;
// exempt sources are outside both rules; resume plays only what the rule paused; the log answers "why did that stop?".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { VexSoundPolicy: P } = require('../../src/renderer/js/sound-policy.js');

const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 12; i++) await Promise.resolve(); };

let tabs, pages, panels;
function media(o = {}) { return { paused: false, ended: false, play: vi.fn(function () { this.paused = false; return Promise.resolve(); }), pause() { this.paused = true; }, ...o }; }

function addTab(id, o = {}) {
  const wv = document.createElement('webview');
  wv.isCurrentlyAudible = () => !!o.audible;
  wv.isAudioMuted = () => !!o.muted;
  document.body.appendChild(wv);
  const t = { id, title: o.title || 'Tab ' + id, url: o.url || 'https://site' + id + '.example/x', audible: !!o.audible, muted: !!o.muted, sleeping: !!o.sleeping, capturing: o.mic ? { mic: true } : undefined };
  tabs.push(t);
  if (!o.sleeping) WebviewManager.webviews.set(id, wv);
  pages.set(wv, o.media || [media()]);
  return { t, wv };
}
function addPanel(name, o = {}) {
  const wv = document.createElement('webview');
  wv.isCurrentlyAudible = () => !!o.audible;
  wv.isAudioMuted = () => false;
  wv.getURL = () => o.url || 'https://panel.example/';
  document.body.appendChild(wv);
  SidebarManager.panelWebviews[name] = wv;
  pages.set(wv, o.media || [media()]);
  return wv;
}
function started(wv) { document.dispatchEvent(Object.assign(new Event('media-started-playing'), {})); wv.dispatchEvent(new Event('media-started-playing')); }
function stopped(wv) { wv.dispatchEvent(new Event('media-paused')); }
const cap = (where, id, active) => document.dispatchEvent(new CustomEvent('vex:media-capture', { detail: { where, id, kind: 'mic', active } }));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '';
  tabs = []; pages = new Map();
  globalThis.TabManager = { tabs };
  globalThis.WebviewManager = { webviews: new Map() };
  globalThis.SidebarManager = { panelWebviews: {}, panelCapture: {}, panelLabel: (n) => n.toUpperCase() };
  window.vexGuestEvalFrames = vi.fn(async (wv, code) => {
    const list = pages.get(wv) || [];
    const v = new Function('document', 'window', 'return ' + code)({ querySelectorAll: () => list }, {});
    return { all: true, results: [{ ok: true, value: v }] };
  });
  window.showToast = vi.fn();
  window.VexPlural = { s: (n) => (n === 1 ? '' : 's') };
  globalThis.VexPlural = window.VexPlural;
  window.VexUndo = { offer: vi.fn(() => ({})) };
  window.VexLedger = { note: vi.fn(), registerStop: vi.fn() };
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true };
  P._log = []; P._held = new Map(); P._calls = new Set(); P._ignore = new Map();
  P.wire();   // nothing attached while both rules are off
});
afterEach(() => {
  localStorage.clear(); P.wire(); vi.useRealTimers();
  delete globalThis.TabManager; delete globalThis.WebviewManager; delete globalThis.SidebarManager;
});

describe('defaults and the pure parts', () => {
  it('both rules are off, nothing is exempt, and nothing is listening', () => {
    const p = P.prefs();
    expect(p).toMatchObject({ oneAtATime: false, pauseOnCalls: false, resume: false, resumeAfterCall: true, exempt: [] });
    expect(P.enabled()).toBe(false);
    expect(P._wired).toBe(false);
  });
  it('listens only while a rule is on, and stops when both are off', () => {
    P.setPref('oneAtATime', true); expect(P._wired).toBe(true);
    P.setPref('oneAtATime', false); expect(P._wired).toBe(false);
  });
  it('a damaged setting leaves the rules off', () => {
    localStorage.setItem(P.PREF, '{nope');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(P.prefs().oneAtATime).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('rejects bad exempt entries and unknown settings', () => {
    expect(() => P.setPref('exempt', ['tab:5'])).toThrow();
    expect(() => P.setPref('bogus', true)).toThrow(/Unknown/);
    localStorage.setItem(P.PREF, JSON.stringify({ exempt: ['panel:spotify', 'tab:9', 5, 'host:a.com'] }));
    expect(P.prefs().exempt).toEqual(['panel:spotify', 'host:a.com']);
  });
  it('exempt matches a panel by name and a site with its subdomains', () => {
    const ex = ['panel:spotify', 'host:youtube.com'];
    expect(P.isExempt({ kind: 'panel', id: 'spotify' }, ex)).toBe(true);
    expect(P.isExempt({ kind: 'tab', id: 'spotify', host: '' }, ex)).toBe(false);
    expect(P.isExempt({ kind: 'tab', id: 1, host: 'music.youtube.com' }, ex)).toBe(true);
    expect(P.isExempt({ kind: 'tab', id: 1, host: 'notyoutube.com' }, ex)).toBe(false);
  });
  it('decide never picks the trigger, a silent source, a microphone user or an exempt one', () => {
    const src = (key, o = {}) => ({ key, kind: 'tab', id: key, host: key + '.com', audible: true, capturingMic: false, ...o });
    const t = src('a');
    const got = P.decide({ trigger: t, exempt: ['host:e.com'], sources: [t, src('b'), src('c', { audible: false }), src('d', { capturingMic: true }), src('e'), src('f', { kind: 'panel' })] });
    expect(got.map(s => s.key)).toEqual(['b', 'f']);
    expect(P.decide({ trigger: null, sources: [src('b')] })).toEqual([]);
  });
  it('the resume script plays only elements the pause script flagged, and the page scripts never open anything', () => {
    const a = media(), b = media();
    const doc = { querySelectorAll: () => [a, b] };
    const run = (code) => new Function('document', 'window', 'return ' + code)(doc, {});
    expect(run(P.pauseScript())).toBe(2);
    b.__vexSP = undefined; delete b.__vexSP;               // somebody else's element
    b.paused = true;
    expect(run(P.resumeScript())).toBe(1);
    expect(a.play).toHaveBeenCalledTimes(1);
    expect(b.play).not.toHaveBeenCalled();
    expect(run(P.resumeScript())).toBe(0);                  // flags are cleared: no second play
  });
});

describe('one sound at a time', () => {
  beforeEach(() => { P.setPref('oneAtATime', true); });

  it('pauses the other playing tab when one starts, with an Undo, and logs why', async () => {
    const a = addTab(1, { audible: true, title: 'Lecture' });
    const b = addTab(2, { audible: false, title: 'Song' });
    started(b.wv); b.t.audible = true;
    await flush();
    expect(pages.get(a.wv)[0].paused).toBe(true);
    expect(pages.get(b.wv)[0].paused).toBe(false);
    expect(window.VexUndo.offer).toHaveBeenCalledTimes(1);
    expect(window.VexUndo.offer.mock.calls[0][0].message).toBe('Paused 1 other player');
    expect(P.events()[0]).toMatchObject({ kind: 'one-at-a-time', what: 'Paused Lecture', why: 'Song started playing' });
    expect(P.explain('Lecture')).toBe('Paused Lecture: Song started playing.');
    expect(window.VexLedger.note).toHaveBeenCalledTimes(1);
  });

  it('Undo plays exactly what was paused', async () => {
    const a = addTab(1, { audible: true });
    const b = addTab(2);
    started(b.wv);
    await flush();
    expect(pages.get(a.wv)[0].paused).toBe(true);
    a.t.audible = false;
    window.VexUndo.offer.mock.calls[0][0].undo();
    await flush();
    expect(pages.get(a.wv)[0].play).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the rule is off', async () => {
    P.setPref('oneAtATime', false);
    const a = addTab(1, { audible: true });
    const b = addTab(2);
    started(b.wv);
    await flush();
    expect(pages.get(a.wv)[0].paused).toBe(false);
  });

  it('leaves exempt sources alone both ways (a music panel can keep playing)', async () => {
    P.setPref('exempt', ['panel:spotify']);
    const music = addPanel('spotify', { audible: true });
    const a = addTab(1, { audible: true });
    const b = addTab(2);
    started(b.wv);
    await flush();
    expect(pages.get(music)[0].paused).toBe(false);          // never paused
    expect(pages.get(a.wv)[0].paused).toBe(true);
    // and it never pauses anything itself
    pages.get(a.wv)[0].paused = false; P._ignore.clear();
    started(music);
    await flush();
    expect(pages.get(a.wv)[0].paused).toBe(false);
  });

  it('does not pause a tab that is using the microphone (a call)', async () => {
    const call = addTab(1, { audible: true, mic: true, title: 'Meet' });
    const b = addTab(2);
    started(b.wv);
    await flush();
    expect(pages.get(call.wv)[0].paused).toBe(false);
  });

  it('a muted tab starting does not pause others, and a sleeping tab is never reached', async () => {
    const a = addTab(1, { audible: true });
    const sl = addTab(3, { audible: true, sleeping: true });
    const m = addTab(2, { muted: true });
    started(m.wv);
    await flush();
    expect(pages.get(a.wv)[0].paused).toBe(false);
    expect(window.vexGuestEvalFrames.mock.calls.some(c => c[0] === sl.wv)).toBe(false);
  });

  it('a tab we just paused cannot pause the one that took over (no ping-pong)', async () => {
    const a = addTab(1, { audible: true });
    const b = addTab(2);
    started(b.wv); b.t.audible = true;
    await flush();
    started(a.wv);                                           // its own late "started" event, inside the cooldown
    await flush();
    expect(pages.get(b.wv)[0].paused).toBe(false);
  });

  it('resume afterwards: plays them again once the one that took over has stayed stopped', async () => {
    P.setPref('resume', true);
    const a = addTab(1, { audible: true });
    const b = addTab(2);
    started(b.wv); b.t.audible = true;
    await flush();
    a.t.audible = false;
    b.t.audible = false; stopped(b.wv);
    await flush(P.RESUME_DELAY_MS + 100);
    expect(pages.get(a.wv)[0].play).toHaveBeenCalledTimes(1);
    expect(P.events()[0]).toMatchObject({ kind: 'resume' });
  });

  it('without resume afterwards, nothing is played again', async () => {
    const a = addTab(1, { audible: true });
    const b = addTab(2);
    started(b.wv); b.t.audible = true;
    await flush();
    a.t.audible = false; b.t.audible = false; stopped(b.wv);
    await flush(P.RESUME_DELAY_MS + 100);
    expect(pages.get(a.wv)[0].play).not.toHaveBeenCalled();
  });

  it('does not resume what the person started again by hand', async () => {
    P.setPref('resume', true);
    const a = addTab(1, { audible: true });
    const b = addTab(2);
    started(b.wv); b.t.audible = true;
    await flush();
    P._ignore.clear();
    a.t.audible = true; started(a.wv);                       // they pressed play on the paused tab
    await flush();
    pages.get(a.wv)[0].play.mockClear();
    b.t.audible = false; stopped(b.wv);
    await flush(P.RESUME_DELAY_MS + 100);
    expect(pages.get(a.wv)[0].play).not.toHaveBeenCalled();
  });

  it('a private tab is paused but never named, in the ledger or the log', async () => {
    window.VexTabPolicy.canReadWebview = (wv) => wv.dataset.priv !== '1';
    const a = addTab(1, { audible: true, title: 'Secret page' });
    a.wv.dataset.priv = '1';
    const b = addTab(2, { title: 'Song' });
    started(b.wv);
    await flush();
    expect(pages.get(a.wv)[0].paused).toBe(true);
    expect(JSON.stringify(P.events())).not.toContain('Secret page');
    expect(window.VexLedger.note).not.toHaveBeenCalled();
  });
});

describe('quiet during calls', () => {
  beforeEach(() => { P.setPref('pauseOnCalls', true); });

  it('pauses the other media when a tab starts using the microphone, never the call tab', async () => {
    const song = addTab(1, { audible: true, title: 'Song' });
    const call = addTab(2, { audible: true, title: 'Discord' });
    call.t.capturing = { mic: true };
    cap('tab', 2, true);
    await flush();
    expect(pages.get(song.wv)[0].paused).toBe(true);
    expect(pages.get(call.wv)[0].paused).toBe(false);
    expect(window.VexUndo.offer.mock.calls[0][0].message).toBe('Paused 1 player for the call');
    expect(P.events()[0]).toMatchObject({ kind: 'call', what: 'Paused Song', why: 'Discord started using the microphone' });
  });

  it('plays them again when the call ends, but not what was already stopped by hand', async () => {
    const song = addTab(1, { audible: true });
    const other = addTab(3, { audible: true });
    const call = addTab(2, { audible: true });
    call.t.capturing = { mic: true };
    cap('tab', 2, true);
    await flush();
    other.t.audible = false;
    // a hand-start of the song during the call takes it off the waiting list
    P._ignore.clear(); song.t.audible = true;
    P.setPref('oneAtATime', true);
    started(song.wv);
    await flush();
    pages.get(song.wv)[0].play.mockClear(); pages.get(other.wv)[0].play.mockClear();
    P.setPref('oneAtATime', false);
    call.t.capturing = { mic: false };
    cap('tab', 2, false);
    await flush();
    expect(pages.get(other.wv)[0].play).toHaveBeenCalledTimes(1);
    expect(pages.get(song.wv)[0].play).not.toHaveBeenCalled();
  });

  it('a call in a panel (Discord panel) works the same, and exempt sources are left alone', async () => {
    P.setPref('exempt', ['host:keepplaying.example']);
    const keep = addTab(5, { audible: true, url: 'https://keepplaying.example/a' });
    const song = addTab(1, { audible: true });
    const discord = addPanel('discord', { audible: true });
    SidebarManager.panelCapture.discord = { mic: true };
    cap('panel', 'discord', true);
    await flush();
    expect(pages.get(song.wv)[0].paused).toBe(true);
    expect(pages.get(keep.wv)[0].paused).toBe(false);
    expect(pages.get(discord)[0].paused).toBe(false);
  });

  it('closing the call tab ends the call', async () => {
    const song = addTab(1, { audible: true });
    const call = addTab(2, { audible: true });
    call.t.capturing = { mic: true };
    cap('tab', 2, true);
    await flush();
    song.t.audible = false;
    tabs.splice(tabs.indexOf(call.t), 1); WebviewManager.webviews.delete(2);
    document.dispatchEvent(new CustomEvent('vex:tab-closed', { detail: { tabId: 2 } }));
    await flush();
    expect(pages.get(song.wv)[0].play).toHaveBeenCalledTimes(1);
  });

  it('with the call rule off, a microphone does nothing', async () => {
    P.setPref('pauseOnCalls', false);
    P.setPref('oneAtATime', true);
    const song = addTab(1, { audible: true });
    addTab(2, { audible: true });
    cap('tab', 2, true);
    await flush();
    expect(pages.get(song.wv)[0].paused).toBe(false);
  });

  it('camera and screen use are not calls', async () => {
    const song = addTab(1, { audible: true });
    addTab(2);
    document.dispatchEvent(new CustomEvent('vex:media-capture', { detail: { where: 'tab', id: 2, kind: 'camera', active: true } }));
    await flush();
    expect(pages.get(song.wv)[0].paused).toBe(false);
  });
});

describe('wiring', () => {
  it('is loaded after start-up, registered, and reachable from Ctrl+K', () => {
    const fs = require('fs'), path = require('path');
    const rd = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/' + f), 'utf8');
    expect(rd('lazy-boot.js')).toContain("js/sound-policy.js");
    expect(rd('command.js')).toMatch(/id: 'sound-policy'/);
    expect(rd('command.js')).toMatch(/id: 'sound-why'/);
    expect(rd('feature-catalog.js')).toMatch(/id: 'sound-policy'/);
  });
});
