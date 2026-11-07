// @vitest-environment node
//
// "Check my devices" needs the camera in Vex's own window, which is otherwise never given one (only the microphone and the screen).
// setUiCamera opens it for ONE window, only for the camera, only while the card is open (a two-minute lease the card renews; it lapses by itself, and ends at once when the window navigates or goes), and only
// on Vex's own window.
import { describe, it, expect, vi, afterEach } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { createPermissionService } = require('../../src/main/permissions.js');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-perm-cam-'));
  const ses = { handlers: {} };
  ses.setPermissionRequestHandler = (fn) => { ses.handlers.request = fn; };
  ses.setPermissionCheckHandler = (fn) => { ses.handlers.check = fn; };
  const svc = createPermissionService({
    userDataPath: dir, secureSessions: { partitionOf: () => 'persist:main', owner: () => null },
    ipcMain: { on: vi.fn(), handle: vi.fn() }, isLocked: () => false,
  });
  svc.permissionsReady();
  svc.wirePermissionsOnSession(ses, 'test', {});
  const { EventEmitter } = require('events');
  const ui = (id = 1) => Object.assign(new EventEmitter(), { id, getType: () => 'window', getURL: () => 'file:///C:/app/src/renderer/index.html', isDestroyed: () => false, session: ses, partition: 'persist:main' });
  const page = Object.assign(new EventEmitter(), { id: 9, getType: () => 'webview', getURL: () => 'https://evil.example/', isDestroyed: () => false, session: ses, partition: 'persist:main' });
  // true / false when the handler answers; 'asks' when it did not answer and left the question for the person (the normal site prompt, never a yes).
  const ask = (wc, perm, details = {}) => new Promise((resolve) => { ses.handlers.request(wc, perm, resolve, { requestingUrl: wc.getURL(), ...details }); setTimeout(() => resolve('asks'), 30); });
  return { dir, svc, ses, ui, page, ask };
}
const dirs = [];
afterEach(() => { vi.useRealTimers(); while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('the camera for Vex\u2019s own window', () => {
  it('is refused by default, for the request and for the check', async () => {
    const t = setup(); dirs.push(t.dir);
    const w = t.ui();
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).not.toBe(true);
    expect(await t.ask(w, 'camera')).not.toBe(true);
    expect(t.ses.handlers.check(w, 'media', 'file:///', { mediaType: 'video' })).toBe(false);
  });
  it('the microphone is still allowed by default (dictation, voice control) and the camera is not part of it', async () => {
    const t = setup(); dirs.push(t.dir);
    expect(await t.ask(t.ui(), 'media', { mediaTypes: ['audio'] })).toBe(true);
    expect(t.ses.handlers.check(t.ui(), 'media', 'file:///', { mediaType: 'audio' })).toBe(true);
    expect(await t.ask(t.ui(), 'media', { mediaTypes: ['video', 'audio'] })).not.toBe(true);
  });
  it('is allowed for that window once the device check has asked, and refused again when it gives it back', async () => {
    const t = setup(); dirs.push(t.dir);
    const w = t.ui();
    t.svc.setUiCamera(w, true);
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).toBe(true);
    expect(t.ses.handlers.check(w, 'media', 'file:///', { mediaType: 'video' })).toBe(true);
    t.svc.setUiCamera(w, false);
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).not.toBe(true);
    expect(t.ses.handlers.check(w, 'media', 'file:///', { mediaType: 'video' })).toBe(false);
  });
  it('belongs to one window: another Vex window is not given it', async () => {
    const t = setup(); dirs.push(t.dir);
    t.svc.setUiCamera(t.ui(1), true);
    expect(await t.ask(t.ui(2), 'media', { mediaTypes: ['video'] })).not.toBe(true);
  });
  it('is a two-minute lease: it lapses on its own when nothing renews it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });       // only the clock: the handler's own answers use real timers
    const t = setup(); dirs.push(t.dir);
    const w = t.ui();
    t.svc.setUiCamera(w, true);
    vi.setSystemTime(Date.now() + 110 * 1000);
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).toBe(true);
    vi.setSystemTime(Date.now() + 15 * 1000);                       // 125 s after the grant
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).not.toBe(true);
    expect(t.ses.handlers.check(w, 'media', 'file:///', { mediaType: 'video' })).toBe(false);
  });
  it('is renewed by asking again: the lease restarts from the renewal, so an open card keeps it past the first two minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t = setup(); dirs.push(t.dir);
    const w = t.ui();
    t.svc.setUiCamera(w, true);
    for (let i = 0; i < 6; i++) {                                    // a beat every 30 s for three minutes
      vi.setSystemTime(Date.now() + 30 * 1000);
      t.svc.setUiCamera(w, true);
    }
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).toBe(true);
    vi.setSystemTime(Date.now() + 121 * 1000);                       // then the card stops renewing (crashed)
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).not.toBe(true);
  });
  it('ends at once when the window navigates, reloads, crashes or is destroyed', () => {
    const t = setup(); dirs.push(t.dir);
    let id = 20;
    for (const end of [(w) => w.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }), (w) => w.emit('render-process-gone', {}), (w) => w.emit('destroyed')]) {
      const w = t.ui(id++);
      t.svc.setUiCamera(w, true);
      expect(t.ses.handlers.check(w, 'media', 'file:///', { mediaType: 'video' })).toBe(true);
      end(w);
      expect(t.ses.handlers.check(w, 'media', 'file:///', { mediaType: 'video' })).toBe(false);
    }
  });
  it('a sub-frame or an in-page (#fragment) navigation does not end it', () => {
    const t = setup(); dirs.push(t.dir);
    const w = t.ui();
    t.svc.setUiCamera(w, true);
    w.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    w.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    expect(t.ses.handlers.check(w, 'media', 'file:///', { mediaType: 'video' })).toBe(true);
  });
  it('watches a window once however often it is renewed', () => {
    const t = setup(); dirs.push(t.dir);
    const w = t.ui();
    for (let i = 0; i < 8; i++) t.svc.setUiCamera(w, true);
    expect(w.listenerCount('did-start-navigation')).toBe(1);
    expect(w.listenerCount('render-process-gone')).toBe(1);
  });
  it('only Vex\u2019s own window can ask for it: a web page cannot open its own camera this way', () => {
    const t = setup(); dirs.push(t.dir);
    expect(() => t.svc.setUiCamera(t.page, true)).toThrow(/Only Vex/);
    expect(() => t.svc.setUiCamera(null, true)).toThrow();
  });
  it('a web page is still asked, never given the camera by it', async () => {
    const t = setup(); dirs.push(t.dir);
    t.svc.setUiCamera(t.ui(), true);
    t.ses.handlers.request(t.page, 'media', () => {}, { mediaTypes: ['video'], requestingUrl: 'https://evil.example/' });
    expect(t.ses.handlers.check(t.page, 'media', 'https://evil.example/', { mediaType: 'video' })).toBe(false);
  });
});
