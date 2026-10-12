// @vitest-environment jsdom
// Web panels showed nothing while their page loaded; Roblox Hub sat white for
// 20s (walkthrough M7, 2026-10-07). A bar runs while the page loads, and a
// spinner with the panel's name covers the first load until the page's
// document is ready (8s after it arrives at the latest).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

function fakeWebview() {
  const wv = document.createElement('webview');
  return wv;
}
const fire = (wv, type, props = {}) => { const e = new Event(type); Object.assign(e, props); wv.dispatchEvent(e); };

let panel, wv;
beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '<div class="panel" id="panel-roblox"></div>';
  panel = document.getElementById('panel-roblox');
  wv = fakeWebview();
  panel.appendChild(wv);
  vi.spyOn(SidebarManager, 'panelLabel').mockReturnValue('Roblox Hub');
});

describe('a web panel loading', () => {
  it('shows the bar and the named spinner until the document is ready, then the bar until loading stops', () => {
    SidebarManager._wirePanelLoading(panel, wv, 'roblox');
    expect(panel.querySelector('.panel-loading-label').textContent).toBe('Loading Roblox Hub…');
    expect(panel.classList.contains('panel-is-loading')).toBe(true);
    expect(panel.classList.contains('panel-first-load')).toBe(true);
    fire(wv, 'dom-ready');
    expect(panel.classList.contains('panel-first-load')).toBe(false);
    expect(panel.classList.contains('panel-is-loading')).toBe(true);
    fire(wv, 'did-stop-loading');
    expect(panel.classList.contains('panel-is-loading')).toBe(false);
    fire(wv, 'did-start-loading');
    expect(panel.classList.contains('panel-is-loading')).toBe(true);
    expect(panel.classList.contains('panel-first-load')).toBe(false);   // only the first load is covered
  });

  it('a failed load clears it, an aborted one (-3) does not', () => {
    SidebarManager._wirePanelLoading(panel, wv, 'roblox');
    fire(wv, 'did-fail-load', { isMainFrame: true, errorCode: -3 });
    expect(panel.classList.contains('panel-is-loading')).toBe(true);
    fire(wv, 'did-fail-load', { isMainFrame: true, errorCode: -105 });
    expect(panel.classList.contains('panel-is-loading')).toBe(false);
    expect(panel.classList.contains('panel-first-load')).toBe(false);
  });

  it('the cover lifts 8s after the page arrives even if its document is still loading', () => {
    vi.useFakeTimers();
    SidebarManager._wirePanelLoading(panel, wv, 'roblox');
    fire(wv, 'did-navigate');
    vi.advanceTimersByTime(7900);
    expect(panel.classList.contains('panel-first-load')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(panel.classList.contains('panel-first-load')).toBe(false);
    expect(panel.classList.contains('panel-is-loading')).toBe(true);
    vi.useRealTimers();
  });

  it('a webview that was replaced (slept, re-created) no longer drives the panel; one indicator per panel', () => {
    SidebarManager._wirePanelLoading(panel, wv, 'roblox');
    const next = fakeWebview();
    wv.remove(); panel.appendChild(next);
    SidebarManager._wirePanelLoading(panel, next, 'roblox');
    fire(wv, 'did-stop-loading');
    expect(panel.classList.contains('panel-is-loading')).toBe(true);
    expect(panel.querySelectorAll('.panel-loading')).toHaveLength(1);
  });

  it('the CSS never lets it take a click', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/css/sidebar.css'), 'utf8');
    expect(css).toMatch(/\.panel > \.panel-loading \{[^}]*pointer-events: none/);
  });
});
