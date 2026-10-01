// src/main/permissions.js — "Allow this visit" is kept per partition. It was one
// map for every window, so allowing a site's microphone for this visit in a
// private window allowed it in the normal window too (found 2026-09-29).

import { describe, it, expect, vi } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { createPermissionService } = require('../../src/main/permissions.js');

function fakeSession() {
  const s = { handlers: {} };
  s.setPermissionRequestHandler = (fn) => { s.handlers.request = fn; };
  s.setPermissionCheckHandler = (fn) => { s.handlers.check = fn; };
  return s;
}

describe('"Allow this visit" stays in the window it was given in', () => {
  it('a private window visit does not allow the site in the normal window', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-perm-'));
    const ipcMain = { on: vi.fn(), handle: vi.fn() };
    const send = vi.fn();
    const host = { win: { webContents: { send } } };
    const svc = createPermissionService({
      userDataPath: dir,
      secureSessions: { partitionOf: (c) => c.partition, owner: () => host },
      ipcMain, _markHidRequestActive: () => {},
    });
    svc.permissionsReady();
    const ses = fakeSession();
    svc.wirePermissionsOnSession(ses, 'test', {});
    const respond = ipcMain.handle.mock.calls.find(c => c[0] === 'permission:respond')[1];

    const privateTab = { partition: 'private-123', getURL: () => 'https://meet.example/', session: {} };
    const normalTab = { partition: 'persist:main', getURL: () => 'https://meet.example/', session: {} };
    const ask = (contents) => {
      let answer;
      send.mockClear();
      ses.handlers.request(contents, 'media', (ok) => { answer = ok; }, { requestingUrl: 'https://meet.example/', mediaTypes: ['audio'] });
      return answer !== undefined ? answer : send.mock.calls[0][1];
    };

    const prompt = ask(privateTab);
    await respond({ sender: {} }, { id: prompt.id, decision: 'allow', remember: 'session' });
    expect(ask(privateTab)).toBe(true);
    expect(ask(normalTab).permission).toBe('microphone');                    // still asks
    expect(ses.handlers.check(normalTab, 'media', 'https://meet.example/', { mediaType: 'audio' })).toBe(false);
    expect(ses.handlers.check(privateTab, 'media', 'https://meet.example/', { mediaType: 'audio' })).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
