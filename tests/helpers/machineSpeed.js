// How slow is this machine right now, for tests that must keep a time ceiling.
//
// The project's CI runner is a shared 2-core Windows machine, about three times slower than the development PC, and
// the tests run four at a time on it, so a fixed "must finish in 100 ms" ceiling fails there although nothing got
// slower in the product. A ceiling is scaled by this factor instead: a fixed piece of plain string work is timed
// three times (the fastest run counts, so one stall does not decide it) and compared with the 14 ms it takes on the
// development PC. The factor never goes below 1 (a normal PC keeps the original ceiling) and is capped at 12, so a
// real regression (an algorithm that went quadratic is a hundred times slower, not three) still fails.
//
// Usage:   const before = machineFactor();   ...timed work...   expect(ms).toBeLessThan(ceiling(100, before));
// ceiling() reads the machine again AFTER the work and takes the slower of the two readings, because a runner that
// was calm for the first reading and busy during the work is the case that failed before.
export function machineFactor() {
  const words = Array.from({ length: 20000 }, (_, i) => 'w' + (i % 97) + ' x' + i);
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    let hits = 0;
    for (let r = 0; r < 40; r++) for (let i = 0; i < words.length; i++) if (words[i].toLowerCase().indexOf('a') >= 0) hits++;
    best = Math.min(best, performance.now() - t0);
    if (hits < 0) throw new Error('unreachable');
  }
  return Math.max(1, best / 14);
}

export function ceiling(baseMs, before = 1) {
  return baseMs * Math.min(12, Math.max(1, before, machineFactor()));
}
