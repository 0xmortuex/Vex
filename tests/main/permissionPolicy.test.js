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
