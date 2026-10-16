// How passkeys are wired into the rest of Vex: who may call which channel,
// what each channel accepts, which preload runs in a page, and that nothing
// new has to be installed for the packaged app.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');
const { validate } = require('../../src/main/ipc-schemas.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function policy({ ui = false, owner = null } = {}) {
  const handlers = new Map(), listeners = new Map();
  const ipcMain = { handle: (c, f) => handlers.set(c, f), on: (c, f) => listeners.set(c, f) };
  installIpcPolicy(ipcMain, { isUiFrame: () => ui, owner: () => owner, isAuxiliary: () => false, ownsTarget: () => true });
  const reached = [];
  for (const c of ['passkeys:request', 'passkeys:conditional-list', 'passkeys:answer', 'passkeys:list', 'passkeys:delete', 'passkeys:rename', 'passkeys:undo-delete', 'passkeys:conditional-choose']) {
    ipcMain.handle(c, () => { reached.push(c); return 'ok'; });
  }
  ipcMain.on('passkeys:cancel', () => reached.push('passkeys:cancel'));
  const call = (c, ...a) => handlers.get(c)({ sender: {}, senderFrame: { url: 'https://example.com/' } }, ...a);
  return { call, reached, listeners };
}

describe('who may call the passkey channels', () => {
  it('a page in a tab may ask for a passkey, and nothing else', async () => {
    const p = policy({ owner: { id: 1 } });
    expect(await p.call('passkeys:request', { op: 'get' })).toBe('ok');
    expect(await p.call('passkeys:conditional-list', 'abc')).toBe('ok');
    for (const c of ['passkeys:answer', 'passkeys:list', 'passkeys:delete', 'passkeys:rename', 'passkeys:undo-delete', 'passkeys:conditional-choose']) {
      const args = { 'passkeys:answer': ['a', {}], 'passkeys:rename': ['a', 'b'], 'passkeys:conditional-choose': ['a', 'b'], 'passkeys:list': [] }[c] || ['a'];
      await expect(p.call(c, ...args)).rejects.toThrow(/Untrusted IPC sender|outside Vex.s own window/);
    }
    expect(p.reached).toEqual(['passkeys:request', 'passkeys:conditional-list']);
  });
  it('a page that is nobody\'s tab is refused outright', async () => {
    const p = policy();
    await expect(p.call('passkeys:request', { op: 'get' })).rejects.toThrow('Untrusted IPC sender');
  });
  it('Vex\'s own window may manage and answer', async () => {
    const p = policy({ ui: true, owner: { id: 1 } });
    expect(await p.call('passkeys:list')).toBe('ok');
    expect(await p.call('passkeys:answer', 'id', { action: 'cancel' })).toBe('ok');
    expect(await p.call('passkeys:delete', 'cred')).toBe('ok');
  });
  it('a private window cannot list, rename or delete passkeys, but a page there still gets the refusal toast', async () => {
    const p = policy({ ui: true, owner: { id: 1, privatePartition: 'private:1' } });
    for (const c of ['passkeys:list']) await expect(p.call(c)).rejects.toThrow(/private window/);
    await expect(p.call('passkeys:delete', 'x')).rejects.toThrow(/private window/);
    await expect(p.call('passkeys:rename', 'x', 'y')).rejects.toThrow(/private window/);
    await expect(p.call('passkeys:undo-delete', 'x')).rejects.toThrow(/private window/);
    // The request itself is let through so main can say why it was refused.
    expect(await p.call('passkeys:request', { op: 'get' })).toBe('ok');
  });
});

describe('payload contracts', () => {
  it('accepts well-formed calls and refuses wrong shapes', () => {
    expect(() => validate('passkeys:request', [{ op: 'get', id: 'x' }])).not.toThrow();
    expect(() => validate('passkeys:request', ['no'])).toThrow();
    expect(() => validate('passkeys:request', [])).toThrow();
    expect(() => validate('passkeys:list', [])).not.toThrow();
    expect(() => validate('passkeys:list', ['x'])).toThrow();
    expect(() => validate('passkeys:answer', ['id', { action: 'use' }])).not.toThrow();
    expect(() => validate('passkeys:answer', ['id'])).toThrow();
    expect(() => validate('passkeys:conditional-choose', ['id', 'cred'])).not.toThrow();
    expect(() => validate('passkeys:conditional-choose', ['id', 'cred', '2468'])).not.toThrow();
    expect(() => validate('passkeys:conditional-choose', ['id', 'cred', 'x'.repeat(129)])).toThrow();
    expect(() => validate('passkeys:delete', ['x'.repeat(2000)])).toThrow();
    expect(() => validate('sync-secrets-seal', [['passkeys']])).not.toThrow();
    expect(() => validate('sync-secrets-seal', [['passwords', 'authenticator', 'passkeys']])).not.toThrow();
    expect(() => validate('sync-secrets-seal', [['nope']])).toThrow();
  });
});

describe('the page preload', () => {
  it('is registered for every guest session and shipped', () => {
    expect(read('src/main.js')).toMatch(/GUEST_PRELOADS = \[[\s\S]*?path\.join\(__dirname, 'preload-passkeys\.js'\)/);
    expect(JSON.parse(read('package.json')).build.files).toContain('src/**/*');
  });
  it('needs nothing but electron (preloads are sandboxed) and, in main, nothing that is not built in or local', () => {
    const preload = read('src/preload-passkeys.js');
    const requires = [...preload.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]);
    expect(new Set(requires)).toEqual(new Set(['electron']));
    const pkg = JSON.parse(read('package.json'));
    const declared = new Set([...Object.keys(pkg.dependencies || {})]);
    const builtin = new Set(require('module').builtinModules);
    for (const file of ['src/main/passkeys.js', 'src/main/passkey-crypto.js', 'src/main/passkey-policy.js']) {
      for (const m of read(file).matchAll(/require\('([^']+)'\)/g)) {
        const name = m[1];
        expect(name.startsWith('.') || builtin.has(name) || declared.has(name), `${file} requires ${name}`).toBe(true);
      }
    }
  });
  it('the page-world code is self-contained: no free variables from the preload', () => {
    const { vexPasskeyShim } = require('../../src/preload-passkeys.js');
    // Evaluated alone, in a context with only the page globals it expects.
    const vm = require('vm');
    const ctx = vm.createContext({ window: {}, navigator: {} });
    ctx.window = ctx;
    expect(() => vm.runInContext(`(${vexPasskeyShim.toString()})({}, 'vex')`, ctx)).not.toThrow();
  });
});
