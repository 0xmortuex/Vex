// src/main/window-hang.js — a hung Vex window is written down and offered a
// reload, instead of sitting dead until Task Manager.
import { describe, it, expect, vi } from 'vitest';
const { EventEmitter } = require('events');
const { createWindowHangGuard } = require('../../src/main/window-hang.js');

function setup({ response = 0, pages = ['https://www.primevideo.com/', 'https://discord.com/app'] } = {}) {
  const win = new EventEmitter();
  win.isDestroyed = () => false;
  win.webContents = { reload: vi.fn(), forcefullyCrashRenderer: vi.fn() };
  let resolveBox;
  const dialog = {
    showMessageBox: vi.fn((_w, opts) => new Promise((resolve, reject) => {
      resolveBox = resolve;
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
      if (response !== null) resolve({ response });
    })),
  };
  const crashLog = { add: vi.fn() };
  const guard = createWindowHangGuard({ win, dialog, crashLog, openPages: () => pages, log: () => {} });
  return { win, dialog, crashLog, guard, answer: (r) => resolveBox({ response: r }) };
}

describe('a hung Vex window', () => {
  it('is written in the crash log with what was open, and asks to reload', async () => {
    const { crashLog, dialog, guard } = setup({ response: 1 });
    await guard.onUnresponsive();
    expect(crashLog.add).toHaveBeenCalledWith('Vex window stopped responding', 'https://www.primevideo.com/ | https://discord.com/app');
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    const opts = dialog.showMessageBox.mock.calls[0][1];
    expect(opts.message).toBe('Vex stopped responding');
    expect(opts.buttons).toEqual(['Reload window', 'Wait']);
  });

  it('Reload window ends the stuck renderer and reloads', async () => {
    const { win, guard } = setup({ response: 0 });
    await guard.onUnresponsive();
    expect(win.webContents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1);
    expect(win.webContents.reload).toHaveBeenCalledTimes(1);
  });

  it('Wait leaves it alone', async () => {
    const { win, guard } = setup({ response: 1 });
    await guard.onUnresponsive();
    expect(win.webContents.reload).not.toHaveBeenCalled();
    expect(win.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled();
  });

  it('asks once while the hang lasts, and takes the question away when it answers again', async () => {
    const { win, dialog, guard } = setup({ response: null });
    const first = guard.onUnresponsive();
    await guard.onUnresponsive();
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(guard.asking()).toBe(true);
    win.emit('responsive');
    await first;
    expect(guard.asking()).toBe(false);
    expect(win.webContents.reload).not.toHaveBeenCalled();
  });

  it('listens to the window itself', () => {
    const { win, crashLog } = setup({ response: 1 });
    win.emit('unresponsive');
    expect(crashLog.add).toHaveBeenCalledTimes(1);
  });

  it('refuses to start without what it needs', () => {
    expect(() => createWindowHangGuard({ win: null })).toThrow(/no window/);
  });
});
