// @vitest-environment jsdom
//
// T3-010 (Wave 5): the downloads panel shows what the file check found on a finished download.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadsPanel } from '../../src/renderer/js/downloads-panel.js';

function shell() {
  document.body.innerHTML = '<div class="sidebar-icon" data-panel="downloads"></div><div id="panel-downloads"></div>';
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
  delete globalThis.VexAttention;
  window.vex = {
    onDownloadStarted: vi.fn(), onDownloadProgress: vi.fn(), onDownloadComplete: vi.fn(),
    downloadsControl: vi.fn(async () => ({ ok: true })), downloadsRetry: vi.fn(async () => ({ ok: true })), downloadsOpenFile: vi.fn(async () => ({ ok: true })),
    downloadsShowInFolder: vi.fn(), downloadsOpenFolder: vi.fn(),
  };
  shell();
});

const start = (over = {}) => DownloadsPanel._onStart({ id: 'd1', fileName: 'thing.bin', url: 'https://example.test/thing.bin', totalBytes: 1000, path: 'C:/dl/thing.bin', startedAt: '2026-01-01T00:00:00.000Z', ...over });
const finding = (level, text) => ({ level, kind: 'k', text });

describe('the file check on a finished download', () => {
  it('shows a warning under a download whose bytes do not match its name, instead of the usual finished card', () => {
    globalThis.DownloadToast = { show: vi.fn() };
    start({ fileName: 'invoice.pdf' });
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/invoice.pdf', receivedBytes: 10, totalBytes: 10, fileCheck: { checked: true, worst: 'high', findings: [finding('high', 'The name says ".pdf" but the file is a Windows program.')] } });
    const warn = document.querySelector('.download-item .download-warn');
    expect(warn.textContent).toContain('Warning:');
    expect(warn.textContent).toContain('Windows program');
    expect(globalThis.DownloadToast.show).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('invoice.pdf'), 'error', 12000);
    delete globalThis.DownloadToast;
  });
  it('goes through the attention gate as critical when it is there', () => {
    globalThis.VexAttention = { notify: vi.fn() };
    start({ fileName: 'invoice.pdf' });
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/invoice.pdf', receivedBytes: 10, totalBytes: 10, fileCheck: { checked: true, findings: [finding('high', 'x')] } });
    expect(globalThis.VexAttention.notify.mock.calls[0][0]).toMatchObject({ feature: 'download-file-check', urgency: 'critical' });
  });
  it('keeps text only (no markup), at most four findings, and nothing for a clean file', () => {
    expect(DownloadsPanel._cleanFileCheck({ checked: true, findings: [] })).toBeNull();
    expect(DownloadsPanel._cleanFileCheck(null)).toBeNull();
    const c = DownloadsPanel._cleanFileCheck({ checked: true, findings: Array.from({ length: 6 }, () => finding('medium', '<img src=x onerror=1>')) });
    expect(c.findings).toHaveLength(4);
    start({ fileName: 'a.zip' });
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/a.zip', receivedBytes: 10, totalBytes: 10, fileCheck: c });
    expect(document.querySelector('.download-warn img')).toBeNull();
    expect(document.querySelector('.download-warn').textContent).toContain('<img');
  });
  it('says when a file could not be checked, and never calls it clean', () => {
    start();
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/thing.bin', receivedBytes: 10, totalBytes: 10, fileCheck: { checked: false, findings: [], note: 'The file could not be checked: busy' } });
    expect(document.querySelector('.download-warn').textContent).toContain('could not be checked');
  });
  it('shows nothing extra for a download with no check result', () => {
    start();
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/thing.bin', receivedBytes: 10, totalBytes: 10 });
    expect(document.querySelector('.download-warn')).toBeNull();
  });
});
