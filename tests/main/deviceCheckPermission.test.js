// @vitest-environment node
//
// "Check my devices" needs the camera in Vex's own window, which is otherwise never given one (only the microphone and the screen).
// setUiCamera opens it for ONE window, only for the camera, only while the card is open (it also lapses after ten minutes), and only
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
  const ui = (id = 1) => ({ id, getType: () => 'window', getURL: () => 'file:///C:/app/src/renderer/index.html', isDestroyed: () => false, session: ses, partition: 'persist:main' });
  const page = { id: 9, getType: () => 'webview', getURL: () => 'https://evil.example/', isDestroyed: () => false, session: ses, partition: 'persist:main' };
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
  it('lapses after ten minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });       // only the clock: the handler’s own answers use real timers
    const t = setup(); dirs.push(t.dir);
    const w = t.ui();
    t.svc.setUiCamera(w, true);
    vi.setSystemTime(Date.now() + 9 * 60 * 1000);
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).toBe(true);
    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    expect(await t.ask(w, 'media', { mediaTypes: ['video'] })).not.toBe(true);
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
