// src/main/page-dialogs.js — a page's alert / confirm / prompt is asked over
// its own tab and blocks only that page, never the whole Vex window (a native
// box owned by the window disabled all of Vex, reported 2026-10-05).
import { describe, it, expect, vi } from 'vitest';
const { EventEmitter } = require('events');
const { createPageDialogs, answerFor, originOf } = require('../../src/main/page-dialogs.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const fs = require('fs');
const path = require('path');

function setup() {
  const sent = [];
  const host = { win: { isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } } };
  const otherHost = { win: { isDestroyed: () => false, webContents: { send: () => {} } } };
  let n = 0;
  const nativeAsk = vi.fn(async () => ({ ok: true }));
  const ui = { id: 1 }, otherUi = { id: 2 };
  const owner = (c) => (c === ui ? host : c === otherUi ? otherHost : c && c.__host) || null;
  const pd = createPageDialogs({ owner, nativeAsk, newId: () => 'q' + (++n), log: () => {} });
  function guest(id = 10, url = 'https://example.com/page', type = 'webview') {
    const g = new EventEmitter();
    Object.assign(g, { id, __host: host, getURL: () => url, getType: () => type });
    return g;
  }
  // A sendSync event: the answer is whatever returnValue is set to, when it is set.
  function ask(g, req) {
    const event = { sender: g, answered: false };
    Object.defineProperty(event, 'returnValue', { set(v) { event.answered = true; event.value = v; } });
    pd.request(event, req);
    return event;
  }
  return { pd, host, sent, guest, ask, ui, otherUi, nativeAsk };
}

describe('a page dialog is asked over its own tab', () => {
  it('asks the page\'s window and waits — the page is not answered until the user answers', () => {
    const { pd, sent, guest, ask, ui } = setup();
    const ev = ask(guest(), { type: 'confirm', message: 'Delete?', value: '' });
    expect(ev.answered).toBe(false);
    expect(sent).toEqual([['page-dialog:show', { id: 'q1', guestId: 10, type: 'confirm', message: 'Delete?', value: '', origin: 'example.com', offerStop: false }]]);
    pd.answer({ sender: ui }, { id: 'q1', ok: true });
    expect(ev.answered).toBe(true);
    expect(ev.value).toBe(true);
  });

  it('answers each kind the way the page expects', () => {
    expect(answerFor('alert', true)).toBe(null);
    expect(answerFor('confirm', true)).toBe(true);
    expect(answerFor('confirm', false)).toBe(false);
    expect(answerFor('prompt', true, 'typed')).toBe('typed');
    expect(answerFor('prompt', true, '')).toBe('');
    expect(answerFor('prompt', false, 'typed')).toBe(null);
  });

  it('only the window that showed it may answer', () => {
    const { pd, guest, ask, otherUi } = setup();
    const ev = ask(guest(), { type: 'alert', message: 'hi' });
    expect(() => pd.answer({ sender: otherUi }, { id: 'q1', ok: true })).toThrow(/another window/);
    expect(ev.answered).toBe(false);
  });

  it('a page that closes, crashes or leaves is answered as cancelled and the question goes', () => {
    for (const end of ['destroyed', 'render-process-gone', 'navigate']) {
      const { sent, guest, ask } = setup();
      const g = guest();
      const ev = ask(g, { type: 'prompt', message: 'Name?', value: 'x' });
      if (end === 'navigate') g.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
      else g.emit(end);
      expect(ev.answered).toBe(true);
      expect(ev.value).toBe(null);
      expect(sent.at(-1)).toEqual(['page-dialog:close', { id: 'q1' }]);
    }
  });

  it('a link inside the page (same document) or a frame leaving does not cancel it', () => {
    const { guest, ask } = setup();
    const g = guest();
    const ev = ask(g, { type: 'alert', message: 'a' });
    g.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    g.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    expect(ev.answered).toBe(false);
  });

  it('offers to stop more dialogs from the second on, and a stopped page is answered at once', () => {
    const { pd, sent, guest, ask, ui } = setup();
    const g = guest();
    ask(g, { type: 'alert', message: '1' });
    pd.answer({ sender: ui }, { id: 'q1', ok: true });
    ask(g, { type: 'alert', message: '2' });
    expect(sent.at(-1)[1].offerStop).toBe(true);
    pd.answer({ sender: ui }, { id: 'q2', ok: true, stop: true });
    const before = sent.length;
    const ev = ask(g, { type: 'confirm', message: '3' });
    expect(ev.answered).toBe(true);
    expect(ev.value).toBe(null);           // the page's confirm() reads it as false
    expect(sent.length).toBe(before);      // nothing shown
    // A new page in the tab may ask again.
    g.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    const again = ask(g, { type: 'alert', message: '4' });
    expect(again.answered).toBe(false);
    expect(sent.at(-1)[1].offerStop).toBe(false);
  });

  it('a page with no Vex window is answered at once, never left waiting', () => {
    const { guest, ask } = setup();
    const g = guest();
    g.__host = null;
    const ev = ask(g, { type: 'confirm', message: 'x' });
    expect(ev.answered).toBe(true);
  });

  it('a page in a window of its own (a sign-in popup) gets that window\'s own box', async () => {
    const { guest, ask, nativeAsk, sent } = setup();
    const ev = ask(guest(11, 'https://login.example.com/', 'window'), { type: 'confirm', message: 'Sure?' });
    await new Promise(r => setTimeout(r, 0));
    expect(nativeAsk).toHaveBeenCalledWith(expect.anything(), { type: 'confirm', message: 'Sure?', origin: 'login.example.com' });
    expect(ev.value).toBe(true);
    expect(sent).toEqual([]);
  });

  it('a late answer for a question already settled changes nothing', () => {
    const { pd, guest, ask, ui } = setup();
    const g = guest();
    ask(g, { type: 'alert', message: 'a' });
    g.emit('destroyed');
    expect(pd.answer({ sender: ui }, { id: 'q1', ok: true })).toBe(false);
  });

  it('names the site, and only a web site', () => {
    expect(originOf('https://www.primevideo.com/detail?x=1')).toBe('www.primevideo.com');
    expect(originOf('file:///C:/x.html')).toBe('');
    expect(originOf('about:blank')).toBe('');
  });
});

describe('the IPC around it', () => {
  it('a page may send it, with bounded text', () => {
    expect(() => validate('page-dialog', [{ type: 'alert', message: 'hi', value: '' }])).not.toThrow();
    expect(() => validate('page-dialog', [{ type: 'print', message: 'hi' }])).toThrow();
    expect(() => validate('page-dialog', [{ type: 'alert', message: 'x'.repeat(10001) }])).toThrow();
    expect(() => validate('page-dialog:answer', [{ id: 'q1', ok: true, value: 'v', stop: false }])).not.toThrow();
    expect(() => validate('page-dialog:answer', [{ id: 'q1', ok: 'yes' }])).toThrow();
  });

  it('is a guest channel, and a refused one still answers the waiting page', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    expect(src).toMatch(/GUEST_CHANNELS = new Set\([^)]*'page-dialog'/);
    const { installIpcPolicy } = require('../../src/main/ipc-policy.js');
    const handlers = {};
    const ipc = { handle: () => {}, on: (ch, fn) => { handlers[ch] = fn; } };
    installIpcPolicy(ipc, { isUiFrame: () => false, owner: () => null, isAuxiliary: () => false });
    ipc.on('page-dialog', () => { throw new Error('should not run'); });
    const event = { sender: { id: 5 }, senderFrame: { url: 'https://x.test/' } };
    let answered;
    Object.defineProperty(event, 'returnValue', { set(v) { answered = v; } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handlers['page-dialog'](event, { type: 'alert', message: 'hi' });
    warn.mockRestore();
    expect(answered).toBe(null);
  });

  it('every webview has its native dialogs off, so none can disable the window', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/session-security.js'), 'utf8');
    expect(src).toMatch(/prefs\.disableDialogs = true/);
  });

  it('the guest preload replaces alert, confirm and prompt in the page\'s own world', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
    expect(src).toMatch(/sendSync\('page-dialog'/);
    expect(src).toMatch(/executeInMainWorld\(\{ func: vexPageDialogs/);
    for (const name of ['alert', 'confirm', 'prompt']) expect(src).toContain(`put('${name}'`);
  });

  it('the main-world stand-ins return what the page expects', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
    const body = src.slice(src.indexOf('function vexPageDialogs('), src.indexOf('\n}\n', src.indexOf('function vexPageDialogs(')) + 2);
    const win = {};
    const asked = [];
    let reply = null;
    // eslint-disable-next-line no-new-func
    const install = new Function('window', body + '\nreturn vexPageDialogs;')(win);
    install((type, message, value) => { asked.push([type, message, value]); return reply; });
    reply = null;
    expect(win.alert('hi')).toBe(undefined);
    expect(win.alert()).toBe(undefined);
    reply = true; expect(win.confirm('ok?')).toBe(true);
    reply = null; expect(win.confirm('ok?')).toBe(false);
    reply = 'Ann'; expect(win.prompt('Name?', 'x')).toBe('Ann');
    reply = null; expect(win.prompt('Name?')).toBe(null);
    expect(win.alert(42)).toBe(undefined);
    expect(asked).toEqual([
      ['alert', 'hi', ''], ['alert', '', ''], ['confirm', 'ok?', ''], ['confirm', 'ok?', ''],
      ['prompt', 'Name?', 'x'], ['prompt', 'Name?', ''], ['alert', '42', ''],
    ]);
  });
});
