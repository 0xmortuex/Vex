// Shared by the web-permission handler tests: a permission service on a fake session, asked like Chromium asks.
// Not a test file. Nothing here touches Electron, a real clock or a network.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPermissionService } = require('../../src/main/permissions.js');

const dirs = [];
const cleanup = () => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); };

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeWorld(vi) {
return function world({ partition = 'persist:main', isTrackerUrl, hygiene = null, sesFlags = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-extra-perm-'));
  dirs.push(dir);
  const ipcMain = { on: vi.fn(), handle: vi.fn() };
  const send = vi.fn();
  const host = { win: { webContents: { send }, isDestroyed: () => false } };
  const svc = createPermissionService({
    userDataPath: dir, secureSessions: { partitionOf: () => partition, owner: () => host }, ipcMain, isLocked: () => false,
    hygiene, ...(isTrackerUrl === undefined ? {} : { isTrackerUrl }),
  });
  svc.permissionsReady();
  const ses = { handlers: {}, ...sesFlags };
  ses.setPermissionRequestHandler = (fn) => { ses.handlers.request = fn; };
  ses.setPermissionCheckHandler = (fn) => { ses.handlers.check = fn; };
  svc.wirePermissionsOnSession(ses, 'test', {});
  const respond = ipcMain.handle.mock.calls.find((c) => c[0] === 'permission:respond')[1];

  // Ask like Chromium does. -> { answer } when the handler answered at once, { prompt } when it asked the person.
  async function ask(permission, { top = 'https://app.example.com/page', url = top, isMainFrame = true, fullscreen = true, jsFails = false } = {}) {
    let answer;
    const contents = {
      getURL: () => top, session: ses,
      executeJavaScript: async () => { if (jsFails) throw new Error('page is gone'); return fullscreen; },
    };
    send.mockClear();
    // isMainFrame: null leaves it out of the details, as a request that does not say.
    ses.handlers.request(contents, permission, (ok) => { answer = ok; }, { requestingUrl: url, ...(isMainFrame === null ? {} : { isMainFrame }) });
    await flush();
    if (answer !== undefined) return { answer, contents };
    return { prompt: send.mock.calls.length ? send.mock.calls[0][1] : undefined, contents, answeredWith: () => answer };
  }
  const answerPrompt = (prompt, decision, remember = true) => respond({ sender: {} }, { id: prompt.id, decision, remember });
  const check = (permission, origin, details, contents = { getURL: () => '', session: ses }) => ses.handlers.check(contents, permission, origin, details);
  return { svc, ses, ask, answerPrompt, check, send, respond };
}


}

module.exports = { makeWorld, flush, cleanup };
