// @vitest-environment jsdom
//
// The toolbar downloads button, and the completion card that no longer takes
// itself off the screen after a few seconds (reported 2026-09-20: looking the
// other way cost you the file).
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { DownloadsButton } = require('../../src/renderer/js/downloads-button.js');
const { DownloadToast } = require('../../src/renderer/js/download-toast.js');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="btn-downloads-top" class="nav-btn"></button>';
  globalThis.DownloadsPanel = { downloads: [], _okToOpen: vi.fn(async () => true) };
  globalThis.SidebarManager = { openPanel: vi.fn() };
  window.vex = { downloadsOpenFile: vi.fn(async () => ({ ok: true })) };
  DownloadsButton._open = null;
});

describe('the completion card', () => {
  it('stays on screen — it is a thing you have to act on', () => {
    DownloadToast.show({ filename: 'setup.exe', path: 'C:/d/setup.exe', size: 1024, from: 'https://x.example' });
    vi.advanceTimersByTime(60000);
    expect(document.querySelectorAll('.download-toast')).toHaveLength(1);
    expect([...document.querySelectorAll('.download-toast button')].map(b => b.dataset.action)).toEqual(['open', 'folder', 'dismiss']);
  });

  it('closes when you close it, and a pile of them cannot bury the window', () => {
    for (let i = 0; i < 8; i++) DownloadToast.show({ filename: 'f' + i, path: 'C:/d/f' + i, size: 10 });
    expect(document.querySelectorAll('.download-toast')).toHaveLength(DownloadToast.MAX_ON_SCREEN);
    document.querySelector('[data-action="dismiss"]').click();
    vi.advanceTimersByTime(400);
    expect(document.querySelectorAll('.download-toast')).toHaveLength(DownloadToast.MAX_ON_SCREEN - 1);
  });
});

describe('the toolbar button', () => {
  it('marks itself while something is downloading', () => {
    DownloadsButton.init();
    expect(DownloadsButton.button().classList.contains('has-active')).toBe(false);
    DownloadsPanel.downloads = [{ id: '1', filename: 'big.iso', state: 'progressing', receivedBytes: 50, totalBytes: 200 }];
    DownloadsButton.refresh();
    expect(DownloadsButton.button().classList.contains('has-active')).toBe(true);
    expect(DownloadsButton.button().title).toBe('1 download in progress');
  });

  it('drops down the last few, newest first, with what each one is doing', () => {
    DownloadsPanel.downloads = [
      { id: '1', filename: 'notes.txt', state: 'completed', path: 'C:/d/notes.txt', totalBytes: 2048 },
      { id: '2', filename: 'big.iso', state: 'progressing', receivedBytes: 50, totalBytes: 200 },
      { id: '3', filename: 'gone.zip', state: 'cancelled' },
    ];
    DownloadsButton.init();
    DownloadsButton.toggle();
    const rows = [...document.querySelectorAll('.downloads-drop-row')].map(r => r.textContent);
    expect(rows).toEqual(['notes.txt2 KB', 'big.iso25%', 'gone.zipcancelled']);
    expect(document.querySelector('.downloads-drop-all').textContent).toBe('Open downloads');
  });

  it('a finished one opens, after the same check the panel makes', async () => {
    DownloadsPanel.downloads = [{ id: '1', filename: 'setup.exe', state: 'completed', path: 'C:/d/setup.exe', url: 'https://x.example' }];
    DownloadsButton.init();
    DownloadsButton.toggle();
    document.querySelector('.downloads-drop-row').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(DownloadsPanel._okToOpen).toHaveBeenCalledWith('C:/d/setup.exe', 'https://x.example');
    expect(window.vex.downloadsOpenFile).toHaveBeenCalledWith('C:/d/setup.exe');
  });

  it('one still downloading opens the panel instead, and the menu closes', () => {
    DownloadsPanel.downloads = [{ id: '2', filename: 'big.iso', state: 'progressing', receivedBytes: 1, totalBytes: 4 }];
    DownloadsButton.init();
    DownloadsButton.toggle();
    document.querySelector('.downloads-drop-row').click();
    expect(SidebarManager.openPanel).toHaveBeenCalledWith('downloads');
    expect(document.querySelector('.downloads-drop')).toBeNull();
  });
});
