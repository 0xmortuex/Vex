// @vitest-environment jsdom
//
// Before running a download: look it up on VirusTotal first, by its
// fingerprint — the file itself is never uploaded.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-dialog.js');
require('../../src/renderer/js/downloads-panel.js');
const DownloadsPanel = window.DownloadsPanel;

const SHA = 'a'.repeat(64);
beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.TabManager = { createTab: vi.fn() };
});

describe('a third choice in a dialog', () => {
  it('closes as "not now", then does its own thing', async () => {
    const run = vi.fn();
    const answer = window.vexConfirm({ title: 'Run it?', okLabel: 'Run it', extra: { label: 'Look it up', run } });
    document.querySelector('.vex-dialog [data-extra]').click();
    expect(await answer).toBe(false);
    expect(run).toHaveBeenCalled();
    expect(document.querySelector('.vex-dialog-overlay')).toBeNull();
  });
});

describe('the download check', () => {
  it('offers VirusTotal for this file, by its SHA-256, in a new tab', async () => {
    window.vex = { fileInspect: vi.fn(async () => ({ ok: true, verdict: 'unsigned', name: 'setup.exe', sha256: SHA.toUpperCase(), lines: ['Not signed'] })) };
    const answer = DownloadsPanel._okToOpen('C:/Downloads/setup.exe', 'https://site.example/');
    await new Promise(r => setTimeout(r, 0));
    const extra = document.querySelector('.vex-dialog [data-extra]');
    expect(extra.textContent).toBe('Check on VirusTotal');
    extra.click();
    expect(await answer).toBe(false);                  // not run: look first
    expect(TabManager.createTab).toHaveBeenCalledWith('https://www.virustotal.com/gui/file/' + SHA, true);
  });

  // A new file (Vex's own installer, an hour old) opens on "Item not found",
  // which looked like Vex had broken (2026-09-28).
  it('says what "Item not found" means and opens the folder to drag the file from', async () => {
    const toast = vi.fn();
    window.showToast = toast;
    window.vex = { fileInspect: vi.fn(async () => ({ ok: true, verdict: 'unsigned', name: 'setup.exe', sha256: SHA, lines: [] })), downloadsShowInFolder: vi.fn() };
    const answer = DownloadsPanel._okToOpen('C:/Downloads/setup.exe', '');
    await new Promise(r => setTimeout(r, 0));
    document.querySelector('.vex-dialog [data-extra]').click();
    await answer;
    expect(toast.mock.calls[0][0]).toMatch(/Item not found", nobody has scanned this exact file yet/);
    expect(window.vex.downloadsShowInFolder).toHaveBeenCalledWith('C:/Downloads/setup.exe');
  });

  it('no VirusTotal button without a real fingerprint', async () => {
    window.vex = { fileInspect: vi.fn(async () => ({ ok: true, verdict: 'unsigned', name: 'setup.exe', sha256: '', lines: [] })) };
    const answer = DownloadsPanel._okToOpen('C:/Downloads/setup.exe', '');
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector('.vex-dialog [data-extra]')).toBeNull();
    document.querySelector('.vex-dialog [data-cancel]').click();
    expect(await answer).toBe(false);
  });
});
