import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const R = createRequire(import.meta.url)('../../src/renderer/js/sync-records.js');
it('rejects prototype keys and malformed revisions from imported documents', () => {
  expect(() => R.valid(JSON.parse('{"schema":2,"records":{"__proto__":{"clock":{},"deleted":false}}}'))).toThrow();
  expect(() => R.capture(R.empty(), {}, 'constructor')).toThrow();
  expect(() => R.valid({ schema: 2, records: { a: { clock: [], deleted: false } } })).toThrow();
});
it('preserves inconsistent equal-revision edits and converges', () => {
  const a = R.capture(R.empty(), { a: 'first' }, 'A');
  const b = R.capture(R.empty(), { a: 'second' }, 'A');
  expect(R.merge(a, b)).toEqual(R.merge(b, a));
  expect(R.merge(a, b).records.a.conflicts).toHaveLength(2);
});
it('orders concurrent array insertions consistently', () => {
  const a = R.capture(R.empty(), R.flatten({ tabs: [{ id: 'a' }] }), 'A');
  const b = R.capture(R.empty(), R.flatten({ tabs: [{ id: 'b' }] }), 'B');
  expect(R.unflatten(R.values(R.merge(a,b)))).toEqual(R.unflatten(R.values(R.merge(b,a))));
});
it('merges independent edits and propagates tombstones', () => {
  const base = R.capture(R.empty(), { a: 1, b: 2 }, 'A');
  const left = R.capture(base, { a: 3, b: 2 }, 'A');
  const right = R.capture(base, { a: 1 }, 'B');
  expect(R.values(R.merge(left, right))).toEqual({ a: 3 });
  expect(R.values(R.merge(right, left))).toEqual({ a: 3 });
});
it('preserves both concurrent versions and converges regardless of merge order', () => {
  const base = R.capture(R.empty(), { a: 'original' }, 'A');
  const left = R.capture(base, { a: 'left' }, 'A');
  const right = R.capture(base, { a: 'right' }, 'B');
  const merged = R.merge(left, right);
  expect(merged.records.a.conflicts.map(x => x.value)).toEqual(['left','right']);
  expect(R.values(merged)).toEqual(R.values(R.merge(right,left)));
  expect(R.merge(merged, left)).toEqual(merged);
});
it('round-trips authoritative arrays and scalar strings without altering preference encoding', () => {
  const source = { 'storage:tabs': [{ id: 'tab1', url: 'https://a.test' }], 'preference:vex.agentMode': 'auto', 'preference:vex.bookmarks': [], 'storage:theme': null };
  expect(R.unflatten(R.flatten(source))).toEqual(source);
});
