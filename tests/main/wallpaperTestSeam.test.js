// The Wallpaper Store's test seam (VEX_WALLPAPER_DATA_DIR, VEX_WALLPAPER_TEST_HOSTS) lets a source run read the catalogue from another
// folder and treat named hosts as public. It must be impossible to switch on in an installed build: every read of those variables in
// main.js has to sit behind `!app.isPackaged`, which Electron decides from the binary, not from the environment.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const main = readFileSync(resolve(process.cwd(), 'src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const SEAM_VARS = ['VEX_WALLPAPER_DATA_DIR', 'VEX_WALLPAPER_TEST_HOSTS'];

describe('wallpaper test seam', () => {
  for (const name of SEAM_VARS) {
    it(`${name} is read only when the app is not packaged`, () => {
      const reads = main.split('\n').filter(l => l.includes('process.env.' + name));
      expect(reads.length, `main.js no longer reads ${name}: update this test if the seam moved`).toBeGreaterThan(0);
      for (const line of reads) {
        const before = line.slice(0, line.indexOf('process.env.' + name));
        expect(before, line.trim()).toMatch(/!app\.isPackaged\s*&&\s*$/);
      }
    });
  }

  it('no other source file reads the seam variables', () => {
    const dirs = ['src/main', 'src/renderer/js', 'src'];
    for (const d of dirs) {
      for (const f of readdirSync(resolve(process.cwd(), d)).filter(x => x.endsWith('.js') && x !== 'main.js')) {
        const text = readFileSync(resolve(process.cwd(), d, f), 'utf8');
        for (const name of SEAM_VARS) expect(text.includes(name), `${d}/${f} reads ${name}`).toBe(false);
      }
    }
  });
});
