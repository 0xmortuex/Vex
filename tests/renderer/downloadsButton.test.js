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
    expect(DownloadsButton.button().title).toBe('1 download in progress — 25%');
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
    expect(rows).toEqual(['notes.txt2 KB', 'gone.zipcancelled']);
    // The one still running is a bar, not a line of text.
    expect(document.querySelector('.downloads-drop-live .ddl-name').textContent).toBe('big.iso');
    expect(document.querySelector('.downloads-drop-live .ddl-pct').textContent).toBe('25%');
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

});

describe('while something is downloading', () => {
  const running = (over) => Object.assign({ id: '2', filename: 'big.iso', state: 'progressing', receivedBytes: 24 * 1048576, totalBytes: 240 * 1048576 }, over);

  it('shows itself when the download starts, without being asked', () => {
    DownloadsButton.init();
    DownloadsPanel.downloads = [running()];
    DownloadsButton.started();
    expect(document.querySelector('.downloads-drop')).not.toBeNull();
    expect(document.querySelector('.ddl-bar i').style.width).toBe('10%');
  });

  it('closing it while it runs means "not now" — the next file does not reopen it', () => {
    DownloadsButton.init();
    DownloadsPanel.downloads = [running()];
    DownloadsButton.started();
    DownloadsButton.close();
    DownloadsButton.started();
    expect(document.querySelector('.downloads-drop')).toBeNull();
  });

  it('a click on the page closes it — that click never reaches this document', () => {
    DownloadsButton.init();
    DownloadsButton.toggle();
    const shield = document.querySelector('.downloads-drop-shield');
    expect(shield).not.toBeNull();
    shield.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.downloads-drop')).toBeNull();
    expect(document.querySelector('.downloads-drop-shield')).toBeNull();
  });

  it('says how much of how much, how fast, and how long is left', () => {
    const dl = running();
    expect(DownloadsButton.detail(dl, 3.1 * 1048576)).toBe('24.0 MB of 240.0 MB · 3.1 MB/s · about 70 seconds left');
    expect(DownloadsButton.detail(dl, 1.5 * 1048576)).toMatch(/about 2 minutes left$/);
    expect(DownloadsButton.detail(running({ receivedBytes: 239 * 1048576 }), 2 * 1048576)).toMatch(/nearly done$/);
    expect(DownloadsButton.detail(dl, 0)).toBe('24.0 MB of 240.0 MB');              // no rate yet: no guess
    expect(DownloadsButton.detail(running({ totalBytes: 0 }), 0)).toBe('24.0 MB so far');
    expect(DownloadsButton.detail(running({ paused: true }), 3 * 1048576)).toBe('24.0 MB of 240.0 MB · paused');
  });

  it('measures the speed itself, because nothing reports it', () => {
    DownloadsButton._rate.clear();
    const dl = running({ receivedBytes: 0 });
    DownloadsPanel.downloads = [dl];
    DownloadsButton.refresh();
    vi.advanceTimersByTime(1000);
    dl.receivedBytes = 2 * 1048576;
    DownloadsButton.refresh();
    expect(DownloadsButton._rate.get('2').bps).toBeGreaterThan(1.5 * 1048576);
  });

  it('puts the progress on the button itself', () => {
    DownloadsButton.init();
    DownloadsPanel.downloads = [running()];
    DownloadsButton.refresh();
    const b = DownloadsButton.button();
    expect(b.classList.contains('has-progress')).toBe(true);
    expect(b.style.getPropertyValue('--dl-progress')).toBe('10');
    expect(b.title).toBe('1 download in progress — 10%');
  });

  it('pause and cancel are on the row, not two screens away', async () => {
    window.vex.downloadsControl = vi.fn(async () => ({ ok: true }));
    DownloadsButton.init();
    DownloadsPanel.downloads = [running()];
    DownloadsButton.toggle();
    const [pause, cancel] = document.querySelectorAll('.ddl-acts button');
    expect([pause.textContent, cancel.textContent]).toEqual(['Pause', 'Cancel']);
    pause.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(window.vex.downloadsControl).toHaveBeenCalledWith('2', 'pause');
    DownloadsPanel.downloads = [running({ paused: true })];
    DownloadsButton.refresh();
    expect(document.querySelector('.ddl-acts button').textContent).toBe('Resume');
    expect(document.querySelector('.downloads-drop-live').classList.contains('paused')).toBe(true);
  });
});
