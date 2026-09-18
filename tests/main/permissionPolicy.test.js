// What Vex grants a web page without asking.
//
// 'clipboard-read' used to be on the auto-allow list, which meant any page
// could call navigator.clipboard.readText() and receive whatever you last
// copied — no prompt, no user gesture. Proved against a real page in a running
// browser: it read the clipboard verbatim while navigator.permissions.query
// still reported "denied".
//
// That is worse here than in most browsers because Vex copies passwords out of
// its own vault and one-time codes out of its authenticator. Chrome prompts
// for this permission; so does Vex now.

import { describe, it, expect, vi } from 'vitest';
const { createPermissionService } = require('../../src/main/permissions.js');

// A session that records the handlers it was given, so they can be called.
function fakeSession() {
  const s = { handlers: {} };
  s.setPermissionRequestHandler = (fn) => { s.handlers.request = fn; };
  s.setPermissionCheckHandler = (fn) => { s.handlers.check = fn; };
  return s;
}

function service(opts) {
  const ipcMain = { on: vi.fn(), handle: vi.fn() };
  const secureSessions = {
    partitionOf: () => 'persist:main',
    owner: () => ({ win: { webContents: { send: vi.fn() } } }),
  };
  const svc = createPermissionService({
    userDataPath: require('os').tmpdir(),
    secureSessions,
    ipcMain,
    _markHidRequestActive: () => {},
  });
  const ses = fakeSession();
  svc.wirePermissionsOnSession(ses, 'test', opts || {});
  return { svc, ses };
}

// Run the request handler and report what it decided, or 'prompted' when it
// held the callback to ask the user.
function decide(ses, permission, url = 'https://example.com/page') {
  let answer = 'prompted';
  const contents = { getURL: () => url, session: {} };
  ses.handlers.request(contents, permission, (allowed) => { answer = allowed; }, { requestingUrl: url });
  return answer;
}

describe('what is granted with no prompt at all', () => {
  it('does NOT hand over the clipboard', () => {
    const { ses } = service();
    expect(decide(ses, 'clipboard-read'), 'a page must never read the clipboard silently').toBe('prompted');
  });

  it('still lets a page WRITE to the clipboard — that is an ordinary copy button', () => {
    const { ses } = service();
    expect(decide(ses, 'clipboard-sanitized-write')).toBe(true);
  });

  it('keeps the things a browser is expected to allow', () => {
    const { ses } = service();
    for (const p of ['fullscreen', 'pointerLock', 'mediaKeySystem']) {
      expect(decide(ses, p), p).toBe(true);
    }
  });

  it('denies anything it has never heard of', () => {
    const { ses } = service();
    expect(decide(ses, 'some-future-capability')).toBe(false);
  });

  it('asks before the camera, the microphone, the screen or your location', () => {
    const { ses } = service();
    for (const p of ['geolocation', 'camera', 'microphone', 'display-capture', 'notifications', 'midi']) {
      expect(decide(ses, p), p).toBe('prompted');
    }
  });
});

describe('the synchronous check navigator.permissions.query uses', () => {
  it('reports the clipboard as not granted until it actually is', () => {
    const { ses } = service();
    expect(ses.handlers.check({ session: {} }, 'clipboard-read', 'https://example.com')).toBe(false);
  });

  it('still allows DRM and fullscreen, which pages check before playing', () => {
    const { ses } = service();
    for (const p of ['mediaKeySystem', 'fullscreen', 'pointerLock']) {
      expect(ses.handlers.check({ session: {} }, p, 'https://example.com'), p).toBe(true);
    }
  });
});

describe('the Discord panel exception', () => {
  // That panel auto-grants mic and camera because the generic prompt never
  // surfaces inside a panel webview. It must not quietly widen to everything.
  it('grants media there, and still not the clipboard', () => {
    const { ses } = service({ autoAllowMedia: true });
    expect(decide(ses, 'microphone')).toBe(true);
    expect(decide(ses, 'camera')).toBe(true);
    expect(decide(ses, 'clipboard-read')).toBe('prompted');
  });
});

describe('the prompt says what is being asked for', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'permission-prompts.js'), 'utf8');

  it('describes the clipboard in words, not as an API name', () => {
    expect(src).toContain("'clipboard-read'");
    expect(src).toContain('read what you last copied');
  });

  it('has a label for every permission that can prompt', () => {
    const perms = require('fs')
      .readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'permissions.js'), 'utf8')
      .match(/const NEEDS_PROMPT = new Set\(\[([^\]]*)\]/)[1]
      .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    for (const p of perms) {
      expect(src, p + ' can prompt but has no plain-English label').toContain("'" + p + "'");
    }
  });
});

// Every website notification in Vex was granted by the prompt and then refused
// at display time. Decisions were stored under `new URL(...).origin` (no
// trailing slash) and the sync check handler was handed an origin spec with
// one, so an allowed site never matched its own decision. Measured live:
// navigator.permissions.query said "denied" seconds after Allow.
import { originKey } from '../../src/main/permissions.js';
describe('a decision made in the prompt is honoured by the sync check', () => {
  it('spells an origin one way whichever form Electron hands over', () => {
    expect(originKey('https://example.com/')).toBe('https://example.com');
    expect(originKey('https://example.com')).toBe('https://example.com');
    expect(originKey('http://localhost:9562/')).toBe('http://localhost:9562');
    expect(originKey('https://Example.com:443/some/path')).toBe('https://example.com');
    expect(originKey('not a url/')).toBe('not a url');
  });

  it('finds the stored allow for an origin given with a trailing slash', async () => {
    const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'vex-perm-'));
    const ipcMain = { on: vi.fn(), handle: vi.fn() };
    const svc = createPermissionService({
      userDataPath: dir,
      secureSessions: { partitionOf: () => 'persist:main', owner: () => ({}) },
      ipcMain, _markHidRequestActive: () => {},
    });
    const ses = fakeSession();
    svc.wirePermissionsOnSession(ses, 'test', {});
    await svc.savePermissionDecisions({ 'https://example.com::notifications': 'allow' });
    expect(ses.handlers.check({ session: {} }, 'notifications', 'https://example.com/')).toBe(true);
    expect(ses.handlers.check({ session: {} }, 'notifications', 'https://example.com')).toBe(true);
    expect(ses.handlers.check({ session: {} }, 'notifications', 'https://other.com/')).toBe(false);
    require('fs').rmSync(dir, { recursive: true, force: true });
  });
});

// Electron reports the microphone, the camera, both, and a SCREEN SHARE all as
// the one permission 'media', told apart only by details.mediaTypes — measured
// in a running Vex: ["audio"], ["video"], ["audio","video"], and [] for
// getDisplayMedia. Vex ignored that: every prompt said "camera and microphone",
// and "Remember" filed the answer under one key, so allowing a site's
// microphone pre-approved its camera and its screen shares.
describe("a 'media' request is filed under what it really asks for", () => {
  const { mediaParts, savedDecision } = require('../../src/main/permissions.js');
  const fs = require('fs'), os = require('os'), path = require('path');

  function live() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-perm-'));
    const ipcMain = { on: vi.fn(), handle: vi.fn() };
    const send = vi.fn();
    const host = { win: { webContents: { send } } };
    const svc = createPermissionService({ userDataPath: dir, secureSessions: { partitionOf: () => 'persist:main', owner: () => host }, ipcMain, _markHidRequestActive: () => {} });
    svc.permissionsReady();
    const ses = fakeSession();
    svc.wirePermissionsOnSession(ses, 'test', {});
    const respond = ipcMain.handle.mock.calls.find(c => c[0] === 'permission:respond')[1];
    // Ask; returns the answer, or the prompt that was shown.
    const ask = (mediaTypes) => {
      let answer;
      send.mockClear();
      ses.handlers.request({ getURL: () => 'https://meet.example/', session: {} }, 'media', (ok) => { answer = ok; }, { requestingUrl: 'https://meet.example/room', mediaTypes });
      return answer !== undefined ? answer : send.mock.calls[0][1];
    };
    const answer = (prompt, decision, remember = true) => respond({ sender: {} }, { id: prompt.id, decision, remember });
    return { svc, ses, ask, answer, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  it('names the parts', () => {
    expect(mediaParts('media', { mediaTypes: [] })).toEqual(['display-capture']);
    expect(mediaParts('media', { mediaTypes: ['audio'] })).toEqual(['microphone']);
    expect(mediaParts('media', { mediaTypes: ['video'] })).toEqual(['camera']);
    expect(mediaParts('media', { mediaTypes: ['audio', 'video'] })).toEqual(['camera', 'microphone']);
    expect(mediaParts('media', {})).toEqual(['camera', 'microphone']);        // no detail: ask for both
    expect(mediaParts('geolocation', { mediaTypes: [] })).toEqual(['geolocation']);
  });

  it('the prompt says what is being asked for', () => {
    const v = live();
    expect(v.ask([]).permission).toBe('display-capture');
    expect(v.ask(['audio']).permission).toBe('microphone');
    expect(v.ask(['video']).permission).toBe('camera');
    expect(v.ask(['audio', 'video']).permission).toBe('media');
    v.done();
  });

  it('remembering the microphone does not approve the camera or a screen share', async () => {
    const v = live();
    await v.answer(v.ask(['audio']), 'allow');
    expect(v.ask(['audio'])).toBe(true);
    expect(v.ask(['video']).permission).toBe('camera');               // still asks
    expect(v.ask([]).permission).toBe('display-capture');             // still asks
    expect(v.svc.loadPermissionDecisions()).toEqual({ 'https://meet.example::microphone': 'allow' });
    v.done();
  });

  it('blocking a screen share does not block the microphone', async () => {
    const v = live();
    await v.answer(v.ask([]), 'deny');
    expect(v.ask([])).toBe(false);
    expect(v.ask(['audio']).permission).toBe('microphone');
    v.done();
  });

  it('allowing both remembers each; one denied part denies a request for both', async () => {
    const v = live();
    await v.answer(v.ask(['audio', 'video']), 'allow');
    expect(v.svc.loadPermissionDecisions()).toEqual({ 'https://meet.example::camera': 'allow', 'https://meet.example::microphone': 'allow' });
    expect(v.ask(['video'])).toBe(true);
    expect(v.ses.handlers.check({ session: {} }, 'media', 'https://meet.example/', { mediaType: 'audio' })).toBe(true);
    await v.svc.savePermissionDecisions({ 'https://meet.example::camera': 'deny', 'https://meet.example::microphone': 'allow' });
    expect(v.ask(['audio', 'video'])).toBe(false);
    expect(v.ses.handlers.check({ session: {} }, 'media', 'https://meet.example/', { mediaType: 'video' })).toBe(false);
    v.done();
  });

  it("an answer saved before this change ('::media') still counts for camera and microphone — never for a screen share", async () => {
    const v = live();
    await v.svc.savePermissionDecisions({ 'https://meet.example::media': 'allow' });
    expect(v.ask(['audio'])).toBe(true);
    expect(v.ask(['audio', 'video'])).toBe(true);
    expect(v.ask([]).permission).toBe('display-capture');
    expect(savedDecision({ 'https://a.example::media': 'deny' }, 'https://a.example', ['microphone'])).toBe('deny');
    expect(savedDecision({ 'https://a.example::media': 'deny' }, 'https://a.example', ['display-capture'])).toBe(null);
    v.done();
  });

  it('"Remember" unticked stores nothing', async () => {
    const v = live();
    await v.answer(v.ask(['audio']), 'allow', false);
    expect(v.svc.loadPermissionDecisions()).toEqual({});
    v.done();
  });
});
