// @vitest-environment jsdom
//
// T3-110 (Wave 6): the window side of "Scan now". Off until switched on; sends only a source and a download's path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
let S, calls, reply, notes, shown;

beforeEach(() => {
  const p = path.join(JS, 'download-safety.js'); delete require.cache[require.resolve(p)];
  S = require(p).VexDefenderShortcut;
  localStorage.clear();
  calls = []; shown = [];
  reply = { ok: true, clean: true, threat: false, exitCode: 0, file: 'setup.exe', text: 'found no threats' };
  notes = [];
  globalThis.VexLedger = { note: (l) => notes.push(l) };
  window.vex = { downloadsDefenderScan: async (r) => { calls.push(r); return reply; } };
  window.vexConfirm = async (o) => { shown.push(o); return true; };
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
});
afterEach(() => { delete window.vex; delete window.vexConfirm; delete globalThis.VexLedger; });

describe('T3-110 Scan now (window side)', () => {
  it('is off by default and the button is not offered until it is on', () => {
    expect(S.scanEnabled()).toBe(false);
    expect(S.offersScan('setup.exe')).toBe(false);
    S.setScanEnabled(true);
    expect(S.offersScan('setup.exe')).toBe(true);
    expect(S.offersScan('photo.png')).toBe(false);
  });

  it('refuses to call main while off', async () => {
    await expect(S.scan('download', 'C:\\d\\setup.exe')).rejects.toThrow(/switched off/);
    expect(calls).toHaveLength(0);
  });

  it('sends only the source and the download path, shows the words, and notes one ledger line', async () => {
    S.setScanEnabled(true);
    await S.scan('download', 'C:\\d\\setup.exe');
    expect(calls).toEqual([{ source: 'download', path: 'C:\\d\\setup.exe' }]);
    expect(shown[0].message).toBe('Defender found no threat in setup.exe.\n\nfound no threats');
    expect(notes[0]).toMatchObject({ feature: 'defender-shortcut' });
    await S.scan('pick', 'C:\\ignored.exe');
    expect(calls[1]).toEqual({ source: 'pick' });
  });

  it('says so when Defender reports a threat, and passes on an error from main', async () => {
    S.setScanEnabled(true);
    reply = { ok: true, clean: false, threat: true, exitCode: 2, file: 'x.exe', text: 'Threat: EICAR' };
    await S.scan('download', 'C:\\x.exe');
    expect(shown[0].message).toMatch(/^Defender reports a problem with x.exe/);
    reply = { ok: false, error: 'Only a file Vex downloaded can be scanned' };
    await expect(S.scan('download', 'C:\\y.exe')).rejects.toThrow(/Only a file Vex downloaded/);
  });

  it('a cancelled dialog is quiet', async () => {
    S.setScanEnabled(true); reply = { ok: false, canceled: true };
    expect(await S.scan('pick')).toEqual({ ok: false, canceled: true });
    expect(shown).toHaveLength(0);
  });
});
