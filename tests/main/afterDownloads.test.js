// @vitest-environment node
// "When all downloads finish: sleep / shut down" - the state machine with fake timers and a FAKE runner.
// Nothing in this file can sleep or shut down a computer: the runner is always a stand-in, and the real
// runner is only ever given a fake spawn.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createAfterDownloads, createCommandRunner, commandFor, COUNTDOWN_MS, ARM_TTL_MS } = require('../../src/main/after-downloads.js');

function make(over = {}) {
  const run = vi.fn();
  const events = [];
  const ad = createAfterDownloads({ run, notify: (e) => events.push(e), platform: 'win32', ...over });
  const kinds = () => events.map(e => e.kind);
  return { ad, run, events, kinds };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the happy path', () => {
  it('armed -> downloading -> all complete -> 60 s countdown -> fires once, then disarms', () => {
    const { ad, run, kinds } = make();
    ad.arm('shutdown');
    expect(ad.state()).toMatchObject({ armed: true, action: 'shutdown', phase: 'waiting' });
    ad.noteStart('a'); ad.noteStart('b');
    ad.noteEnd('a', 'completed');
    expect(ad.state().phase).toBe('waiting');       // b is still going
    ad.noteEnd('b', 'completed');
    expect(ad.state().phase).toBe('countdown');
    expect(kinds()).toEqual(['armed', 'countdown']);
    vi.advanceTimersByTime(COUNTDOWN_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('shutdown');
    expect(ad.state()).toMatchObject({ armed: false, phase: 'off' });
    vi.advanceTimersByTime(ARM_TTL_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);           // never twice
  });
  it('the countdown event says when it will fire', () => {
    const { ad, events } = make();
    ad.arm('sleep'); ad.noteStart('a'); ad.noteEnd('a', 'completed');
    const c = events.find(e => e.kind === 'countdown');
    expect(c).toMatchObject({ seconds: 60, action: 'sleep' });
    expect(c.fireAt - Date.now()).toBe(COUNTDOWN_MS);
  });
  it('downloads already running when it is armed count', () => {
    const { ad, run } = make();
    ad.noteStart('a');            // before arming
    ad.arm('sleep');
    ad.noteEnd('a', 'completed');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(run).toHaveBeenCalledWith('sleep');
  });
});

describe('it must not fire', () => {
  it('when not armed (the default): nothing happens however many downloads finish', () => {
    const { ad, run } = make();
    ad.noteStart('a'); ad.noteEnd('a', 'completed');
    vi.advanceTimersByTime(ARM_TTL_MS);
    expect(run).not.toHaveBeenCalled();
    expect(ad.state().armed).toBe(false);
  });
  it('when armed but nothing has downloaded yet', () => {
    const { ad, run } = make();
    ad.arm('shutdown');
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
  });
  it('when a download failed or was interrupted, and says why, and disarms', () => {
    for (const state of ['interrupted', 'cancelled']) {
      const { ad, run, events } = make();
      ad.arm('shutdown');
      ad.noteStart('a'); ad.noteStart('b');
      ad.noteEnd('a', 'completed');
      ad.noteEnd('b', state, false, 'big.iso');
      vi.advanceTimersByTime(COUNTDOWN_MS * 3);
      expect(run).not.toHaveBeenCalled();
      const blocked = events.find(e => e.kind === 'blocked');
      expect(blocked.why).toMatch(/did not finish.*big\.iso/);
      expect(ad.state().armed).toBe(false);
    }
  });
  it('a failure while others still run blocks it once the last one ends', () => {
    const { ad, run, kinds } = make();
    ad.arm('sleep'); ad.noteStart('a'); ad.noteStart('b');
    ad.noteEnd('a', 'interrupted');
    expect(kinds()).toEqual(['armed']);
    ad.noteEnd('b', 'completed');
    expect(kinds()).toEqual(['armed', 'blocked']);
    vi.advanceTimersByTime(COUNTDOWN_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });
  it('a download the person cancelled on purpose is not a failure', () => {
    const { ad, run } = make();
    ad.arm('sleep'); ad.noteStart('a'); ad.noteStart('b');
    ad.noteEnd('a', 'cancelled', true);
    ad.noteEnd('b', 'completed');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(run).toHaveBeenCalledWith('sleep');
  });
  it('if the person cancelled every download there is nothing to wait for: stays armed, does not fire', () => {
    const { ad, run } = make();
    ad.arm('sleep'); ad.noteStart('a'); ad.noteEnd('a', 'cancelled', true);
    vi.advanceTimersByTime(COUNTDOWN_MS * 2);
    expect(run).not.toHaveBeenCalled();
    expect(ad.state().armed).toBe(true);
  });
  it('when the person cancels during the countdown', () => {
    const { ad, run, kinds } = make();
    ad.arm('shutdown'); ad.noteStart('a'); ad.noteEnd('a', 'completed');
    vi.advanceTimersByTime(30 * 1000);
    ad.cancel();
    vi.advanceTimersByTime(COUNTDOWN_MS * 2);
    expect(run).not.toHaveBeenCalled();
    expect(ad.state().armed).toBe(false);
    expect(kinds()).toContain('disarmed');
  });
  it('when Vex quits (dispose) - during the countdown or while waiting', () => {
    const a = make();
    a.ad.arm('shutdown'); a.ad.noteStart('x'); a.ad.noteEnd('x', 'completed');
    a.ad.dispose();
    vi.advanceTimersByTime(COUNTDOWN_MS * 2);
    expect(a.run).not.toHaveBeenCalled();
    const b = make();
    b.ad.arm('shutdown'); b.ad.dispose();
    b.ad.noteStart('y'); b.ad.noteEnd('y', 'completed');
    vi.advanceTimersByTime(COUNTDOWN_MS * 2);
    expect(b.run).not.toHaveBeenCalled();
  });
  it('after 12 hours it disarms itself and says so, even mid-download', () => {
    const { ad, run, events } = make();
    ad.arm('shutdown'); ad.noteStart('slow');
    vi.advanceTimersByTime(ARM_TTL_MS);
    expect(ad.state().armed).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: 'disarmed', why: 'expired' });
    ad.noteEnd('slow', 'completed');
    vi.advanceTimersByTime(COUNTDOWN_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('a new download during the countdown restarts the wait', () => {
  it('cancels the pending fire, then counts a fresh 60 s once everything is done again', () => {
    const { ad, run, kinds } = make();
    ad.arm('sleep'); ad.noteStart('a'); ad.noteEnd('a', 'completed');
    vi.advanceTimersByTime(45 * 1000);
    ad.noteStart('b');
    expect(ad.state().phase).toBe('waiting');
    expect(kinds()).toContain('restarted');
    vi.advanceTimersByTime(COUNTDOWN_MS * 2);
    expect(run).not.toHaveBeenCalled();
    ad.noteEnd('b', 'completed');
    expect(ad.state().phase).toBe('countdown');
    vi.advanceTimersByTime(COUNTDOWN_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('arming', () => {
  it('only sleep or shutdown, and only where the command exists', () => {
    expect(() => make().ad.arm('reboot')).toThrow(/sleep or shut down/);
    expect(() => make().ad.arm(undefined)).toThrow();
    expect(() => make({ platform: 'linux' }).ad.arm('sleep')).toThrow(/only available on Windows/);
  });
  it('arming again starts over (a fresh 12 hours, a clean batch)', () => {
    const { ad, run } = make();
    ad.arm('sleep'); ad.noteStart('a'); ad.noteEnd('a', 'interrupted'); // blocked and disarmed
    ad.arm('shutdown');
    expect(ad.state()).toMatchObject({ armed: true, action: 'shutdown', failed: 0 });
    ad.noteStart('b'); ad.noteEnd('b', 'completed');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(run).toHaveBeenCalledWith('shutdown');
  });
  it('disarm() puts it back to do-nothing', () => {
    const { ad } = make();
    ad.arm('sleep'); ad.disarm();
    expect(ad.state().armed).toBe(false);
  });
});

describe('the runner', () => {
  it('a runner that throws is reported, and cannot run twice', () => {
    const run = vi.fn(() => { throw new Error('no permission'); });
    const events = [];
    const ad = createAfterDownloads({ run, notify: (e) => events.push(e), platform: 'win32' });
    ad.arm('shutdown'); ad.noteStart('a'); ad.noteEnd('a', 'completed');
    vi.advanceTimersByTime(COUNTDOWN_MS * 3);
    expect(run).toHaveBeenCalledTimes(1);
    expect(events.find(e => e.kind === 'error')).toMatchObject({ message: 'no permission' });
    expect(ad.state().armed).toBe(false);
  });
  it('needs a runner', () => {
    expect(() => createAfterDownloads({})).toThrow(/runner/);
  });
});

describe('the Windows commands (argument arrays, no shell string), with a fake spawn', () => {
  it('sleep and shutdown commands', () => {
    expect(commandFor('sleep', 'win32')).toEqual({ file: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] });
    expect(commandFor('shutdown', 'win32')).toEqual({ file: 'shutdown', args: ['/s', '/t', '0'] });
  });
  it('refuses other actions and other systems', () => {
    expect(() => commandFor('hibernate', 'win32')).toThrow(/Unknown action/);
    expect(() => commandFor('shutdown', 'darwin')).toThrow(/only available on Windows/);
  });
  it('the runner passes an argument list with shell off and reports a spawn error', () => {
    const child = { on: vi.fn(), unref: vi.fn() };
    const spawn = vi.fn(() => child);
    const onError = vi.fn();
    const run = createCommandRunner({ spawn, platform: 'win32', onError });
    run('shutdown');
    expect(spawn).toHaveBeenCalledWith('shutdown', ['/s', '/t', '0'], expect.objectContaining({ shell: false, detached: true }));
    expect(Array.isArray(spawn.mock.calls[0][1])).toBe(true);
    const handler = child.on.mock.calls.find(c => c[0] === 'error')[1];
    handler(new Error('ENOENT'));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'ENOENT' }), 'shutdown');
  });
  it('the runner refuses off Windows before spawning anything', () => {
    const spawn = vi.fn();
    expect(() => createCommandRunner({ spawn, platform: 'linux' })('sleep')).toThrow(/only available on Windows/);
    expect(spawn).not.toHaveBeenCalled();
    expect(() => createCommandRunner({})).toThrow(/spawn/);
  });
});

describe('wiring', () => {
  const fsx = require('fs');
  const path = require('path');
  const read = (f) => fsx.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('downloads.js reports the start and the end (with how it ended and whether the person cancelled it)', () => {
    const src = read('src/main/downloads.js');
    expect(src).toMatch(/onLifecycle\(\{ type: 'start', id: info\.id \}\)/);
    expect(src).toMatch(/onLifecycle\(\{ type: 'end', id: info\.id, state, byPerson \}\)/);
  });
  it('main.js feeds the machine, disarms it at quit and only ever uses the injected runner', () => {
    const main = read('src/main.js');
    expect(main).toMatch(/_afterDl\.noteStart\(e\.id\)/);
    expect(main).toMatch(/_afterDl\.noteEnd\(e\.id, e\.state, !!e\.byPerson\)/);
    expect(main).toMatch(/app\.on\('before-quit', \(\) => _afterDl\.dispose\(\)\)/);
    expect(main).toMatch(/createCommandRunner\(\{ spawn: require\('child_process'\)\.spawn/);
  });
  it('the module has no shell string and no exec', () => {
    const src = read('src/main/after-downloads.js').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bexec(Sync)?\(|shell:\s*true/);
  });
  it('it is never saved: no file or store is touched', () => {
    const src = read('src/main/after-downloads.js');
    expect(src).not.toMatch(/writeFile|JsonStore|localStorage/);
  });
});
