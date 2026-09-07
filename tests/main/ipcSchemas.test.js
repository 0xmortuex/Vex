import { expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { validate, schemas } = createRequire(import.meta.url)('../../src/main/ipc-schemas.js');
it('declares a payload contract for every public desktop preload operation', () => {
  const source = fs.readFileSync('src/preload.js', 'utf8');
  const channels = [...source.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map(match => match[1]);
  expect(channels.filter(channel => !schemas.has(channel))).toEqual([]);
});
it('rejects malformed privileged requests and unexpected channels', () => {
  expect(() => validate('window-close', ['extra'])).toThrow();
  expect(() => validate('screen-picker:choose', [{ id: 'x', fps: -1 }])).toThrow();
  expect(() => validate('vault:save', [{ host: 'test', username: 'a', password: {} }])).toThrow();
  expect(() => validate('unregistered:write', [])).toThrow();
  expect(() => validate('api:request', [{ url: 'file:///secret' }])).toThrow();
  expect(() => validate('routing:set', ['persist:work', 'proxy', 'http://localhost:8080'])).not.toThrow();
});
