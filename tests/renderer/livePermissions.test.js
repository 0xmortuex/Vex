// @vitest-environment jsdom
//
// Two gaps in how Vex handled permissions:
//
//   "Allow" meant for ever or not at all, with the Remember box ticked by
//   default — so agreeing to a microphone for one call agreed to it for good.
//
//   Vex knew which page was using the microphone (it draws the recording
//   badges) and had nowhere to show it and no way to end it: the page had to
//   give it up by itself.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');
require('../../src/renderer/js/permissions-settings.js');
const PermissionsSettings = window.PermissionsSettings;

beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.TabManager = {
    tabs: [
      { id: 't1', title: 'Meet — call', capturing: { mic: true } },
      { id: 't2', title: 'A quiet page' },
    ],
    isCapturing: (t) => !!(t.capturing && (t.capturing.mic || t.capturing.camera)),
  };
  globalThis.SidebarManager = { panelCapture: { discord: { mic: true, camera: true } }, panelLabel: (n) => 'Discord', panelWebviews: {} };
  globalThis.WebviewManager = { webviews: new Map() };
});

describe('what is using the microphone right now', () => {
  it('lists every tab and panel that is capturing, and nothing else', () => {
    expect(PermissionsSettings.liveCaptures()).toEqual([
      { where: 'tab', id: 't1', label: 'Meet — call', mic: true, camera: false },
      { where: 'panel', id: 'discord', label: 'Discord', mic: true, camera: true },
    ]);
  });

  it('shows each one with a way to stop it', () => {
    const host = document.createElement('div');
    PermissionsSettings.renderLive(host);
    const rows = [...host.querySelectorAll('.perm-live-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Microphone');
    expect(rows[0].textContent).toContain('Meet — call');
    expect(rows[1].textContent).toContain('Microphone + Camera');
  });

  it('says so plainly when nothing is', () => {
    globalThis.TabManager.tabs = [];
    globalThis.SidebarManager.panelCapture = {};
    const host = document.createElement('div');
    PermissionsSettings.renderLive(host);
    expect(host.textContent).toContain('Nothing is using your microphone or camera');
  });

  it('Stop reaches the page that is capturing', () => {
    const send = vi.fn();
    globalThis.WebviewManager.webviews.set('t1', { send });
    expect(PermissionsSettings.stopCapture({ where: 'tab', id: 't1', label: 'Meet' })).toBe(true);
    expect(send).toHaveBeenCalledWith('vex-stop-capture', 'all');
    // _toast passes a second (undefined) argument, so match the message itself.
    expect(window.showToast.mock.calls[0][0]).toContain('Asked Meet to stop');
  });

  it('a page that has since closed says so instead of pretending', () => {
    expect(PermissionsSettings.stopCapture({ where: 'tab', id: 'gone', label: 'X' })).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('That page is not loaded any more', 'error');
  });

  it('the guest holds the tracks, which is what makes stopping possible', () => {
    const preload = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
    expect(preload).toContain('window.__vexStopCapture');
    expect(preload).toContain("ipcRenderer.on('vex-stop-capture'");
    expect(preload).toMatch(/open\.add\(track\)/);
    expect(preload).toMatch(/open\.delete\(track\)/);
  });
});

describe('the permission prompt', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/permission-prompts.js'), 'utf8');

  it('offers this visit as well as always, and no longer a ticked Remember box', () => {
    expect(src).toContain('data-remember="session"');
    expect(src).toContain('Allow this visit');
    expect(src).toContain('Always allow');
    expect(src).not.toContain('perm-remember');
  });

  it('a visit-only answer is never written to disk', () => {
    const main = fs.readFileSync(path.join(__dirname, '../../src/main/permissions.js'), 'utf8');
    expect(main).toContain("if (remember === 'session')");
    expect(main).toContain('sessionDecisions.set');
    // The saved-decision lookup consults the session first.
    expect(main).toMatch(/savedDecision\(decisionsFor\(webContents\), origin, parts, sessionDecisions\)/);
  });
});
