// The built-in PDF viewer is an extension frame (chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html) inside the page, and the session
// preloads run in it too. Patching its world, or giving it Vex's chrome.* stand-ins, left every PDF a blank dark page (2026-10-24).
import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const PDF_VIEWER_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8').replace(/\r\n/g, '\n');

// Runs site-tweaks.js as a preload would, in a frame at `href`, and says whether it patched the page.
function patchesPageAt(protocol, host) {
  const executeJavaScript = vi.fn(() => Promise.resolve());
  const electron = { ipcRenderer: { sendSync: () => ({}) }, webFrame: { executeJavaScript } };
  const sandbox = {
    document: { documentElement: { appendChild() {} }, addEventListener() {} },
    location: { protocol, host, hostname: host },
    require: (name) => { if (name === 'electron') return electron; throw new Error('only electron resolves in a sandboxed preload'); },
    module: { exports: {} },
    console,
  };
  vm.runInNewContext(read('site-tweaks.js'), sandbox);
  return executeJavaScript.mock.calls.length > 0;
}

describe('the PDF viewer frame is left alone by the guest preloads', () => {
  it('site-tweaks patches an ordinary page (hide-web-push is for every host)', () => {
    expect(patchesPageAt('https:', 'example.com')).toBe(true);
  });

  it('site-tweaks does not patch the PDF viewer frame', () => {
    expect(patchesPageAt('chrome-extension:', PDF_VIEWER_ID)).toBe(false);
  });

  it('preload-webview stops before anything else in the PDF viewer frame, and only there', () => {
    const src = read('preload-webview.js');
    const guard = src.indexOf("location.protocol === 'chrome-extension:' && location.host === '" + PDF_VIEWER_ID + "') return;");
    expect(guard).toBeGreaterThan(-1);
    // Before the first statement that does anything, and before the extension stand-ins.
    expect(guard).toBeLessThan(src.indexOf('vexStorageSyncShim'));
    expect(guard).toBeLessThan(src.indexOf("location.protocol === 'chrome-extension:') {"));
    // Other extension pages (popups, options) still get their stand-ins.
    expect(src).toContain("if (location.protocol === 'chrome-extension:') {");
  });
});
