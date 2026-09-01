// Guards the CSP-proof main-world injection that fixed the Adobe "unsupported
// browser" bug (v2.31.14). Strict-CSP sites refuse inline <script> tags, which
// silently dropped the UA / client-hints / window.chrome patches. If a future
// edit reverts a shim to raw <script> injection or drops the "Google Chrome"
// brand, these fail before it ships instead of a user hitting it on Adobe.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');

describe('preload-webview main-world injection is CSP-proof', () => {
  it('defines a runInMainWorld helper backed by contextBridge.executeInMainWorld', () => {
    expect(SRC).toMatch(/function runInMainWorld\s*\(/);
    expect(SRC).toMatch(/executeInMainWorld\s*\(\s*\{\s*func:/);
  });

  it('every shim injects via runInMainWorld, not a raw inline <script>', () => {
    // The only createElement('script') allowed is the helper's own fallback.
    const scriptInjectors = SRC.match(/createElement\(['"]script['"]\)/g) || [];
    expect(scriptInjectors.length).toBe(1);

    // Each shim's inject() must route through runInMainWorld.
    const injectCalls = SRC.match(/function inject\(\)\s*\{[^}]*runInMainWorld\(/g) || [];
    expect(injectCalls.length).toBeGreaterThanOrEqual(2);
    // The fingerprint-farbling shim injects inline (no inject() wrapper).
    expect(SRC).toMatch(/runInMainWorld\(src\)/);
  });

  it('the client-hints shim still adds the "Google Chrome" brand on the prototype', () => {
    expect(SRC).toContain("brand:'Google Chrome'");
    // Must patch the prototype (fresh instance each access) — not an instance.
    expect(SRC).toMatch(/getPrototypeOf\(uad\)/);
    expect(SRC).toMatch(/defineProperty\(proto,\s*['"]brands['"]/);
  });

  it('the helper still keeps a <script>-tag fallback for non-CSP / older builds', () => {
    // Fallback lives inside runInMainWorld so lax pages and builds without the
    // API keep working.
    const helper = SRC.slice(SRC.indexOf('function runInMainWorld'));
    expect(helper).toMatch(/createElement\(['"]script['"]\)/);
    expect(helper).toMatch(/textContent\s*=\s*src/);
  });
});
