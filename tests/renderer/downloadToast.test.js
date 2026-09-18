// @vitest-environment jsdom
//
// The toast is where a download is actually opened from — the moment it lands,
// while it is still on your mind. The downloads panel is where you go later, if
// you go at all. A check that only guards the panel guards the wrong door.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/download-toast.js');
const DownloadToast = window.DownloadToast;

beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.vex = { downloadsOpenFile: vi.fn(async () => ({ ok: true })), downloadsShowInFolder: vi.fn() };
  window.DownloadsPanel = { _okToOpen: vi.fn(async () => true) };
  vi.useFakeTimers();
});

const pop = (over = {}) => DownloadToast.show({ filename: 'setup.exe', path: 'C:/dl/setup.exe', size: 4096, from: 'https://example.test/setup.exe', ...over });
const clickOpen = () => document.querySelector('[data-action="open"]').click();

describe('the Open button on a finished download', () => {
  it('asks the same question the panel asks, with the same file and source', async () => {
    pop();
    clickOpen();
    expect(window.DownloadsPanel._okToOpen).toHaveBeenCalledWith('C:/dl/setup.exe', 'https://example.test/setup.exe');
    await vi.waitFor(() => expect(window.vex.downloadsOpenFile).toHaveBeenCalledWith('C:/dl/setup.exe'));
  });

  it('does not open it when the answer is no', async () => {
    window.DownloadsPanel._okToOpen = vi.fn(async () => false);
    pop();
    clickOpen();
    await Promise.resolve(); await Promise.resolve();
    expect(window.vex.downloadsOpenFile).not.toHaveBeenCalled();
  });

  it('opens anyway if the check itself throws — never a dead button', async () => {
    window.DownloadsPanel._okToOpen = vi.fn(async () => { throw new Error('gone'); });
    pop();
    clickOpen();
    await vi.waitFor(() => expect(window.vex.downloadsOpenFile).toHaveBeenCalled());
  });

  it('opens when there is no panel to ask', async () => {
    delete window.DownloadsPanel;
    pop();
    clickOpen();
    await vi.waitFor(() => expect(window.vex.downloadsOpenFile).toHaveBeenCalled());
  });

  it('still reports a file that would not open', async () => {
    window.vex.downloadsOpenFile = vi.fn(async () => ({ ok: false, error: 'That file is not there any more' }));
    pop();
    clickOpen();
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalledWith('That file is not there any more', 'error'));
  });

  it('shows no Open button at all for a download whose path never arrived', () => {
    pop({ path: '' });
    expect(document.querySelector('[data-action="open"]')).toBe(null);
    expect(document.querySelector('[data-action="dismiss"]')).not.toBe(null);
  });

  it('names the file without letting its name become markup', () => {
    pop({ filename: '<img src=x onerror=alert(1)>.exe' });
    const el = document.querySelector('.download-toast-filename');
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>.exe');
    expect(el.querySelector('img')).toBe(null);
  });
});
