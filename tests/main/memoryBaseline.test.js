// A memory ceiling worked out from the machine. Too low and Vex sleeps tabs
// all day; too high and the ceiling never does anything. These are the shapes
// of machine that matter.
import { describe, it, expect } from 'vitest';
const { suggest, read, MIN_MB, MAX_MB } = require('../../src/main/memory-baseline.js');

const GB = 1024;

describe('what it suggests', () => {
  it('about a tenth of an ordinary machine', () => {
    const out = suggest({ totalMB: 16 * GB, freeMB: 10 * GB });
    expect(out.ceilingMB).toBe(2000);
    expect(out.why).toMatch(/16 GB/);
  });

  it('never so low that Vex would sleep tabs constantly', () => {
    const out = suggest({ totalMB: 4 * GB, freeMB: 3 * GB });
    expect(out.ceilingMB).toBe(MIN_MB);
    expect(out.why).toMatch(/lowest that is still workable/);
  });

  it('never so high that the ceiling stops meaning anything', () => {
    const out = suggest({ totalMB: 64 * GB, freeMB: 50 * GB });
    expect(out.ceilingMB).toBe(MAX_MB);
  });

  it('a machine already short of memory gets a ceiling from what is spare', () => {
    const out = suggest({ totalMB: 16 * GB, freeMB: 2 * GB });
    expect(out.ceilingMB).toBe(1000);
    expect(out.why).toMatch(/free right now/);
  });

  it('even when memory is tight it does not go below workable', () => {
    expect(suggest({ totalMB: 8 * GB, freeMB: 300 }).ceilingMB).toBe(MIN_MB);
  });

  it('a machine that says nothing keeps the ordinary ceiling', () => {
    const out = suggest({ totalMB: 0, freeMB: 0 });
    expect(out.ceilingMB).toBe(1200);
    expect(out.why).toMatch(/did not say/);
  });
});

describe('reading the machine', () => {
  it('in megabytes, from the numbers the system gives', () => {
    const os = { totalmem: () => 16 * 1024 * 1024 * 1024, freemem: () => 4 * 1024 * 1024 * 1024 };
    expect(read(os)).toEqual({ totalMB: 16384, freeMB: 4096 });
  });
});
