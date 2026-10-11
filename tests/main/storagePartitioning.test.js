// @vitest-environment node
//
// EX13: main.js said it switched third-party storage partitioning off for
// Firebase's signInWithRedirect, but the switch had gone (efe7b5c). Vex
// partitions as Chrome does; the comment says so now.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('third-party storage partitioning', () => {
  it('is on, as in Chrome, and the comment no longer says it is switched off', () => {
    expect(MAIN).not.toMatch(/ThirdPartyStoragePartitioning/);
    expect(MAIN).not.toMatch(/Disable Chromium's third-party storage partitioning/);
    expect(MAIN).toMatch(/Third-party storage partitioning is ON, as in Chrome/);
  });
});
