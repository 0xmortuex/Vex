// @vitest-environment jsdom
//
// The window's side of the Vencord dev reload and the Discord console tray (js/plugin-dev.js, T2-018).
// The main process is a stand-in; nothing is loaded or replaced.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const JS = '../../src/renderer/js/';
let P, bridge;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.vexConfirm = vi.fn(async () => true);
  bridge = {
    devextVencordPick: vi.fn(async () => ({ canceled: false, file: 'C:\\v\\dist\\browser.js', name: 'vencord', version: '1', bytes: 5000, sha256: 'a'.repeat(64) })),
    devextVencordStatus: vi.fn(async () => ({ granted: { file: 'C:\\v\\dist\\browser.js', name: 'vencord', version: '1', bytes: 5000, sha256: 'a'.repeat(64) }, installed: { folder: 'vencord-1', bundle: 'dist/Vencord.js' }, replaced: false, error: '' })),
    devextVencordReload: vi.fn(async () => ({ ok: true, panelsReloaded: 2 })),
    devextVencordRestore: vi.fn(async () => ({ ok: true })),
    devextConsoleStart: vi.fn(async () => ({ on: true })), devextConsoleStop: vi.fn(async () => ({ on: false })), devextConsoleClear: vi.fn(async () => ({})),
    devextConsoleList: vi.fn(async () => ({ state: { on: false }, lines: [] })),
  };
  window.vex = bridge;
  globalThis.DevDeskUtil = fresh(JS + 'dev-desk-util.js').DevDeskUtil;
  P = fresh(JS + 'plugin-dev.js').PluginDev;
  P.setEnabled(true);
});

describe('reload my build', () => {
  it('asks before it replaces anything, and does nothing when the answer is no', async () => {
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await P.vencordReload()).toBeNull();
    expect(bridge.devextVencordReload).not.toHaveBeenCalled();
    expect(globalThis.vexConfirm.mock.calls[0][0].message).toContain('C:\\v\\dist\\browser.js');
  });
  it('reloads through main after a yes, and says how many pages reloaded', async () => {
    const r = await P.vencordReload();
    expect(r.panelsReloaded).toBe(2);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('2 Discord page'));
  });
  it('needs a picked file, and is off with the switch', async () => {
    bridge.devextVencordStatus = vi.fn(async () => ({ granted: null }));
    await expect(P.vencordReload()).rejects.toThrow(/Pick your browser\.js/);
    P.setEnabled(false);
    await expect(P.vencordPick()).rejects.toThrow(/switched off/);
  });
  it('pick returns null when the dialog is cancelled; the path comes from main only', async () => {
    bridge.devextVencordPick = vi.fn(async () => ({ canceled: true }));
    expect(await P.vencordPick()).toBeNull();
    expect(bridge.devextVencordPick).toHaveBeenCalledWith();
  });
  it('putting the original back is confirmed too', async () => {
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await P.vencordRestore()).toBeNull();
    expect(bridge.devextVencordRestore).not.toHaveBeenCalled();
  });
});

describe('console tray text', () => {
  it('is one line per entry with the level and the source', () => {
    const text = P.consoleText([{ t: 0, level: 'error', text: 'boom', source: 'x.js', line: 4 }, { t: 0, level: 'info', text: 'ok', source: '', line: 0 }]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[error] boom (x.js:4)');
    expect(lines[1]).toContain('[info] ok');
  });
});
