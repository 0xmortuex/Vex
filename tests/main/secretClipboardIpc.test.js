// clipboard:write-secret puts a password on the system clipboard, so only
// Vex's own window may use it: never a page, an extension or an auxiliary
// window, even one isAuxiliary would let through.
import { describe, it, expect } from 'vitest';
const { installIpcPolicy, UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { registerSecretClipboard } = require('../../src/main/secret-clipboard.js');

function setup({ ui = false, owner = null, auxiliary = false } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
  installIpcPolicy(ipcMain, { isUiFrame: () => ui, owner: () => owner, isAuxiliary: () => auxiliary, ownsTarget: () => true });
  let text = '';
  const clipboard = { writeText: (t) => { text = t; }, readText: () => text, clear: () => { text = '' } };
  registerSecretClipboard({ ipcMain, clipboard });
  const call = (...args) => handlers.get('clipboard:write-secret')({ sender: {}, senderFrame: { url: 'https://page.example/' } }, ...args);
  return { call, text: () => text };
}

describe('clipboard:write-secret', () => {
  it('works from Vex’s own window', async () => {
    const s = setup({ ui: true, owner: { id: 1 } });
    expect(await s.call('generated-value', 30)).toEqual({ ok: true, seconds: 30 });
    expect(s.text()).toBe('generated-value');
  });

  it('is refused from a page in a tab, and from an auxiliary window', async () => {
    const page = setup({ owner: { id: 1 } });
    await expect(page.call('x')).rejects.toThrow('Untrusted IPC sender');
    const aux = setup({ auxiliary: true });
    await expect(aux.call('x')).rejects.toThrow(/outside Vex’s own window/);
    expect(page.text()).toBe('');
    expect(UI_ONLY_CHANNELS.has('clipboard:write-secret')).toBe(true);
  });

  it('has a schema: a non-empty string and an optional wait of 5–300 s', () => {
    expect(() => validate('clipboard:write-secret', ['abc'])).not.toThrow();
    expect(() => validate('clipboard:write-secret', ['abc', 30])).not.toThrow();
    expect(() => validate('clipboard:write-secret', [''])).toThrow(/Invalid payload/);
    expect(() => validate('clipboard:write-secret', ['abc', 1])).toThrow(/Invalid payload/);
    expect(() => validate('clipboard:write-secret', [{}])).toThrow(/Invalid payload/);
  });
});
