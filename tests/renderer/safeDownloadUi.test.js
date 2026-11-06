// @vitest-environment jsdom
//
// The Safe Download Assistant on screen (js/safe-download-ui.js, with the Downloads panel and the finished-download card):
// the mark and its "Why?" fold, "Open anyway..." with a confirm that repeats the top reason, Quarantine, Turkish, and that nothing
// the file's name holds can become markup. What it looks like is checked in the real app.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadsPanel } from '../../src/renderer/js/downloads-panel.js';

const groups = { register: vi.fn() };
globalThis.VexSettingsGroups = groups; window.VexSettingsGroups = groups;
window.VexModuleCommands = { set: vi.fn() };
const { VexSafeDownload } = require('../../src/renderer/js/safe-download-ui.js');
const { DownloadToast } = require('../../src/renderer/js/download-toast.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { judge } = require('../../src/main/download-verdict');

const red = () => judge({ name: 'invoice.pdf', checked: true, detected: 'program' });
const amber = () => judge({ name: 'setup.exe', checked: true, detected: 'program', signature: { status: 'NotSigned', signer: '' } });
const green = () => judge({ name: 'a.pdf', checked: true, detected: 'pdf' });

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
  window.vexTr = (s) => VexI18nUI.tr(s);
  globalThis.VexI18nUI = VexI18nUI;
  globalThis.VexSafeDownload = VexSafeDownload;
  window.VexSafeDownload = VexSafeDownload;
  globalThis.DownloadToast = DownloadToast;
  window.DownloadToast = DownloadToast;
  globalThis.vexConfirm = vi.fn(async () => true);
  window.vexConfirm = globalThis.vexConfirm;
  delete globalThis.VexAttention;
  window.vex = {
    onDownloadStarted: vi.fn(), onDownloadProgress: vi.fn(), onDownloadComplete: vi.fn(),
    downloadsControl: vi.fn(), downloadsRetry: vi.fn(), downloadsOpenFile: vi.fn(async () => ({ ok: true })), downloadsShowInFolder: vi.fn(),
    safeDownload: { quarantine: vi.fn(async (p) => ({ ok: true, path: 'C:/q/' + p.split('/').pop() + '.quarantined', name: 'x' })) },
  };
  window.DownloadsPanel = DownloadsPanel;
  VexI18nUI.locale = () => 'en';
  shell();
});

const start = (over = {}) => DownloadsPanel._onStart({ id: 'd1', fileName: 'invoice.pdf', url: 'https://example.test/invoice.pdf', totalBytes: 1000, path: 'C:/dl/invoice.pdf', startedAt: '2026-01-01T00:00:00Z', ...over });
const finish = (safe, over = {}) => DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/invoice.pdf', receivedBytes: 10, totalBytes: 10, safe, ...over });

describe('the mark on the row and in the card', () => {
  it('a red file shows the headline, a Why? fold with the reasons, and the toast carries it too', () => {
    start();
    finish(red());
    const row = document.querySelector('.download-item');
    expect(row.querySelector('.vex-sd-red .vex-sd-word').textContent).toBe('Do not open this file');
    expect(row.querySelector('details.vex-sd-why summary').textContent).toBe('Why?');
    expect(row.querySelector('.vex-sd-list').textContent).toContain('Windows program');
    expect(row.querySelector('.vex-sd-r-red b').textContent).toBe('Warning:');
    const toast = document.querySelector('.download-toast');
    expect(toast.querySelector('.vex-sd-red')).toBeTruthy();
    expect(toast.querySelector('[data-action="open"]').textContent).toBe('Open anyway...');
  });
  it('green says so in words and keeps plain Open', () => {
    start({ fileName: 'a.pdf', path: 'C:/dl/a.pdf' });
    finish(green(), { path: 'C:/dl/a.pdf' });
    const row = document.querySelector('.download-item');
    expect(row.querySelector('.vex-sd-green .vex-sd-word').textContent).toBe('No warning signs found');
    expect(row.querySelector('[data-action="open-file"]').textContent).toBe('Open');
    expect(row.querySelector('[data-action="quarantine"]')).toBeNull();
    expect(document.querySelector('.download-toast [data-action="open"]').textContent).toBe('Open');
  });
  it('the mark is a labelled group (colour is never the only signal)', () => {
    start(); finish(amber());
    const g = document.querySelector('.vex-sd');
    expect(g.getAttribute('role')).toBe('group');
    expect(g.getAttribute('aria-label')).toContain('Be careful with this file');
    expect(document.querySelector('.vex-sd-r-amber b').textContent).toBe('Careful:');
  });
  it('the old file-check warning is not drawn twice when the assistant has spoken', () => {
    start();
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/invoice.pdf', receivedBytes: 10, totalBytes: 10, safe: red(), fileCheck: { checked: true, worst: 'high', findings: [{ level: 'high', kind: 'k', text: 'Old warning' }] } });
    expect(document.querySelector('.download-item .download-warn')).toBeNull();
    expect(window.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Old warning'), 'error', 12000);
  });
  it('with the assistant off (no verdict) the old file check still shows', () => {
    start();
    DownloadsPanel._onComplete({ id: 'd1', state: 'completed', path: 'C:/dl/invoice.pdf', receivedBytes: 10, totalBytes: 10, safe: null, fileCheck: { checked: true, worst: 'high', findings: [{ level: 'high', kind: 'k', text: 'Old warning' }] } });
    expect(document.querySelector('.download-item .download-warn').textContent).toContain('Old warning');
  });
  it('a red verdict is also said loudly through the attention gate', () => {
    globalThis.VexAttention = { notify: vi.fn() };
    start(); finish(red());
    expect(globalThis.VexAttention.notify.mock.calls[0][0]).toMatchObject({ feature: 'download-file-check', urgency: 'critical' });
    delete globalThis.VexAttention;
  });
  it('shows in Turkish when the language is Turkish', () => {
    VexI18nUI.locale = () => 'tr';
    start(); finish(red());
    const row = document.querySelector('.download-item');
    expect(row.querySelector('.vex-sd-word').textContent).toBe('Bu dosyayı açmayın');
    expect(row.querySelector('summary').textContent).toBe('Neden?');
    expect(row.querySelector('.vex-sd-list').textContent).toContain('Windows programı');
    expect(row.querySelector('.vex-sd-r-red b').textContent).toBe('Uyarı:');
    expect(row.querySelector('[data-action="open-file"]').textContent).toBe('Yine de aç...');
  });
  it('no markup can come out of a verdict', () => {
    start();
    finish({ level: 'amber', headline: { en: '<img src=x onerror=alert(1)>', tr: '' }, reasons: [{ id: 'x', level: 'amber', en: '<script>alert(1)</script>', tr: '' }] });
    expect(document.querySelector('.download-item img')).toBeNull();
    expect(document.querySelector('.download-item script')).toBeNull();
    expect(document.querySelector('.vex-sd-list').textContent).toContain('<script>');
  });
  it('a malformed verdict is dropped instead of drawn', () => {
    start();
    finish({ level: 'purple', reasons: 'no' });
    expect(document.querySelector('.vex-sd')).toBeNull();
    expect(DownloadsPanel.downloads[0].safe).toBeUndefined();
  });
  it('is kept bounded: ten reasons at most, 500 characters each', () => {
    start();
    finish({ level: 'amber', headline: { en: 'h', tr: 'h' }, reasons: Array.from({ length: 30 }, () => ({ id: 'i', level: 'info', en: 'x'.repeat(2000), tr: 'y' })) });
    const kept = DownloadsPanel.downloads[0].safe;
    expect(kept.reasons.length).toBe(10);
    expect(kept.reasons[0].en.length).toBe(500);
  });
});

describe('Open anyway...', () => {
  it('asks, repeating the top reason, and opens only after Open anyway', async () => {
    start(); finish(red());
    const dl = DownloadsPanel.downloads[0];
    globalThis.vexConfirm.mockResolvedValueOnce(false);
    expect(await DownloadsPanel._okToOpen(dl.path, dl.url)).toBe(false);
    const arg = globalThis.vexConfirm.mock.calls[0][0];
    expect(arg.message).toContain(dl.safe.top.en);
    expect(arg.okLabel).toBe('Open anyway');
    expect(arg.danger).toBe(true);
    expect(arg.extra.label).toBe('Quarantine');
    globalThis.vexConfirm.mockResolvedValueOnce(true);
    expect(await DownloadsPanel._okToOpen(dl.path, dl.url)).toBe(true);
  });
  it('the row button and the card button both go through it, and Cancel opens nothing', async () => {
    start(); finish(red());
    globalThis.vexConfirm.mockResolvedValue(false);
    document.querySelector('.download-item [data-action="open-file"]').click();
    document.querySelector('.download-toast [data-action="open"]').click();
    await new Promise(r => setTimeout(r, 10));
    expect(globalThis.vexConfirm).toHaveBeenCalledTimes(2);
    expect(window.vex.downloadsOpenFile).not.toHaveBeenCalled();
  });
  it('after Open anyway the file opens', async () => {
    start(); finish(amber(), { path: 'C:/dl/invoice.pdf' });
    globalThis.vexConfirm.mockResolvedValue(true);
    document.querySelector('.download-item [data-action="open-file"]').click();
    await new Promise(r => setTimeout(r, 10));
    expect(window.vex.downloadsOpenFile).toHaveBeenCalledWith('C:/dl/invoice.pdf');
    expect(globalThis.vexConfirm.mock.calls[0][0].danger).toBe(false);
    expect(globalThis.vexConfirm.mock.calls[0][0].extra).toBeUndefined();
  });
  it('Show in folder and Delete stay one click: no confirm in their way', () => {
    start(); finish(red());
    document.querySelector('.download-item [data-action="show-in-folder"]').click();
    expect(window.vex.downloadsShowInFolder).toHaveBeenCalled();
    expect(document.querySelector('.download-item [data-action="delete-file"]')).toBeTruthy();
    expect(globalThis.vexConfirm).not.toHaveBeenCalled();
  });
});

describe('Quarantine', () => {
  it('is offered for red only, asks, moves, and then there is no Open', async () => {
    start(); finish(amber());
    expect(document.querySelector('[data-action="quarantine"]')).toBeNull();
    shell(); start(); finish(red());
    document.querySelector('[data-action="quarantine"]').click();
    await new Promise(r => setTimeout(r, 10));
    expect(globalThis.vexConfirm).toHaveBeenCalledOnce();
    expect(window.vex.safeDownload.quarantine).toHaveBeenCalledWith('C:/dl/invoice.pdf');
    const row = document.querySelector('.download-item');
    expect(row.querySelector('[data-action="open-file"]')).toBeNull();
    expect(row.querySelector('[data-action="quarantine"]')).toBeNull();
    expect(row.textContent).toContain('In quarantine');
    expect(DownloadsPanel.downloads[0].path).toContain('.quarantined');
    expect(row.querySelector('[data-action="show-in-folder"]')).toBeTruthy();
  });
  it('the Quarantine button inside the Open anyway box moves it without a second question', async () => {
    start(); finish(red());
    document.querySelector('.download-item [data-action="open-file"]').click();
    await new Promise(r => setTimeout(r, 10));
    const arg = globalThis.vexConfirm.mock.calls[0][0];
    globalThis.vexConfirm.mockClear();
    arg.extra.run();
    await new Promise(r => setTimeout(r, 10));
    expect(globalThis.vexConfirm).not.toHaveBeenCalled();
    expect(window.vex.safeDownload.quarantine).toHaveBeenCalled();
  });
  it('a refusal from main is shown, and the row is left alone', async () => {
    window.vex.safeDownload.quarantine = vi.fn(async () => ({ ok: false, error: 'That file is not there any more' }));
    start(); finish(red());
    document.querySelector('[data-action="quarantine"]').click();
    await new Promise(r => setTimeout(r, 10));
    expect(window.showToast).toHaveBeenCalledWith('That file is not there any more', 'error');
    expect(DownloadsPanel.downloads[0].quarantined).toBeUndefined();
  });
});

describe('Settings and the fold', () => {
  it('the Settings section writes its choices through the bridge', async () => {
    const state = { on: true, strictness: 'normal', checks: { content: true, archives: true, signature: true, source: true } };
    const set = vi.fn(async (patch) => { Object.assign(state, patch, { checks: { ...state.checks, ...(patch.checks || {}) } }); return { ...state }; });
    window.vex.safeDownload = { get: vi.fn(async () => ({ ...state })), set, quarantine: vi.fn() };
    window.ProtectSettings = {
      toggle: ({ text, checked, onChange }) => { const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = checked; i.addEventListener('change', () => onChange(i.checked)); l.append(i, text); return l; },
    };
    const body = document.createElement('div');
    document.body.append(body);
    VexSafeDownload.render(body);
    await new Promise(r => setTimeout(r, 0));
    const boxes = body.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(5);
    boxes[0].checked = false; boxes[0].dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));
    expect(set).toHaveBeenCalledWith({ on: false });
    expect(body.querySelector('select').disabled).toBe(true);
    boxes[0].checked = true; boxes[0].dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));
    const sel = body.querySelector('select');
    sel.value = 'strict'; sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));
    expect(set).toHaveBeenLastCalledWith({ strictness: 'strict' });
    boxes[3].checked = false; boxes[3].dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));
    expect(set).toHaveBeenLastCalledWith({ checks: { signature: false } });
  });
  it('a quick look at a zip bomb is refused in words', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/download-quicklook.js'), 'utf8');
    expect(src).toContain('dl.safe.noPreview');
  });
});
