// Every `A.api(G.Something, ...)` entry in the usage registry reads a global through a thunk in the G table. An entry whose thunk was never
// written is not caught by the other tests, and in the app it logs "could not be set up: thunk is not a function" and the feature's
// on/off state is unknown to the registry (found in the real app after five viewers were merged, 2026-10-25).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/vex-usage-registry.js'), 'utf8');

describe('the usage registry\'s global thunks', () => {
  it('has a thunk in the G table for every global an A.api entry names', () => {
    const used = [...new Set([...src.matchAll(/A\.api\(G\.([A-Za-z0-9_]+),/g)].map(m => m[1]))];
    expect(used.length).toBeGreaterThan(20);
    const missing = used.filter(name => !new RegExp('\\b' + name + ': \\(\\) =>').test(src));
    expect(missing, 'A.api entries with no thunk in the G table').toEqual([]);
  });
});
