// @vitest-environment jsdom
//
// Downloads a page made itself. Android's DownloadManager fetches a URL over the
// network; a blob: or data: URL is not one, so these downloads failed outright
// with "Download failed" and no file. The bytes have to be read where they are.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let page = null;             // what window.__vexDownload would hold in the page
window.VexBridge = {
  evaluate: vi.fn(async (id, code) => {
    if (code.includes('__vexDownload = { state')) {
      // The read starting. The test decides what the page ends up with.
      page = typeof page === 'function' ? page() : page;
      return { result: '"started"' };
    }
    const held = page;
    if (held && held.state !== 'reading') page = null;
    return { result: JSON.stringify(JSON.stringify(held || { state: 'reading' })) };
  }),
  saveData: vi.fn(async () => ({ localUri: 'content://downloads/1', bytes: 3 }))
};

const { VexDownloads } = require('../../mobile/www/js/downloads.js');

const job = extra => Object.assign({ id: 't1', filename: 'export.csv', mimeType: 'text/csv' }, extra);

beforeEach(() => {
  page = null;
  window.VexBridge.evaluate.mockClear();
  window.VexBridge.saveData.mockClear();
  window.VexBridge.saveData.mockResolvedValue({ localUri: 'content://downloads/1', bytes: 3 });
});

describe('a data: URL', () => {
  it('is decoded by the chrome, without troubling the page', async () => {
    const result = await VexDownloads.saveLocal(job({ url: 'data:text/csv;base64,YSxiLGM=' }));
    expect(result).toEqual({ ok: true, localUri: 'content://downloads/1' });
    expect(window.VexBridge.saveData).toHaveBeenCalledWith('t1', 'export.csv', 'text/csv', 'YSxiLGM=');
    expect(window.VexBridge.evaluate).not.toHaveBeenCalled();
  });

  it('handles one that is not base64 at all', async () => {
    const result = await VexDownloads.saveLocal(job({ url: 'data:text/plain,hello%20there' }));
    expect(result.ok).toBe(true);
    const [, , , base64] = window.VexBridge.saveData.mock.calls[0];
    expect(atob(base64)).toBe('hello there');
  });

  it('refuses a malformed one', async () => {
    const result = await VexDownloads.saveLocal(job({ url: 'data:nonsense' }));
    expect(result).toEqual({ ok: false, why: 'That file could not be read' });
  });

  it('refuses one past the cap rather than trying', async () => {
    const huge = 'data:application/zip;base64,' + 'A'.repeat(Math.ceil(VexDownloads.CAP / 0.75) + 8);
    const result = await VexDownloads.saveLocal(job({ url: huge }));
    expect(result.why).toContain('too big');
    expect(window.VexBridge.saveData).not.toHaveBeenCalled();
  });
});

describe('a blob: URL', () => {
  it('is read by the page and saved', async () => {
    page = { state: 'done', base64: 'YSxiLGM=', size: 6 };
    const result = await VexDownloads.saveLocal(job({ url: 'blob:https://example.com/abc' }));
    expect(result).toEqual({ ok: true, localUri: 'content://downloads/1' });
    expect(window.VexBridge.saveData).toHaveBeenCalledWith('t1', 'export.csv', 'text/csv', 'YSxiLGM=');
  });

  it('waits for the page to finish reading it', async () => {
    let polls = 0;
    page = { state: 'reading' };
    const spin = setInterval(() => {
      if (++polls >= 3) { page = { state: 'done', base64: 'YQ==', size: 1 }; clearInterval(spin); }
    }, 130);
    const result = await VexDownloads.saveLocal(job({ url: 'blob:https://example.com/abc' }));
    clearInterval(spin);
    expect(result).toEqual({ ok: true, localUri: 'content://downloads/1' });
  });

  it('says so when the page says it is too big', async () => {
    page = { state: 'too-big', size: 99 * 1024 * 1024 };
    const result = await VexDownloads.saveLocal(job({ url: 'blob:https://example.com/abc' }));
    expect(result.why).toContain('too big');
  });

  it('says so when the page cannot read it', async () => {
    page = { state: 'failed' };
    expect((await VexDownloads.saveLocal(job({ url: 'blob:x' }))).why)
      .toBe('That file could not be read');
  });

  it('passes the save failure on in words', async () => {
    page = { state: 'done', base64: 'YQ==', size: 1 };
    window.VexBridge.saveData.mockRejectedValueOnce(new Error('Downloads is not writable'));
    expect((await VexDownloads.saveLocal(job({ url: 'blob:x' }))).why)
      .toBe('Downloads is not writable');
  });

  it('falls back to a name when the page gave none', async () => {
    page = { state: 'done', base64: 'YQ==', size: 1 };
    await VexDownloads.saveLocal({ id: 't1', url: 'blob:x' });
    expect(window.VexBridge.saveData).toHaveBeenCalledWith('t1', 'download', '', 'YQ==');
  });
});
