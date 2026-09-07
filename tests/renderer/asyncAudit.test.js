// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import vm from 'node:vm';
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('does not fill credentials into an origin reached while the vault request was pending', async () => {
  let resolveVault;
  window.vex = { vaultGet: () => new Promise(r => { resolveVault = r; }) };
  const { PasswordVault } = await import('../../src/renderer/js/passwords.js');
  let injected;
  const wv = { executeJavaScript: vi.fn(async js => { injected = js; }) };
  const pending = PasswordVault.autofill(wv, 'https://trusted.test/login');
  resolveVault([{ username: 'person', password: 'secret' }]);
  await pending;
  const querySelector = vi.fn();
  vm.runInNewContext(injected, { location: { origin: 'https://evil.test' }, document: { querySelector }, window: {} });
  expect(querySelector).not.toHaveBeenCalled();
});

it('headless agents report failure when they exhaust their iteration budget', async () => {
  const { AgentLoop } = await import('../../src/renderer/js/agent-loop.js');
  vi.stubGlobal('WebviewManager', { getActiveWebview: () => null });
  vi.stubGlobal('AIRouter', { callAI: async () => ({ result: JSON.stringify({ tool: 'scroll', parameters: {}, intent: 'safe' }) }) });
  vi.stubGlobal('AgentExecutor', { executeTool: async () => ({ ok: true }) });
  const check = expect(AgentLoop.startHeadless('Do something', 'auto', { maxIterations: 1, webview: {} })).rejects.toThrow('without completing');
  await vi.runAllTimersAsync();
  await check;
});

it('failed recovery never starts auto-push and clears the failed enrollment', async () => {
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
  window.vex = { syncSaveKey: vi.fn(), syncSaveMeta: vi.fn(), syncClearState: vi.fn() };
  vi.stubGlobal('SyncCrypto', {
    parseRecoveryCode: x => x, hexToKey: x => x, importKey: async () => ({}),
    decrypt: async () => { throw new Error('Wrong recovery key'); },
  });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ deviceId: 'new', sessionToken: 'token' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ encryptedBlob: 'encrypted', pushedBy: 'old' }) });
  vi.stubGlobal('fetch', fetchMock);
  await import('../../src/renderer/js/sync-engine.js');
  await expect(window.SyncEngine.enrollWithRecoveryCode('a@b.test', '123456', 'a'.repeat(64))).rejects.toThrow('Wrong recovery key');
  expect(window.SyncEngine.isEnabled()).toBe(false);
  expect(window.vex.syncClearState).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('validates a recovery key before consuming an email verification code', async () => {
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
  vi.stubGlobal('SyncCrypto', { parseRecoveryCode: x => x, hexToKey: () => { throw new Error('Invalid key'); } });
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await import('../../src/renderer/js/sync-engine.js');
  await expect(window.SyncEngine.enrollWithRecoveryCode('a@b.test', '123456', 'bad')).rejects.toThrow('Invalid key');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('blocks uploads after restoring a wrong key, even at the current cloud revision', async () => {
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
  window.vex = {
    syncLoadMeta: async () => ({ revision: 8, deviceId: 'same-device', sessionToken: 'token' }),
    syncLoadKey: async () => 'a'.repeat(64),
  };
  vi.stubGlobal('SyncCrypto', {
    hexToKey: x => x, importKey: async () => ({}),
    decrypt: async () => { throw new Error('Wrong key'); },
  });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: 8, pushedBy: 'same-device', encryptedBlob: 'encrypted' }) });
  vi.stubGlobal('fetch', fetchMock);
  await import('../../src/renderer/js/sync-engine.js');
  expect(await window.SyncEngine.initFromDisk()).toBe(true);
  expect((await window.SyncEngine.pushNow()).ok).toBe(false);
  expect((await window.SyncEngine.pullNow()).ok).toBe(false);
  expect((await window.SyncEngine.pushNow()).ok).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
