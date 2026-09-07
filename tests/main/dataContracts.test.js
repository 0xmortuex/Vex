import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../../src/renderer/js/data-contracts.js');
it('rejects unsafe attributes and non-web bookmark URLs before persistence', () => {
  expect(() => C.storage('groups', [{ id: 'g', color: 'red" onclick="alert(1)' }])).toThrow();
  expect(() => C.storage('bookmarks', [{ id: 'a', url: 'javascript:alert(1)' }])).toThrow();
  expect(() => C.storage('tabs', [{ id: 'x" y', url: 'https://test' }])).toThrow();
});
it('validates nested sessions and raw-string sync preferences', () => {
  expect(() => C.sources({ 'preference:vex.sessions': JSON.stringify([{ id: 's', tabs: [{ url: 'data:text/html,evil' }] }]) })).toThrow();
  expect(() => C.storage('sessions', [{ id: 's', tabs: [{ url: 'https://test', partition: 'persist:work', pinned: true }] }])).not.toThrow();
});
