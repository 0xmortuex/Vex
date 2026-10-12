// A 5 s test timeout failed CI for hours on 2026-10-12 (heavy jsdom renders on
// a slow runner). The config must keep a generous default.
import { describe, it, expect } from 'vitest';
const fs = require('node:fs');
const path = require('node:path');

describe('vitest.config.mjs', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'vitest.config.mjs'), 'utf8');

  it('keeps a test timeout of at least 20 s', () => {
    const m = /testTimeout:\s*(\d+)/.exec(text);
    expect(m, 'testTimeout is set').toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(20000);
  });

  it('keeps a hook timeout of at least 20 s', () => {
    const m = /hookTimeout:\s*(\d+)/.exec(text);
    expect(m, 'hookTimeout is set').toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(20000);
  });
});
