// @vitest-environment node
//
// A site allowed to send notifications showed them while Vex was locked: its
// text was on screen for anyone at the computer. Chromium asks the permission
// check before it shows one, and that check now says no while locked.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { createPermissionService } = require('../../src/main/permissions.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('page notifications while Vex is locked', () => {
  it('an allowed site is refused at display time while locked, and allowed again once unlocked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-perm-lock-'));
    let locked = false;
    const ses = { handlers: {} };
    ses.setPermissionRequestHandler = (fn) => { ses.handlers.request = fn; };
    ses.setPermissionCheckHandler = (fn) => { ses.handlers.check = fn; };
    const svc = createPermissionService({
      userDataPath: dir,
      secureSessions: { partitionOf: () => 'persist:main', owner: () => null },
      ipcMain: { on: vi.fn(), handle: vi.fn() }, _markHidRequestActive: () => {},
      isLocked: () => locked,
    });
    svc.permissionsReady();
    svc.wirePermissionsOnSession(ses, 'test', {});
    const page = { partition: 'persist:main', getURL: () => 'https://news.example/', session: ses, isDestroyed: () => false, getType: () => 'webview' };
    await svc.setPageDecision(page, 'https://news.example', 'notifications', 'allow');
    expect(ses.handlers.check(page, 'notifications', 'https://news.example/', {})).toBe(true);
    locked = true;
    expect(ses.handlers.check(page, 'notifications', 'https://news.example/', {})).toBe(false);
    locked = false;
    expect(ses.handlers.check(page, 'notifications', 'https://news.example/', {})).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('main hands the permission service the lock state', () => {
    expect(main).toMatch(/require\('\.\/main\/permissions'\)\.createPermissionService\(\{[^}]*isLocked: \(\) => _vexLocked/);
  });
});
