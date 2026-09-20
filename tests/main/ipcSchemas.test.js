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
it('a cookie change names a real page, and a real cookie on it', () => {
  const ref = { url: 'https://example.com/', partition: 'persist:main', name: 'sid', domain: '.example.com', path: '/' };
  expect(() => validate('cookies:list', [{ url: 'https://example.com/' }])).not.toThrow();
  expect(() => validate('cookies:remove', [ref])).not.toThrow();
  expect(() => validate('cookies:set', [{ ...ref, value: 'x', expires: 1790000000000 }])).not.toThrow();
  expect(() => validate('cookies:set', [{ ...ref, value: 'x', expires: -1 }])).toThrow();
  expect(() => validate('cookies:remove', [{ ...ref, name: 42 }])).toThrow();
  expect(() => validate('cookies:list', [{ url: 'file:///C:/secret' }])).toThrow();
});
