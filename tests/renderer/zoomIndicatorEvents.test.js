// @vitest-environment jsdom
//
// The zoom pill in the address bar polled the page's zoom every second, all
// day, for a pill that is almost always hidden. It now follows events: every
// place Vex sets a zoom says vex:zoom-changed, and a tab switch or navigation
// (Chromium keeps one zoom per site) makes it look again.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fresh = (p) => { const r = require.resolve(path.join(ROOT, p)); delete require.cache[r]; return require(r); };

let z, ZI, pill;
beforeEach(() => {
  document.body.innerHTML = '<div id="url-bar"><input id="url-input"><button id="btn-copy-url"></button></div>';
  z = 1;
  const wv = document.createElement('div');
  wv.getZoomFactor = () => z;
  document.body.appendChild(wv);
  globalThis.WebviewManager = { getActiveWebview: () => wv, zoomReset: vi.fn(() => { z = 1; }) };
  globalThis.VexJobs = { every: vi.fn() };
  ZI = fresh('src/renderer/js/zoom-indicator.js');
  pill = document.getElementById('url-zoom');
});

describe('the zoom pill', () => {
  it('runs no timer', () => {
    expect(VexJobs.every).not.toHaveBeenCalled();
  });

  it('shows a zoom Vex set, as soon as it is set', () => {
    expect(pill.hidden).toBe(true);
    z = 1.25;
    document.dispatchEvent(new CustomEvent('vex:zoom-changed'));
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe('125%');
  });

  it('follows a tab switch and a navigation', () => {
    z = 1.5;
    window.dispatchEvent(new CustomEvent('vex:tab-activated', { detail: { tabId: 2 } }));
    expect(pill.textContent).toBe('150%');
    z = 1;
    document.dispatchEvent(new CustomEvent('vex:tab-navigated', { detail: { tabId: 2 } }));
    expect(pill.hidden).toBe(true);
  });

  it('every place Vex sets a page zoom announces it', () => {
    const wvSrc = read('src/renderer/js/webview.js');
    expect(wvSrc).toMatch(/_saveZoom\(wv, zoom\) \{\r?\n[^\n]*\n\s*document\.dispatchEvent\(new CustomEvent\('vex:zoom-changed'\)\);/);
    expect(wvSrc).toMatch(/webview\.setZoomFactor\(zooms\[host\]\); document\.dispatchEvent\(new CustomEvent\('vex:zoom-changed'\)\);/);
    const sp = read('src/renderer/js/site-profiles.js');
    expect((sp.match(/setZoomFactor\([^)]*\);\s*document\.dispatchEvent\(new CustomEvent\('vex:zoom-changed'\)\)/g) || []).length).toBe(2);
  });
});
