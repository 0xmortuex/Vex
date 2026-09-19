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

// A second of screen recording is a Uint8Array of about a million entries. The
// generic walk treated each byte as a key and refused every chunk with
// "Collection limit exceeded" (seen live) — binary is one block with a size
// limit, and cannot smuggle anything the walk exists to catch.
it('passes binary as one block, inside argument lists too, with a size limit', () => {
  expect(() => C.json(new Uint8Array(1024 * 1024))).not.toThrow();
  expect(() => C.json(['rec-id', new Uint8Array(2 * 1024 * 1024)])).not.toThrow();
  expect(() => C.json(new ArrayBuffer(1024))).not.toThrow();
  expect(() => C.json(new Uint8Array(65 * 1024 * 1024))).toThrow(/Binary limit exceeded/);
});
it('still refuses an ordinary object with too many keys', () => {
  const many = {};
  for (let i = 0; i < 30001; i++) many['k' + i] = 1;
  expect(() => C.json(many)).toThrow(/Collection limit exceeded/);
});
