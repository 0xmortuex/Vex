// @vitest-environment jsdom
//
// T3-111 (Wave 6): the Downloads panel offers "Extract here" on a finished archive, and only there.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadsPanel } from '../../src/renderer/js/downloads-panel.js';

beforeEach(() => {
  window.escapeHtml = (v) => String(v == null ? '' : v);
  window.showToast = vi.fn();
  window.vex = { downloadsExtractHere: vi.fn(async () => ({ ok: true, folder: 'C:/Downloads/tools', files: 3, motw: { carried: true } })), downloadsShowInFolder: vi.fn() };
});

describe('the Extract here button', () => {
  it('is on zip, tar, tgz and tar.gz rows and not on anything else', () => {
    const btn = (filename) => DownloadsPanel._extractButton({ path: 'C:/Downloads/' + filename, filename });
    for (const f of ['a.zip', 'a.ZIP', 'a.tar', 'a.tgz', 'a.tar.gz']) expect(btn(f), f).toContain('data-action="extract-here"');
    for (const f of ['a.exe', 'a.rar', 'a.7z', 'a.zip.exe', 'a.txt']) expect(btn(f), f).toBe('');
    expect(DownloadsPanel._extractButton({ filename: 'a.zip' })).toBe('');
  });

  it('asks main to unpack, then says how many files and offers to show the folder', async () => {
    const r = await DownloadsPanel._extractHere('C:/Downloads/tools.zip');
    expect(window.vex.downloadsExtractHere).toHaveBeenCalledWith('C:/Downloads/tools.zip');
    expect(r.files).toBe(3);
    const [text, kind, , opts] = window.showToast.mock.calls[0];
    expect(text).toMatch(/Extracted 3 files\..*mark was kept/);
    expect(kind).toBe('success');
    opts.action.run();
    expect(window.vex.downloadsShowInFolder).toHaveBeenCalledWith('C:/Downloads/tools');
  });

  it('says nothing when the person cancels in main, and reports an error plainly', async () => {
    window.vex.downloadsExtractHere = vi.fn(async () => ({ ok: false, cancelled: true }));
    await DownloadsPanel._extractHere('x.zip');
    expect(window.showToast).not.toHaveBeenCalled();
    window.vex.downloadsExtractHere = vi.fn(async () => ({ ok: false, error: 'Archive links/devices are forbidden' }));
    await DownloadsPanel._extractHere('x.zip');
    expect(window.showToast).toHaveBeenCalledWith('Archive links/devices are forbidden', 'error');
  });
});
