// page:eval-all-frames runs one script in every frame of a tab, so Master
// Volume, the per-site volume and Night mode reach a player inside an iframe
// (found 2026-09-29). The tab id must belong to the window that asks.
import { describe, it, expect } from 'vitest';
const { validate } = require('../../src/main/ipc-schemas.js');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');

describe('page:eval-all-frames', () => {
  it('takes a tab id, the script and an optional user-gesture flag', () => {
    expect(() => validate('page:eval-all-frames', [5, 'location.href'])).not.toThrow();
    expect(() => validate('page:eval-all-frames', [5, 'location.href', true])).not.toThrow();
    expect(() => validate('page:eval-all-frames', [0, 'x'])).toThrow();
    expect(() => validate('page:eval-all-frames', [5, 42])).toThrow();
    expect(() => validate('page:eval-all-frames', [5, 'x'.repeat(256 * 1024 + 1)])).toThrow();
  });

  it("refuses a tab that belongs to another window", async () => {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
    let owns = false;
    installIpcPolicy(ipcMain, { isUiFrame: () => true, owner: () => null, isAuxiliary: () => false, ownsTarget: () => owns });
    ipcMain.handle('page:eval-all-frames', () => 'ran');
    const call = () => handlers.get('page:eval-all-frames')({ sender: {}, senderFrame: { url: 'file:///x/index.html' } }, 7, '1');
    await expect(call()).rejects.toThrow('Target belongs to another window');
    owns = true;
    expect(await call()).toBe('ran');
  });
});
