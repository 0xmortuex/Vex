// Settings > About says why "DRM failed" is expected when Vex is run from source (npm start): that build is not
// signed. Both status reads (the first and the re-poll) must pass main's `packaged` flag to the painter.
// This checks the wiring in js/app.js; the line itself was not looked at on screen.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const src = fs.readFileSync('src/renderer/js/app.js', 'utf8');

describe('the DRM status in About', () => {
  it('takes the packaged flag and explains a failure only when the app is not packaged', () => {
    expect(src).toMatch(/const paint = \(s, packaged\) =>/);
    expect(src).toMatch(/failed && packaged === false \? s \+ ' \(expected when run from source/);
  });
  it('passes the flag on the first read and on every re-poll', () => {
    expect(src).toMatch(/paint\(r\?\.status \|\| 'unknown', r\?\.packaged\)/);
    expect(src).toMatch(/paint\(s, r\?\.packaged\)/);
  });
  it('main still reports the flag with the status', () => {
    const main = fs.readFileSync('src/main.js', 'utf8');
    expect(main).toMatch(/ipcMain\.handle\('widevine:status', \(\) => \(\{ status: _widevineStatus, packaged: app\.isPackaged \}\)\)/);
  });
});
