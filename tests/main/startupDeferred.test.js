// Two things main.js did on every start that most starts do not need yet:
//   - the taskbar's "Start in safe mode" entry (app.setUserTasks, ~130 ms of
//     the main thread on Windows) is written once the first window is up;
//   - imapflow and mailparser (~190 modules with pino, html-to-text, iconv…)
//     load on the first mail connection instead of at every start.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('the safe-mode taskbar entry', () => {
  // The block as it stands in main.js, run against a stand-in app.
  const start = main.indexOf("  if (process.platform === 'win32' && app.isPackaged) {\n    app.once('browser-window-created'".replace(/\n/g, main.includes('\r\n') ? '\r\n' : '\n'));
  const block = main.slice(start, main.indexOf('\n});', start));
  const run = () => {
    const app = Object.assign(new EventEmitter(), { isPackaged: true, setUserTasks: vi.fn(() => true) });
    new Function('app', 'process', 'console', block)(app, { platform: 'win32', execPath: 'C:\\Vex\\Vex.exe' }, console);
    return app;
  };

  it('is found in main.js', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('setUserTasks');
  });

  it('waits for the first window to be shown, then a moment more', () => {
    vi.useFakeTimers();
    try {
      const app = run();
      expect(app.setUserTasks).not.toHaveBeenCalled();
      const win = new EventEmitter();
      app.emit('browser-window-created', {}, win);
      vi.advanceTimersByTime(5000);
      expect(app.setUserTasks).not.toHaveBeenCalled();     // created, not shown
      win.emit('show');
      expect(app.setUserTasks).not.toHaveBeenCalled();     // not in the show handler itself
      vi.advanceTimersByTime(1000);
      expect(app.setUserTasks).toHaveBeenCalledTimes(1);
      expect(app.setUserTasks.mock.calls[0][0][0]).toMatchObject({ program: 'C:\\Vex\\Vex.exe', arguments: '--safe-mode', title: 'Start in safe mode' });
      // A second window does not write it again.
      const other = new EventEmitter();
      app.emit('browser-window-created', {}, other);
      other.emit('show');
      vi.advanceTimersByTime(2000);
      expect(app.setUserTasks).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

describe('the mail libraries', () => {
  it('are not required at load, only inside the lazy loader', () => {
    const at = (re) => [...main.matchAll(re)].map(m => m.index);
    const imap = at(/require\('imapflow'\)/g);
    const parser = at(/require\('mailparser'\)/g);
    expect(imap).toHaveLength(1);
    expect(parser).toHaveLength(1);
    const loader = main.indexOf('const _mailLib = () =>');
    const end = main.indexOf('\n', loader);
    for (const i of [...imap, ...parser]) expect(i > loader && i < end).toBe(true);
  });

  it('load on first use, once, and still build a real client', async () => {
    // The loader and the two stand-ins handed to createMail, run as written.
    const from = main.indexOf('let _mailLibs = null;');
    const to = main.indexOf('  // secretStore is declared further down', from);
    const code = main.slice(from, to).replace("const _mail = require('./main/mail').createMail({", 'return {').replace(/,\s*$/, '') + '\n};';
    class FakeImap { constructor(o) { this.options = o; } }
    const loads = [];
    const req = vi.fn((name) => {
      loads.push(name);
      if (name === 'imapflow') return { ImapFlow: FakeImap };
      if (name === 'mailparser') return { simpleParser: async (src) => ({ text: String(src) }) };
      throw new Error('unexpected ' + name);
    });
    const deps = new Function('require', code)(req);
    expect(loads).toEqual([]);                                  // nothing at start
    const client = new deps.ImapFlow({ host: 'imap.test' });
    expect(client).toBeInstanceOf(FakeImap);
    expect(client.options).toEqual({ host: 'imap.test' });
    expect(await deps.simpleParser('hi')).toEqual({ text: 'hi' });
    new deps.ImapFlow({ host: 'again.test' });
    expect(loads).toEqual(['imapflow', 'mailparser']);         // once each
  });

  it('a library that cannot load fails that mail request, and the next one tries again', () => {
    const from = main.indexOf('let _mailLibs = null;');
    const to = main.indexOf('  // secretStore is declared further down', from);
    const code = main.slice(from, to).replace("const _mail = require('./main/mail').createMail({", 'return {').replace(/,\s*$/, '') + '\n};';
    let broken = true;
    const req = (name) => {
      if (broken) throw new Error("Cannot find module '" + name + "'");
      return name === 'imapflow' ? { ImapFlow: class { } } : { simpleParser: async () => ({}) };
    };
    const deps = new Function('require', code)(req);
    expect(() => new deps.ImapFlow({})).toThrow("Cannot find module 'imapflow'");
    broken = false;
    expect(() => new deps.ImapFlow({})).not.toThrow();
  });

  it('the mail IPC is unchanged', () => {
    for (const ch of ['accounts', 'add', 'remove', 'inbox', 'message']) expect(main).toContain(`ipcMain.handle('mail:${ch}', _mailCall(`);
  });

  it('both are declared dependencies, so the packaged app has them', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    expect(pkg.dependencies).toHaveProperty('imapflow');
    expect(pkg.dependencies).toHaveProperty('mailparser');
  });
});
