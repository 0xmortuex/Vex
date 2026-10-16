import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { validate, schemas } = require('../../src/main/ipc-schemas.js');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

const CHANNELS = ['packs:list', 'packs:items', 'packs:pick-file', 'packs:preview', 'packs:install', 'packs:discard', 'packs:set-enabled',
  'packs:uninstall', 'packs:set-global', 'packs:trust-key', 'packs:untrust-key', 'packs:generate-key', 'packs:export'];

describe('pack IPC wiring', () => {
  it('every channel has a schema, is UI-only, is closed in a private window and has a handler and a preload entry', () => {
    const policy = read('src/main/ipc-policy.js');
    const priv = new RegExp(policy.match(/const PRIVATE_DISABLED = \/(.*)\/;/)[1]);
    const main = read('src/main.js');
    for (const ch of CHANNELS) {
      expect(schemas.has(ch), ch + ' schema').toBe(true);
      expect(UI_ONLY_CHANNELS.has(ch), ch + ' ui-only').toBe(true);
      expect(priv.test(ch), ch + ' private').toBe(true);
      expect(main).toContain("ipcMain.handle('" + ch + "'");
      expect(read('src/preload.js')).toContain("'" + ch + "'");
    }
  });
  it('payload contracts refuse the wrong shapes', () => {
    expect(() => validate('packs:install', ['not-a-token'])).toThrow();
    expect(() => validate('packs:install', ['0'.repeat(32)])).not.toThrow();
    expect(() => validate('packs:set-enabled', ['../x', true])).toThrow();
    expect(() => validate('packs:uninstall', ['..\\evil'])).toThrow();
    expect(() => validate('packs:preview', [{ a: 1 }])).toThrow();
    expect(() => validate('packs:preview', ['x'.repeat(300001)])).toThrow();
    expect(() => validate('packs:list', ['extra'])).toThrow();
    expect(() => validate('packs:export', [{ id: 'a-b-c', name: 'n', authorName: 'a', sign: true, items: [] }])).toThrow();
    expect(() => validate('packs:export', [{ id: 'a-b-c', name: 'n', authorName: 'a', sign: true, items: ['x'] }])).toThrow();
    expect(() => validate('packs:export', [{ id: 'a-b-c', name: 'n', authorName: 'a', sign: true, items: [{ type: 'theme' }] }])).not.toThrow();
  });
  it('there is no install-from-address path', () => {
    const preload = read('src/preload.js');
    const start = preload.indexOf('packs: {');
    const block = preload.slice(start, preload.indexOf('\n});', start));
    expect(block).not.toMatch(/url|fetch|http/i);
    for (const ch of CHANNELS) expect(ch).not.toMatch(/url|fetch/);
  });
});

describe('built-in packs are wired in main only', () => {
  it('main loads them from the app folder through the loader and hands them to the store', () => {
    const main = read('src/main.js');
    expect(main).toContain("require('./main/packs-builtin').loadBuiltinPacks({ fs: _packsFs })");
    expect(main).toContain('builtins: _builtinPacks');
  });
  it('no channel lets the window name a built-in file or send one', () => {
    const preload = read('src/preload.js');
    const start = preload.indexOf('packs: {');
    const block = preload.slice(start, preload.indexOf('\n});', start));
    expect(block).not.toMatch(/builtin/i);
  });
});

describe('no code is ever made from pack content', () => {
  const FILES = ['src/main/packs.js', 'src/main/packs-store.js', 'src/main/packs-builtin.js', 'src/renderer/js/packs-ui.js', 'src/renderer/js/packs-consumers.js', 'src/renderer/js/pack-content.js'];
  for (const f of FILES) {
    it(f + ' has no eval, Function, dynamic import, script injection or markup built from pack text', () => {
      const src = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src).not.toMatch(/\beval\s*\(/);
      expect(src).not.toMatch(/\bnew\s+Function\b|\bFunction\s*\(/);
      expect(src).not.toMatch(/\bimport\s*\(/);
      expect(src).not.toMatch(/executeJavaScript|insertCSS|setTimeout\s*\(\s*['"`]/);
      expect(src).not.toMatch(/\brequire\s*\(\s*[^'"\s)]/);
      expect(src).not.toMatch(/require\(\s*['\"](?:node:)?(?:net|http|https|http2|child_process|vm|dns|tls|worker_threads|electron)['\"]\s*\)|\bfetch\s*\(/);
    });
  }
  it('the consumers hand pack data over through setters and never write it as markup', () => {
    const src = read('src/renderer/js/packs-consumers.js');
    expect(src).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document.write|localStorage/);
  });
  it('the manager writes pack text only with textContent and puts only icons in innerHTML', () => {
    const src = read('src/renderer/js/packs-ui.js');
    const uses = src.match(/innerHTML\s*=.*$/gm) || [];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/this\._icon\(/);
    expect(src).not.toMatch(/insertAdjacentHTML|outerHTML|document\.write/);
  });
});
