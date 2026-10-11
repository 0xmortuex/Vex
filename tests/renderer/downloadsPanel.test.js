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

  it('tells the toolbar button about every chunk', () => {
    // It did not, and that is the whole reason the toolbar's bar and its
    // drop-down sat at 0% for a whole download and then jumped to finished
    // (reported 2026-09-21). The button throttles its own drawing.
    const refresh = vi.fn();
    window.DownloadsButton = { refresh, started: () => {} };
    start();                                  // starting one tells it too
    refresh.mockClear();
    DownloadsPanel._onProgress({ id: 'd1', receivedBytes: 500, totalBytes: 1000, state: 'progressing' });
    DownloadsPanel._onProgress({ id: 'd1', receivedBytes: 900, totalBytes: 1000, state: 'progressing' });
    expect(refresh).toHaveBeenCalledTimes(2);
    delete window.DownloadsButton;
  });

  it('offers pause while running and resume once paused', async () => {
    start();
    const actions = () => [...document.querySelectorAll('.download-item .dl-btn')].map(b => b.dataset.action);
    expect(actions()).toEqual(['open-when-done', 'pause', 'cancel', 'copy-link', 'remove']);
    DownloadsPanel._onProgress({ id: 'd1', receivedBytes: 100, totalBytes: 1000, state: 'progressing', paused: true, canResume: true });
    expect(actions()).toEqual(['open-when-done', 'resume', 'cancel', 'copy-link', 'remove']);
    expect(document.querySelector('.download-meta').textContent).toContain('paused');
    document.querySelector('[data-action="resume"]').click();
    await Promise.resolve();
    expect(window.vex.downloadsControl).toHaveBeenCalledWith('d1', 'resume');
  });

  it('offers retry on a failed download and passes its source URL back', async () => {
    start();
    DownloadsPanel._onComplete({ id: 'd1', state: 'interrupted', receivedBytes: 10, totalBytes: 1000 });
    expect([...document.querySelectorAll('.dl-btn')].map(b => b.dataset.action)).toEqual(['retry', 'copy-link', 'remove']);
    document.querySelector('[data-action="retry"]').click();
    await Promise.resolve();
    // With its id, so main retries it through the session the first try used.
    expect(window.vex.downloadsRetry).toHaveBeenCalledWith('https://example.test/thing.bin', expect.any(String));
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

// A download you are waiting for is one you open the moment it lands, and the
// toast that offers that goes away after a few seconds. Asked once, at the
// start — and never a way round the check an installer still has to pass.
describe('open it when it is done', () => {
  beforeEach(() => { DownloadsPanel.openWhenDone = new Set(); });

  it('is offered on a running download and shows that it is on', () => {
    start();
    const btn = () => document.querySelector('[data-action="open-when-done"]');
    expect(btn().textContent).toBe('Open when done');
    btn().click();
    expect(DownloadsPanel.wantsOpen('d1')).toBe(true);
    expect(btn().textContent).toBe('Will open');
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    btn().click();
    expect(DownloadsPanel.wantsOpen('d1')).toBe(false);
  });

  it('opens the file when it finishes, and only that one', async () => {
    start();
    start({ id: 'd2', fileName: 'other.bin', path: 'C:/dl/other.bin' });
    DownloadsPanel.setOpenWhenDone('d1', true);
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', receivedBytes: 1000, totalBytes: 1000, path: 'C:/dl/thing.bin' });
    await vi.waitFor(() => expect(window.vex.downloadsOpenFile).toHaveBeenCalledWith('C:/dl/thing.bin'));
    DownloadsPanel._onComplete({ id: 'd2', state: 'completed', receivedBytes: 1000, totalBytes: 1000, path: 'C:/dl/other.bin' });
    await Promise.resolve();
    expect(window.vex.downloadsOpenFile).toHaveBeenCalledTimes(1);
    // Asked for once, not a standing setting.
    expect(DownloadsPanel.wantsOpen('d1')).toBe(false);
  });

  // Waiting for a file is not consent to run an unsigned program: the same
  // question is asked as for a file opened by hand, and No means no.
  it('still asks before running something that is not ordinary', async () => {
    window.vex.fileInspect = vi.fn(async () => ({ ok: true, verdict: 'unsigned', name: 'setup.exe', lines: ['Nobody signed it'], sha256: '' }));
    window.vexConfirm = vi.fn(async () => false);
    start({ id: 'd3', fileName: 'setup.exe', path: 'C:/dl/setup.exe' });
    DownloadsPanel.setOpenWhenDone('d3', true);
    DownloadsPanel._onComplete({ id: 'd3', state: 'completed', receivedBytes: 10, totalBytes: 10, path: 'C:/dl/setup.exe' });
    await vi.waitFor(() => expect(window.vexConfirm).toHaveBeenCalled());
    expect(window.vex.downloadsOpenFile).not.toHaveBeenCalled();
    delete window.vexConfirm;
  });

  it('says so rather than opening nothing when the download fails', async () => {
    start({ id: 'd4' });
    DownloadsPanel.setOpenWhenDone('d4', true);
    DownloadsPanel._onComplete({ id: 'd4', state: 'failed' });
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/did not finish/), 'info'));
    expect(window.vex.downloadsOpenFile).not.toHaveBeenCalled();
  });
});

// Audit RD12 (2026-10-10): a file deleted after it downloaded still said
// "completed", and Open failed with "Failed to open path".
describe('a finished download whose file has been deleted', () => {
  const finish = (id, path) => { start({ id, path }); DownloadsPanel._onComplete({ id, state: 'completed', path, receivedBytes: 10, totalBytes: 10 }); };
  const row = (id) => [...document.querySelectorAll('.download-item')].find(r => r.dataset.id === id);

  it('says "deleted" and offers Retry, not Open, when the panel opens; a file put back shows Open again', async () => {
    finish('k1', 'C:/dl/kept.pdf');
    finish('g1', 'C:/dl/gone.pdf');
    window.vex.downloadsExist = vi.fn(async (paths) => ({ ok: true, exist: paths.map(p => p !== 'C:/dl/gone.pdf') }));
    DownloadsPanel.init();
    await vi.waitFor(() => expect(row('g1').querySelector('.download-meta').textContent).toContain('deleted'));
    expect(window.vex.downloadsExist).toHaveBeenCalledWith(['C:/dl/gone.pdf', 'C:/dl/kept.pdf']);
    expect(row('g1').querySelector('[data-action="open-file"]')).toBeNull();
    expect(row('g1').querySelector('[data-action="retry"]')).not.toBeNull();
    expect(row('k1').querySelector('[data-action="open-file"]')).not.toBeNull();
    expect(row('k1').querySelector('.download-meta').textContent).toContain('completed');
    expect(JSON.parse(localStorage.getItem('vex.downloads')).find(d => d.id === 'g1').missing).toBe(true);
    row('g1').querySelector('[data-action="retry"]').click();
    await vi.waitFor(() => expect(window.vex.downloadsRetry).toHaveBeenCalledWith('https://example.test/thing.bin', 'g1'));
    window.vex.downloadsExist = vi.fn(async (paths) => ({ ok: true, exist: paths.map(() => true) }));
    await DownloadsPanel.checkDeleted();
    expect(row('g1').querySelector('[data-action="open-file"]')).not.toBeNull();
  });

  it('Open on a file deleted since the panel was drawn says so and opens nothing', async () => {
    finish('g2', 'C:/dl/gone2.pdf');
    window.vex.downloadsExist = vi.fn(async (paths) => ({ ok: true, exist: paths.map(() => true) }));
    DownloadsPanel.init();
    await vi.waitFor(() => expect(window.vex.downloadsExist).toHaveBeenCalled());
    window.vex.downloadsExist = vi.fn(async (paths) => ({ ok: true, exist: paths.map(() => false) }));
    row('g2').querySelector('[data-action="open-file"]').click();
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalledWith('thing.bin has been deleted — Retry downloads it again', 'info'));
    expect(window.vex.downloadsOpenFile).not.toHaveBeenCalled();
    expect(row('g2').querySelector('[data-action="retry"]')).not.toBeNull();
  });

  it('a file Vex cannot look for (null) is left as it is', async () => {
    finish('n1', 'C:/dl/other.pdf');
    window.vex.downloadsExist = vi.fn(async () => ({ ok: true, exist: [null] }));
    expect(await DownloadsPanel.checkDeleted()).toEqual([]);
    expect(row('n1').querySelector('[data-action="open-file"]')).not.toBeNull();
  });
});

describe('a download whose connection dropped', () => {
  const actions = () => [...document.querySelector('.download-item[data-id="d1"]').querySelectorAll('[data-action]')].map(b => b.dataset.action);
  it('loses Pause, offers Resume and Cancel, and gets Pause back once it runs again', async () => {
    start();
    expect(actions()).toContain('pause');
    DownloadsPanel._onProgress({ id: 'd1', receivedBytes: 300, totalBytes: 1000, paused: false, canResume: true, state: 'interrupted' });
    expect(actions()).toEqual(['resume', 'cancel', 'copy-link', 'remove']);
    document.querySelector('.download-item[data-id="d1"] [data-action="resume"]').click();
    await vi.waitFor(() => expect(window.vex.downloadsControl).toHaveBeenCalledWith('d1', 'resume'));
    await vi.waitFor(() => expect(actions()).toContain('pause'));
  });
  it('without resume support offers only Cancel', () => {
    start();
    DownloadsPanel._onProgress({ id: 'd1', receivedBytes: 300, totalBytes: 1000, paused: false, canResume: false, state: 'interrupted' });
    expect(actions()).toEqual(['cancel', 'copy-link', 'remove']);
  });
});

describe('search, copy link, delete file, drag out', () => {
  const finished = (id, name, url) => {
    DownloadsPanel._onStart({ id, fileName: name, url, totalBytes: 10, path: 'C:/dl/' + name, startedAt: '2026-01-01T00:00:00.000Z' });
    DownloadsPanel._onComplete({ id, fileName: name, state: 'completed', path: 'C:/dl/' + name, url, receivedBytes: 10, totalBytes: 10 });
  };
  const rowOf = (id) => [...document.querySelectorAll('.download-item')].find(r => r.dataset.id === id);

  it('search shows only the downloads whose name or address matches', () => {
    finished('a', 'invoice.pdf', 'https://billing.example/x');
    finished('b', 'photo.png', 'https://pics.example/y');
    const box = document.getElementById('downloads-search');
    box.value = 'pics';
    box.dispatchEvent(new Event('input'));
    expect(rowOf('a').hidden).toBe(true);
    expect(rowOf('b').hidden).toBe(false);
    // A row redrawn while searching keeps the search.
    finished('c', 'invoice2.pdf', 'https://billing.example/z');
    expect(rowOf('c').hidden).toBe(true);
    box.value = 'nothing like it';
    box.dispatchEvent(new Event('input'));
    expect(document.querySelector('.downloads-no-match').textContent).toContain('No downloads match');
    box.value = '';
    box.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.download-item[hidden]')).toHaveLength(0);
    expect(document.querySelector('.downloads-no-match')).toBeNull();
  });

  it('Copy download link puts the address on the clipboard', async () => {
    finished('a', 'invoice.pdf', 'https://billing.example/x');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    rowOf('a').querySelector('[data-action="copy-link"]').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('https://billing.example/x'));
    expect(window.showToast).toHaveBeenCalledWith('Download link copied');
  });

  it('Delete file asks first, and the row then says deleted', async () => {
    finished('a', 'invoice.pdf', 'https://billing.example/x');
    window.vex.downloadsDeleteFile = vi.fn(async () => ({ ok: true }));
    globalThis.vexConfirm = vi.fn(async () => false);
    rowOf('a').querySelector('[data-action="delete-file"]').click();
    await vi.waitFor(() => expect(globalThis.vexConfirm).toHaveBeenCalled());
    expect(window.vex.downloadsDeleteFile).not.toHaveBeenCalled();
    globalThis.vexConfirm = vi.fn(async () => true);
    rowOf('a').querySelector('[data-action="delete-file"]').click();
    await vi.waitFor(() => expect(window.vex.downloadsDeleteFile).toHaveBeenCalledWith('C:/dl/invoice.pdf'));
    await vi.waitFor(() => expect(rowOf('a').querySelector('.download-meta').textContent).toContain('deleted'));
    expect(rowOf('a').querySelector('[data-action="open-file"]')).toBeNull();
  });

  it('a finished download can be dragged out; main starts the drag of its file', async () => {
    finished('a', 'invoice.pdf', 'https://billing.example/x');
    window.vex.downloadsStartDrag = vi.fn(async () => ({ ok: true }));
    const row = rowOf('a');
    expect(row.getAttribute('draggable')).toBe('true');
    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    row.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(window.vex.downloadsStartDrag).toHaveBeenCalledWith('C:/dl/invoice.pdf');
  });
});

describe('the sorting-rule editor (RD8)', () => {
  it('accepts ".pdf from https://github.com/" as pdf files from github.com', async () => {
    const answers = ['add', '.pdf from https://github.com/', 'Invoices', ''];
    globalThis.vexPrompt = vi.fn(async () => answers.shift());
    globalThis.vexId = (p) => p + '1';
    window.vex.downloadsSetRules = vi.fn(async () => ({ ok: true }));
    const list = await DownloadsPanel.editRules();
    expect(window.showToast).not.toHaveBeenCalledWith('Say a kind of file, a site, or both', 'error');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ext: 'pdf', site: 'github.com', folder: 'Invoices' });
  });
});
