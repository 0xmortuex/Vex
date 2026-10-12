// Audit B3 (2026-10-10): "Leave site?" never appeared: will-prevent-unload was
// always cancelled, so typed text was lost on a reload or a link. Now a page
// the user clicked or typed in (Chromium only raises the event then) is asked
// about in Vex's own dialog, and "Leave" does again what was held up
// (src/main/leave-page.js). Closing a tab or window never asks.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { createLeaveGuard, createLeaveQuestions, INTENT_MS, ALLOW_MS, CHECK_MS } = require('../../src/main/leave-page.js');

let nextId = 1;
function page() {
  const c = new EventEmitter();
  c.id = nextId++;
  c.destroyed = false;
  c.isDestroyed = () => c.destroyed;
  c.loads = [];
  c.loadURL = vi.fn(async (u) => { c.loads.push(u); });
  c.reload = vi.fn();
  c.reloadIgnoringCache = vi.fn();
  c.navigationHistory = { goBack: vi.fn(), goForward: vi.fn(), goToIndex: vi.fn(), goToOffset: vi.fn() };
  c.send = vi.fn();
  c.getURL = () => 'https://docs.example/edit';
  return c;
}
const unloadEvent = () => ({ preventDefault: vi.fn() });
const flush = () => new Promise(r => setTimeout(r, 0));

function harness({ answer = true, closing = false } = {}) {
  let t = 1000;
  const timers = [];
  const ask = vi.fn(async () => answer);
  const tellAgain = vi.fn();
  const guard = createLeaveGuard({ ask, isClosing: () => closing, tellAgain, now: () => t, setTimer: (fn, ms) => timers.push({ fn, ms }) });
  return { guard, ask, tellAgain, timers, advance: (ms) => { t += ms; }, runTimers: () => timers.splice(0).forEach(x => x.fn()) };
}

describe('a page that asks before it is left', () => {
  it('is asked about; the page stays until the answer', async () => {
    const { guard, ask } = harness();
    const c = page(); guard.watch(c);
    const e = unloadEvent();
    expect(guard.onWillPreventUnload(e, c)).toBe('ask');
    expect(e.preventDefault).not.toHaveBeenCalled();     // the unload is held up
    await flush();
    expect(ask).toHaveBeenCalledWith(c);
  });

  it('"Leave" does again the navigation Vex started, and lets that one through', async () => {
    const { guard } = harness({ answer: true });
    const c = page(); guard.watch(c);
    c.loadURL('https://elsewhere.example/');               // the address bar, through the <webview>
    guard.onWillPreventUnload(unloadEvent(), c);
    await flush(); await flush();
    expect(c.loads).toEqual(['https://elsewhere.example/', 'https://elsewhere.example/']);
    const again = unloadEvent();
    expect(guard.onWillPreventUnload(again, c)).toBe('allow');
    expect(again.preventDefault).toHaveBeenCalled();
    // Only once: the page's next guard asks again.
    expect(guard.onWillPreventUnload(unloadEvent(), c)).toBe('ask');
  });

  it('Back, Forward and Reload are done again too', async () => {
    for (const [name, call] of [['goBack', c => c.navigationHistory.goBack()], ['goForward', c => c.navigationHistory.goForward()], ['reload', c => c.reload()], ['reloadIgnoringCache', c => c.reloadIgnoringCache()]]) {
      const { guard } = harness();
      const c = page();
      const spy = name.startsWith('go') ? c.navigationHistory[name] : c[name];
      guard.watch(c);
      call(c);
      guard.onWillPreventUnload(unloadEvent(), c);
      await flush(); await flush();
      expect(spy, name).toHaveBeenCalledTimes(2);
    }
  });

  it('a link or form in the page: its preload is told to follow it again', async () => {
    const { guard } = harness();
    const c = page(); guard.watch(c);
    c.loadURL('https://old.example/');
    guard.onWillPreventUnload(unloadEvent(), c);   // the Vex navigation is still recent: replayed
    await flush(); await flush();
    expect(c.send).not.toHaveBeenCalled();
    const d = page(); guard.watch(d);
    guard.onWillPreventUnload(unloadEvent(), d);   // nothing Vex started
    await flush(); await flush();
    expect(d.send).toHaveBeenCalledWith('vex:leave-replay');
  });

  it('a Vex navigation that already went through is not the one held up (found live)', async () => {
    const h = harness();
    const c = page(); h.guard.watch(c);
    c.loadURL('https://docs.example/edit');                 // went through:
    c.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    h.guard.onWillPreventUnload(unloadEvent(), c);          // then a link in the page was held up
    await flush(); await flush();
    expect(c.loads).toEqual(['https://docs.example/edit']);
    expect(c.send).toHaveBeenCalledWith('vex:leave-replay');
  });

  it('a Vex navigation from long before is not the one held up', async () => {
    const h = harness();
    const c = page(); h.guard.watch(c);
    c.loadURL('https://old.example/');
    h.advance(INTENT_MS + 1);
    h.guard.onWillPreventUnload(unloadEvent(), c);
    await flush(); await flush();
    expect(c.loads).toEqual(['https://old.example/']);
    expect(c.send).toHaveBeenCalledWith('vex:leave-replay');
  });

  it('when nothing starts again, says "do that again", and the next try leaves', async () => {
    const h = harness();
    const c = page(); h.guard.watch(c);
    h.guard.onWillPreventUnload(unloadEvent(), c);
    await flush(); await flush();
    expect(h.timers[0].ms).toBe(CHECK_MS);
    h.runTimers();
    expect(h.tellAgain).toHaveBeenCalledWith(c);
    h.advance(ALLOW_MS - 1);
    expect(h.guard.onWillPreventUnload(unloadEvent(), c)).toBe('allow');
  });

  it('a replay that starts a navigation says nothing more', async () => {
    const h = harness();
    const c = page(); h.guard.watch(c);
    h.guard.onWillPreventUnload(unloadEvent(), c);
    await flush(); await flush();
    c.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    h.runTimers();
    expect(h.tellAgain).not.toHaveBeenCalled();
  });

  it('"Stay" keeps the page and does nothing again', async () => {
    const { guard } = harness({ answer: false });
    const c = page(); guard.watch(c);
    c.loadURL('https://elsewhere.example/');
    guard.onWillPreventUnload(unloadEvent(), c);
    await flush(); await flush();
    expect(c.loads).toHaveLength(1);
    expect(c.send).not.toHaveBeenCalled();
    expect(guard.onWillPreventUnload(unloadEvent(), c)).toBe('ask');
  });

  it('a second try while the question is up stays, and is not asked twice', async () => {
    let resolve;
    const ask = vi.fn(() => new Promise(r => { resolve = r; }));
    const guard = createLeaveGuard({ ask, isClosing: () => false, setTimer: () => {} });
    const c = page(); guard.watch(c);
    expect(guard.onWillPreventUnload(unloadEvent(), c)).toBe('ask');
    await flush();
    expect(guard.onWillPreventUnload(unloadEvent(), c)).toBe('stay');
    expect(ask).toHaveBeenCalledTimes(1);
    resolve(false); await flush();
  });
});

describe('never asked', () => {
  it('while the page\'s window or Vex is closing: the unload goes through', () => {
    const { guard, ask } = harness({ closing: true });
    const c = page(); guard.watch(c);
    const e = unloadEvent();
    expect(guard.onWillPreventUnload(e, c)).toBe('allow');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('for a page already gone', () => {
    const { guard } = harness();
    const c = page(); c.destroyed = true;
    const e = unloadEvent();
    expect(guard.onWillPreventUnload(e, c)).toBe('allow');
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

describe('the question, asked by the window the page is in', () => {
  function setup() {
    const send = vi.fn();
    const host = { win: { isDestroyed: () => false, webContents: { send } } };
    const other = { win: { isDestroyed: () => false, webContents: { send: vi.fn() } } };
    const ui = { id: 'ui' }, otherUi = { id: 'other' };
    const owner = (x) => (x === otherUi ? other : host);
    const q = createLeaveQuestions({ owner, newId: () => 'Q' + (nextId++) });
    return { q, send, ui, otherUi };
  }

  it('goes to that window and comes back with its answer', async () => {
    const { q, send, ui } = setup();
    const c = page();
    const p = q.ask(c, { origin: 'docs.example' });
    const [channel, payload] = send.mock.calls[0];
    expect(channel).toBe('page:leave-ask');
    expect(payload).toEqual({ id: payload.id, guestId: c.id, origin: 'docs.example' });
    expect(q.answer({ sender: ui }, { id: payload.id, leave: true })).toBe(true);
    expect(await p).toBe(true);
    expect(c.listenerCount('destroyed')).toBe(0);
  });

  it('another window cannot answer it', () => {
    const { q, send, otherUi } = setup();
    q.ask(page(), { origin: '' });
    expect(() => q.answer({ sender: otherUi }, { id: send.mock.calls[0][1].id, leave: true })).toThrow('another window');
  });

  it('a page that goes away is answered "stay"', async () => {
    const { q } = setup();
    const c = page();
    const p = q.ask(c, { origin: '' });
    c.destroyed = true; c.emit('destroyed');
    expect(await p).toBe(false);
  });
});

describe('main.js', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('no longer cancels every page\'s question', () => {
    expect(MAIN).not.toContain("contents.on('will-prevent-unload', (evt) => evt.preventDefault());");
    expect(MAIN).toContain("contents.on('will-prevent-unload', (evt) => { _leaveGuard.onWillPreventUnload(evt, contents); });");
    expect(MAIN).toContain('_leaveGuard.watch(contents);');
  });
  it('lets the unload through while the window or Vex is closing', () => {
    const i = MAIN.indexOf('isClosing: (contents) => {');
    expect(MAIN.slice(i, i + 200)).toContain('return !!(host && host.allowClose) || !!_exitWatch.ending();');
  });
});
