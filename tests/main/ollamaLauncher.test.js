// src/main/ollama-launcher.js — Vex starts Ollama's server itself.
//
// After a reboot Ollama is not running, and the first AI request of the day
// failed ("Cloud AI is not configured", when local was the only backend) until
// the user opened Ollama by hand.

import { describe, it, expect, vi } from 'vitest';

const { createOllamaLauncher, candidates } = require('../../src/main/ollama-launcher.js');

const WIN_ENV = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Windows;C:\\tools' };
const INSTALLED = 'C:\\Users\\u\\AppData\\Local\\Programs\\Ollama\\ollama.exe';

function child() { const h = {}; return { on: (ev, fn) => { h[ev] = fn; }, unref: vi.fn(), emit: (ev, arg) => h[ev] && h[ev](arg) }; }
function launcher(over = {}) {
  const c = child();
  const deps = {
    platform: 'win32', env: WIN_ENV,
    exists: (p) => p === INSTALLED,
    spawn: vi.fn(() => c),
    probe: vi.fn(async () => false),
    sleep: async () => {},
    waitMs: 50,
    ...over,
  };
  return { l: createOllamaLauncher(deps), deps, c };
}

describe('where Ollama is looked for', () => {
  it('Windows: the per-user install first, then Program Files, then PATH', () => {
    expect(candidates({ platform: 'win32', env: WIN_ENV })).toEqual([
      INSTALLED, 'C:\\Program Files\\Ollama\\ollama.exe', 'C:\\Windows\\ollama.exe', 'C:\\tools\\ollama.exe',
    ]);
  });
  it('macOS and Linux', () => {
    expect(candidates({ platform: 'darwin', env: { PATH: '/usr/bin:/opt/x' } })).toEqual(['/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/x/ollama']);
    expect(candidates({ platform: 'linux', env: {} })).toEqual(['/usr/local/bin/ollama', '/usr/bin/ollama']);
  });
});

describe('ensure', () => {
  it('starts nothing when Ollama already answers', async () => {
    const { l, deps } = launcher({ probe: vi.fn(async () => true) });
    expect(await l.ensure()).toEqual({ running: true, started: false });
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('runs `ollama serve` with no window, detached, and waits until it answers', async () => {
    let n = 0;
    const { l, deps, c } = launcher({ probe: vi.fn(async () => ++n >= 4) });   // down, then up on the third look after starting
    expect(await l.ensure()).toEqual({ running: true, started: true });
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledWith(INSTALLED, ['serve'], { detached: true, windowsHide: true, stdio: 'ignore' });
    expect(c.unref).toHaveBeenCalled();
  });

  it('says so when Ollama is not installed', async () => {
    const { l, deps } = launcher({ exists: () => false });
    expect(await l.ensure()).toEqual({ running: false, started: false, error: 'Ollama is not installed — Settings › AI has the install guide' });
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('says so when it never comes up, with the reason when there is one', async () => {
    const a = launcher();
    expect((await a.l.ensure()).error).toMatch(/^Ollama did not start: no answer on port 11434/);
    const b = launcher({ spawn: vi.fn(() => { const c = child(); setTimeout(() => c.emit('exit', 1)); return c; }), sleep: () => new Promise(r => setTimeout(r, 5)) });
    expect((await b.l.ensure()).error).toBe('Ollama did not start: ollama serve exited with code 1');
  });

  it('two callers at once share one attempt; a later call tries again', async () => {
    let up = false;
    const { l, deps } = launcher({ probe: vi.fn(async () => up), sleep: async () => { up = true; } });
    const [x, y] = await Promise.all([l.ensure(), l.ensure()]);
    expect(x).toBe(y);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    up = false;
    await l.ensure();
    expect(deps.spawn).toHaveBeenCalledTimes(2);
  });

  it('takes nothing from the caller: no path, no arguments', () => {
    const { l } = launcher();
    expect(l.ensure.length).toBe(0);
  });
});
