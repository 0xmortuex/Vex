// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadsPanel } from '../../src/renderer/js/downloads-panel.js';

function shell() {
  document.body.innerHTML = `
    <div class="sidebar-icon" data-panel="downloads"></div>
    <div id="panel-downloads"></div>`;
  DownloadsPanel._wired = false;
  DownloadsPanel.downloads = [];
  DownloadsPanel.activeDownloads = new Map();
  delete document.getElementById('panel-downloads').dataset.rendered;
  DownloadsPanel.init();
}

beforeEach(() => {
  localStorage.clear();
  window.escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  window.vex = {
    onDownloadStarted: vi.fn(), onDownloadProgress: vi.fn(), onDownloadComplete: vi.fn(),
    downloadsControl: vi.fn(async () => ({ ok: true })),
    downloadsRetry: vi.fn(async () => ({ ok: true })),
    downloadsOpenFile: vi.fn(async () => ({ ok: true })),
    downloadsShowInFolder: vi.fn(), downloadsOpenFolder: vi.fn(),
  };
  shell();
});

const start = (over = {}) => DownloadsPanel._onStart({ id: 'd1', fileName: 'thing.bin', url: 'https://example.test/thing.bin', totalBytes: 1000, path: 'C:/dl/thing.bin', startedAt: '2026-01-01T00:00:00.000Z', ...over });

describe('downloads panel', () => {
  it('refuses a start event with no id instead of creating an orphan row', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    DownloadsPanel._onStart({ fileName: 'nameless.bin' });
    expect(DownloadsPanel.downloads).toHaveLength(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('reports the received size when the server sent no Content-Length', () => {
    start({ totalBytes: 0 });
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/thing.bin', receivedBytes: 4096, totalBytes: 0 });
    const done = DownloadsPanel.downloads[0];
    expect(done.receivedBytes).toBe(4096);
    expect(done.totalBytes).toBe(4096);
    expect(document.querySelector('.download-meta').textContent).toContain('4 KB');
  });

  it('shows what has arrived, not a permanent 0%, while a length-less download runs', () => {
    start({ totalBytes: 0 });
    DownloadsPanel._onProgress({ id: 'd1', receivedBytes: 2048, totalBytes: 0, state: 'progressing' });
    expect(document.querySelector('.download-meta').textContent).toContain('2 KB downloaded');
    expect(document.querySelector('.download-meta').textContent).not.toContain('0%');
  });

  it('offers pause while running and resume once paused', async () => {
    start();
    const actions = () => [...document.querySelectorAll('.download-item .dl-btn')].map(b => b.dataset.action);
    expect(actions()).toEqual(['pause', 'cancel', 'remove']);
    DownloadsPanel._onProgress({ id: 'd1', receivedBytes: 100, totalBytes: 1000, state: 'progressing', paused: true, canResume: true });
    expect(actions()).toEqual(['resume', 'cancel', 'remove']);
    expect(document.querySelector('.download-meta').textContent).toContain('paused');
    document.querySelector('[data-action="resume"]').click();
    await Promise.resolve();
    expect(window.vex.downloadsControl).toHaveBeenCalledWith('d1', 'resume');
  });

  it('offers retry on a failed download and passes its source URL back', async () => {
    start();
    DownloadsPanel._onComplete({ id: 'd1', state: 'interrupted', receivedBytes: 10, totalBytes: 1000 });
    expect([...document.querySelectorAll('.dl-btn')].map(b => b.dataset.action)).toEqual(['retry', 'remove']);
    document.querySelector('[data-action="retry"]').click();
    await Promise.resolve();
    expect(window.vex.downloadsRetry).toHaveBeenCalledWith('https://example.test/thing.bin');
  });

  it('cancels the transfer when a running download is removed from the list', () => {
    start();
    document.querySelector('[data-action="remove"]').click();
    expect(window.vex.downloadsControl).toHaveBeenCalledWith('d1', 'cancel');
    expect(DownloadsPanel.downloads).toHaveLength(0);
  });

  it('reconciles a row main no longer knows about instead of leaving it stuck', async () => {
    start();
    window.vex.downloadsControl = vi.fn(async () => ({ ok: false, error: 'That download has already finished' }));
    await DownloadsPanel._control('d1', 'pause');
    expect(DownloadsPanel.downloads[0].state).toBe('interrupted');
    expect(window.showToast).toHaveBeenCalledWith('That download has already finished', 'error');
  });

  it('keeps live transfers when the history is trimmed to its cap', () => {
    DownloadsPanel.downloads = [{ id: 'live', state: 'progressing' }];
    for (let i = 0; i < 120; i++) DownloadsPanel.downloads.push({ id: 'old' + i, state: 'completed' });
    DownloadsPanel.save();
    expect(DownloadsPanel.downloads).toHaveLength(100);
    expect(DownloadsPanel.downloads.some(d => d.id === 'live')).toBe(true);
  });

  it('uses inline icons rather than emoji', () => {
    start();
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', receivedBytes: 1000, totalBytes: 1000 });
    const html = document.getElementById('downloads-list').innerHTML;
    expect(html).toContain('<svg');
    expect(/\p{Extended_Pictographic}/u.test(html)).toBe(false);
  });
});

// An installer is the one thing a browser hands you that can do anything to the
// machine. Vex says what it can know — signer, source, fingerprint — before the
// double-click, not after. What it must never do is stand between the user and
// a file they asked for because its own check fell over.
describe('before a downloaded program runs', () => {
  const inspection = (over = {}) => ({ ok: true, name: 'setup.exe', verdict: 'unsigned', lines: ['setup.exe — 4.0 MB', 'Downloaded from example.test', 'Not signed — nobody has put their name to this file', 'SHA-256 abc'], ...over });

  beforeEach(() => {
    window.vex.fileInspect = vi.fn(async () => inspection());
    window.vexConfirm = vi.fn(async () => true);
  });

  const openIt = async (over = {}) => {
    start({ fileName: 'setup.exe', path: 'C:/dl/setup.exe', ...over });
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', receivedBytes: 1000, totalBytes: 1000 });
    document.querySelector('[data-action="open-file"]').click();
    await vi.waitFor(() => expect(window.vex.fileInspect).toHaveBeenCalled());
  };

  it('asks about an unsigned program, and names where it came from', async () => {
    await openIt();
    expect(window.vex.fileInspect).toHaveBeenCalledWith('C:/dl/setup.exe', 'https://example.test/thing.bin');
    const asked = window.vexConfirm.mock.calls[0][0];
    expect(asked.title).toBe('This program is not signed');
    expect(asked.message).toContain('Downloaded from example.test');
    expect(asked.message).toContain('SHA-256 abc');
    expect(asked.danger).toBe(true);
    await vi.waitFor(() => expect(window.vex.downloadsOpenFile).toHaveBeenCalledWith('C:/dl/setup.exe'));
  });

  it('does not open it when the answer is no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    await openIt();
    await vi.waitFor(() => expect(window.vexConfirm).toHaveBeenCalled());
    expect(window.vex.downloadsOpenFile).not.toHaveBeenCalled();
  });

  it('a signed program is confirmed, but not dressed up as a danger', async () => {
    window.vex.fileInspect = vi.fn(async () => inspection({ verdict: 'signed' }));
    await openIt();
    expect(window.vexConfirm.mock.calls[0][0]).toMatchObject({ title: 'Run setup.exe?', danger: false, okLabel: 'Run it' });
  });

  it('a PDF opens exactly as it always did — nothing is asked', async () => {
    window.vex.fileInspect = vi.fn(async () => inspection({ name: 'report.pdf', verdict: 'ordinary' }));
    await openIt({ fileName: 'report.pdf', path: 'C:/dl/report.pdf' });
    expect(window.vexConfirm).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(window.vex.downloadsOpenFile).toHaveBeenCalledWith('C:/dl/report.pdf'));
  });

  it('a check that fails never stands between the user and their file', async () => {
    for (const bad of [async () => { throw new Error('main is gone'); }, async () => ({ ok: false, error: 'That file is not there any more' }), async () => null]) {
      window.vex.downloadsOpenFile = vi.fn(async () => ({ ok: true }));
      window.vex.fileInspect = vi.fn(bad);
      window.vexConfirm = vi.fn(async () => false);          // would block, if it were ever asked
      shell();
      await openIt();
      await vi.waitFor(() => expect(window.vex.downloadsOpenFile).toHaveBeenCalledWith('C:/dl/setup.exe'));
      expect(window.vexConfirm).not.toHaveBeenCalled();
    }
  });

  it('an older Vex with no such bridge opens files as before', async () => {
    delete window.vex.fileInspect;
    start({ fileName: 'setup.exe', path: 'C:/dl/setup.exe' });
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', receivedBytes: 1000, totalBytes: 1000 });
    document.querySelector('[data-action="open-file"]').click();
    await vi.waitFor(() => expect(window.vex.downloadsOpenFile).toHaveBeenCalled());
  });
});
