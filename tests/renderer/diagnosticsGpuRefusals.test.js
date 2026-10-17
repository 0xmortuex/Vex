// @vitest-environment jsdom
//
// T3-012: the diagnostics bundle names the graphics card and the last messages the IPC policy refused,
// redacted like the rest, and the policy keeps a bounded list of refusals without ever storing a payload.
import { describe, it, expect, beforeEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

describe('diagnostics bundle: graphics and refused messages', () => {
  beforeEach(() => { globalThis.VexReport = fresh(JS + 'report-problem.js').VexReport; });

  it('lists the card, what Chromium accelerates and the refusals, with addresses scrubbed', () => {
    const { VexDiagBundle: D } = fresh(JS + 'diagnostics-bundle.js');
    const text = D.build({
      now: Date.UTC(2026, 9, 16, 12, 0),
      env: { version: '1' },
      gpu: { name: 'NVIDIA GeForce RTX 4060', utilization: 92, usedMB: 7708, totalMB: 8188, freeMB: 480, usedPercent: 94 },
      gpuFeatures: { webgl: 'enabled', video_decode: 'enabled_on' },
      ipcRefusals: [{ at: Date.UTC(2026, 9, 16, 11, 0), channel: 'vault:list', reason: 'Untrusted IPC sender https://evil.example/x?token=abc' }],
    });
    expect(text).toContain('## Graphics');
    expect(text).toContain('NVIDIA GeForce RTX 4060, 7708 of 8188 MB in use (94%), 92% busy');
    expect(text).toContain('webgl enabled');
    expect(text).toContain('## Messages Vex refused (1 newest)');
    expect(text).toContain('vault:list: Untrusted IPC sender');
    expect(text).not.toContain('evil.example');
    expect(text).not.toContain('token=abc');
  });

  it('says plainly when there is no card reading and no refusal', () => {
    const { VexDiagBundle: D } = fresh(JS + 'diagnostics-bundle.js');
    const text = D.build({ env: { version: '1' } });
    expect(text).toContain('No NVIDIA card was reported');
    expect(text).toMatch(/## Messages Vex refused \(0 newest\)\n- None\./);
  });
});

describe('the IPC policy keeps its refusals', () => {
  const policy = require('../../src/main/ipc-policy.js');
  function setup() {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
    policy.installIpcPolicy(ipcMain, { isUiFrame: () => false, owner: () => null, isAuxiliary: () => false, ownsTarget: () => true });
    ipcMain.handle('vault:list', () => 'ok');
    return (ch, ...args) => handlers.get(ch)({ sender: {}, senderFrame: { url: 'https://evil.example/' } }, ...args);
  }

  it('records the channel and the reason of a refused invoke, and nothing else', async () => {
    const call = setup();
    await expect(call('vault:list')).rejects.toThrow('Untrusted IPC sender');
    const first = policy.recentRefusals()[0];
    expect(first).toMatchObject({ channel: 'vault:list', reason: 'Untrusted IPC sender' });
    expect(Object.keys(first).sort()).toEqual(['at', 'channel', 'reason']);
  });

  it('is bounded and newest first', () => {
    for (let i = 0; i < 80; i++) policy.noteRefusal('c' + i, new Error('r'));
    const list = policy.recentRefusals();
    expect(list).toHaveLength(50);
    expect(list[0].channel).toBe('c79');
  });
});
