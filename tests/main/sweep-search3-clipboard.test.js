// Vex's own clipboard reads (Paste & Go, "Open a list of links", the password
// copy that clears itself) asked "null wants to read what you last copied"
// (found 2026-09-29). Vex's interface reads without a prompt; a web page, or a
// guest pretending to be the interface, is still asked.
import { describe, it, expect, vi } from 'vitest';
const { createPermissionService } = require('../../src/main/permissions.js');

function service() {
  const ses = { handlers: {} };
  ses.setPermissionRequestHandler = (fn) => { ses.handlers.request = fn; };
  ses.setPermissionCheckHandler = (fn) => { ses.handlers.check = fn; };
  const svc = createPermissionService({
    userDataPath: require('os').tmpdir(),
    secureSessions: { partitionOf: () => 'persist:main', owner: () => ({ win: { webContents: { send: vi.fn() } } }) },
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    _markHidRequestActive: () => {},
  });
  svc.wirePermissionsOnSession(ses, 'test', {});
  return ses;
}

const UI = 'file:///C:/Program%20Files/Vex/resources/app.asar/src/renderer/index.html';
const ask = (ses, { type = 'window', url = UI } = {}) => {
  let answer = 'prompted';
  const contents = { getURL: () => url, getType: () => type, session: {} };
  ses.handlers.request(contents, 'clipboard-read', (allowed) => { answer = allowed; }, { requestingUrl: url });
  return answer;
};

describe('reading the clipboard', () => {
  it('Vex’s own interface reads it without a prompt', () => {
    expect(ask(service())).toBe(true);
  });

  it('a web page, a webview or another file is still asked', () => {
    const ses = service();
    expect(ask(ses, { url: 'https://example.com/' })).toBe('prompted');
    expect(ask(ses, { type: 'webview' })).toBe('prompted');
    expect(ask(ses, { url: 'file:///C:/Users/me/evil.html' })).toBe('prompted');
  });

  it('the sync check agrees', () => {
    const ses = service();
    const check = (wc) => ses.handlers.check(wc, 'clipboard-read', 'file://', {});
    expect(check({ getURL: () => UI, getType: () => 'window' })).toBe(true);
    expect(check({ getURL: () => 'https://example.com/', getType: () => 'webview' })).toBe(false);
    expect(check({ getURL: () => UI, getType: () => 'webview' })).toBe(false);
  });
});
