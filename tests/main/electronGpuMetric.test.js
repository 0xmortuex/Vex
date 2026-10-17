// T3-024 (Wave 6): the per-panel graphics figure needs Electron to report graphics use per process. It does not (checked
// against the installed Electron typings), so the panel guard shows one figure for the one graphics process and never
// divides it among panels. If a later Electron adds a per-process graphics field, this test fails and says to build it.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const dts = path.resolve(__dirname, '../../node_modules/electron/electron.d.ts');
const have = fs.existsSync(dts);

describe.skipIf(!have)('Electron process metrics', () => {
  const text = have ? fs.readFileSync(dts, 'utf8') : '';
  const block = (name) => { const i = text.indexOf('interface ' + name + ' {'); return i < 0 ? '' : text.slice(i, text.indexOf('\n  }', i)); };
  const fields = (b) => [...b.matchAll(/^\s{4}([A-Za-z]+)\??:/gm)].map(m => m[1]);

  it('app.getAppMetrics() reports cpu, memory and identity per process, and no graphics figure', () => {
    const pm = fields(block('ProcessMetric'));
    expect(pm.length).toBeGreaterThan(5);
    expect(pm).toEqual(expect.arrayContaining(['cpu', 'memory', 'pid', 'type']));
    expect(pm.filter(f => /gpu|graphics|vram/i.test(f))).toEqual([]);
  });

  it('the memory and cpu records carry no graphics memory either', () => {
    expect(fields(block('MemoryInfo')).filter(f => /gpu|graphics|vram/i.test(f))).toEqual([]);
    expect(fields(block('CPUUsage')).filter(f => /gpu|graphics|vram/i.test(f))).toEqual([]);
  });
});
