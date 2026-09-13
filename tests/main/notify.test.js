// The main-process notifier: resolves when Windows showed the toast, rejects
// with the OS's reason when it refused, and never pretends.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { createNotifier, ensureDevShortcut } = createRequire(import.meta.url)('../../src/main/notify.js');

// A stand-in for Electron's Notification: records options, lets a test decide
// which event to emit.
function fakeNotificationClass({ outcome = 'show', supported = true, reason = 'toasts are disabled' } = {}) {
  const instances = [];
  class FakeNotification {
    constructor(opts) { this.opts = opts; this.handlers = {}; instances.push(this); }
    on(ev, fn) { this.handlers[ev] = fn; }
    show() {
      setImmediate(() => {
        if (outcome === 'show') this.handlers.show?.();
        else if (outcome === 'failed') this.handlers.failed?.({}, reason);
        // 'silent' emits nothing — the timeout path
      });
    }
    static isSupported() { return supported; }
  }
  return { FakeNotification, instances };
}

describe('createNotifier', () => {
  it('resolves once the toast has shown', async () => {
    const { FakeNotification, instances } = fakeNotificationClass();
    const n = createNotifier({ Notification: FakeNotification });
    await expect(n.show({ title: 'Reminder', body: 'Stand up' })).resolves.toEqual({ ok: true, tag: null });
    expect(instances[0].opts).toMatchObject({ title: 'Reminder', body: 'Stand up', silent: false });
  });

  it('rejects with the operating system\'s reason when it refused', async () => {
    const { FakeNotification } = fakeNotificationClass({ outcome: 'failed', reason: 'Focus assist is on' });
    const n = createNotifier({ Notification: FakeNotification });
    await expect(n.show({ title: 'x' })).rejects.toThrow(/refused.*Focus assist is on/);
  });

  it('rejects when Windows says nothing at all, instead of hanging or lying', async () => {
    const { FakeNotification } = fakeNotificationClass({ outcome: 'silent' });
    const n = createNotifier({ Notification: FakeNotification, showTimeoutMs: 30 });
    await expect(n.show({ title: 'x' })).rejects.toThrow(/did not confirm/);
  });

  it('rejects when notifications are unsupported here', async () => {
    const { FakeNotification } = fakeNotificationClass({ supported: false });
    const n = createNotifier({ Notification: FakeNotification });
    expect(n.isSupported()).toBe(false);
    await expect(n.show({ title: 'x' })).rejects.toThrow(/does not support/);
  });

  it('needs a title', async () => {
    const { FakeNotification } = fakeNotificationClass();
    const n = createNotifier({ Notification: FakeNotification });
    await expect(n.show({ title: '  ' })).rejects.toThrow(/needs a title/);
  });

  it('routes a click to the handler with the tag', async () => {
    const { FakeNotification, instances } = fakeNotificationClass();
    const clicks = [];
    const n = createNotifier({ Notification: FakeNotification, onClick: (p) => clicks.push(p) });
    await n.show({ title: 'x', tag: 'r1' });
    instances[0].handlers.click();
    expect(clicks).toEqual([{ tag: 'r1' }]);
  });

  it('attaches the icon when it loads, and goes without it when it does not', async () => {
    const { FakeNotification, instances } = fakeNotificationClass();
    const good = { isEmpty: () => false };
    const nativeImage = { createFromPath: (p) => (p === 'good.ico' ? good : { isEmpty: () => true }) };
    await createNotifier({ Notification: FakeNotification, nativeImage, iconPath: 'good.ico' }).show({ title: 'a' });
    expect(instances[0].opts.icon).toBe(good);
    await createNotifier({ Notification: FakeNotification, nativeImage, iconPath: 'missing.ico' }).show({ title: 'b' });
    expect(instances[1].opts.icon).toBeUndefined();
  });
});

// Windows heads a toast with the Start Menu shortcut that targets the process.
// A development electron.exe has none, and Electron then writes one named
// "Electron" on the first toast — which is what a dev Vex woken by Task
// Scheduler showed. Ours must be there first.
describe('ensureDevShortcut', () => {
  const base = {
    platform: 'win32', packaged: false,
    startMenuDir: 'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs',
    execPath: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
    appPath: 'C:\\repo', iconPath: 'C:\\repo\\assets\\icon.ico', appUserModelId: 'com.vex.browser',
  };
  const fakeShell = (ok = true) => { const calls = []; return { calls, writeShortcutLink: (file, op, opts) => { calls.push({ file, op, opts }); return ok; } }; };

  it('creates a shortcut targeting the dev binary, carrying the id, name and icon', () => {
    const shell = fakeShell();
    const r = ensureDevShortcut({ ...base, shell, fs: { existsSync: () => false } });
    expect(r).toEqual({ ok: true, file: base.startMenuDir + '\\Vex (dev).lnk', created: true, removedStray: false });
    expect(shell.calls[0].op).toBe('create');
    expect(shell.calls[0].opts).toMatchObject({ target: base.execPath, args: '"C:\\repo"', appUserModelId: 'com.vex.browser', icon: base.iconPath });
  });

  it('updates rather than recreates one that exists', () => {
    const shell = fakeShell();
    const r = ensureDevShortcut({ ...base, shell, fs: { existsSync: () => true } });
    expect(r.created).toBe(false);
    expect(shell.calls[0].op).toBe('update');
  });

  it('does nothing for a packaged build or off Windows', () => {
    const shell = fakeShell();
    expect(ensureDevShortcut({ ...base, shell, fs: { existsSync: () => false }, packaged: true }).ok).toBe(false);
    expect(ensureDevShortcut({ ...base, shell, fs: { existsSync: () => false }, platform: 'darwin' }).ok).toBe(false);
    expect(shell.calls).toHaveLength(0);
  });

  it('throws when the shortcut could not be written, instead of pretending', () => {
    expect(() => ensureDevShortcut({ ...base, shell: fakeShell(false), fs: { existsSync: () => false } })).toThrow(/Could not write/);
    expect(() => ensureDevShortcut({ ...base, shell: fakeShell(), fs: { existsSync: () => false }, startMenuDir: null })).toThrow(/No Start Menu/);
  });

  // Electron writes "Electron.lnk" for its own exe on the first toast, and when
  // it is present at toast time Windows heads the toast "Electron" — measured.
  it('removes the Electron.lnk that Electron wrote for this binary', () => {
    const stray = base.startMenuDir + '\\Electron.lnk';
    const removed = [];
    const shell = { ...fakeShell(), readShortcutLink: (f) => (f === stray ? { target: base.execPath.toUpperCase() } : null) };
    const fs = { existsSync: (f) => f === stray, unlinkSync: (f) => removed.push(f) };
    const r = ensureDevShortcut({ ...base, shell, fs });
    expect(removed).toEqual([stray]);
    expect(r.removedStray).toBe(true);
    expect(r.created).toBe(true);
  });

  it('leaves an Electron.lnk that belongs to some other app alone', () => {
    const stray = base.startMenuDir + '\\Electron.lnk';
    const removed = [];
    const shell = { ...fakeShell(), readShortcutLink: () => ({ target: 'C:\\Other\\electron.exe' }) };
    const fs = { existsSync: (f) => f === stray, unlinkSync: (f) => removed.push(f) };
    const r = ensureDevShortcut({ ...base, shell, fs });
    expect(removed).toEqual([]);
    expect(r.removedStray).toBe(false);
  });
});
