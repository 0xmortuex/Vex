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
