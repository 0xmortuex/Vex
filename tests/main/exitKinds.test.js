// Audit B9 (2026-10-10): Windows logging off (0xC000026B), shutting down
// (0xC000013A), Vex quitting and Vex installing an update were written to
// crash-log.json as crashes. They are told apart (src/main/exit-kinds.js);
// a real crash is still a crash.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { createExitWatch } = require('../../src/main/exit-kinds.js');

// Electron reports a Windows status code as a signed 32-bit number.
const signed = (n) => n | 0;

describe('what is not a crash', () => {
  it('Windows logging off or shutting down, at any time', () => {
    const w = createExitWatch();
    expect(w.notACrash({ reason: 'crashed', exitCode: signed(0xC000026B) })).toBe('Windows was logging off');
    expect(w.notACrash({ reason: 'abnormal-exit', exitCode: 0xC000026B })).toBe('Windows was logging off');
    expect(w.notACrash({ reason: 'killed', exitCode: signed(0xC000013A) })).toBe('Windows was ending processes');
  });

  it('processes ended while Vex quits, updates or Windows ends the session', () => {
    const w = createExitWatch();
    expect(w.notACrash({ reason: 'killed', exitCode: 1 })).toBe(null);       // before: a crash
    w.mark('installing an update');
    expect(w.notACrash({ reason: 'killed', exitCode: 1 })).toBe('Vex was installing an update');
    expect(w.notACrash({ reason: 'abnormal-exit', exitCode: 1 })).toBe('Vex was installing an update');
    w.mark('quitting');                                                         // the first reason stays
    expect(w.ending().why).toBe('installing an update');
  });

  it('a page whose own window is closing', () => {
    const w = createExitWatch();
    expect(w.notACrash({ reason: 'killed', exitCode: 1 }, { closing: true })).toBe('its window was closing');
  });
});

describe('what still is a crash', () => {
  it('a crash, out of memory or a failed launch, even while Vex is closing', () => {
    const w = createExitWatch();
    for (const d of [{ reason: 'crashed', exitCode: signed(0xC0000005) }, { reason: 'oom', exitCode: signed(0xE0000008) }, { reason: 'launch-failed', exitCode: 0 }]) {
      expect(w.notACrash(d)).toBe(null);
    }
    w.mark('quitting');
    expect(w.notACrash({ reason: 'crashed', exitCode: signed(0xC0000005) })).toBe(null);
    expect(w.notACrash({ reason: 'oom', exitCode: 1 })).toBe(null);
  });

  it('killed while nothing is closing', () => {
    expect(createExitWatch().notACrash({ reason: 'killed', exitCode: 1 })).toBe(null);
  });
});

describe('main.js', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('marks quitting, the session ending and the main window closing for good', () => {
    expect(MAIN).toContain("app.on('before-quit', () => _exitWatch.mark('quitting'));");
    expect(MAIN).toContain("win.on('session-end', () => _exitWatch.mark(");
    expect(MAIN).toContain("win.on('query-session-end', () => _exitWatch.mark(");
    expect(MAIN).toContain("if (host.win === mainWindow) _exitWatch.mark(_pendingInstall ? 'installing an update' : 'closing');");
  });
  it('asks before writing a helper or a page into the crash log', () => {
    const helper = MAIN.slice(MAIN.indexOf("app.on('child-process-gone'"), MAIN.indexOf("app.on('child-process-gone'") + 500);
    expect(helper.indexOf('_exitWatch.notACrash(d)')).toBeLessThan(helper.indexOf("_diagEvent('helper process gone'"));
    const page = MAIN.slice(MAIN.indexOf("wc.on('render-process-gone'"), MAIN.indexOf("wc.on('render-process-gone'") + 600);
    expect(page.indexOf('_exitWatch.notACrash(d, { closing: !!(host && host.allowClose) })')).toBeGreaterThan(0);
    expect(page.indexOf('_exitWatch.notACrash(')).toBeLessThan(page.indexOf("_diagEvent('page crashed'"));
  });
});
