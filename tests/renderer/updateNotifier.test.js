// @vitest-environment jsdom
//
// The update flow's failure paths. An update that cannot download has to say
// so: the error used to go to a console nobody has open while the progress bar
// sat at 0%, and a release with no asset URL opened an "undefined" tab behind a
// toast that announced the download anyway.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');

let toasts, handlers;
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  toasts = [];
  handlers = {};
  window.showToast = (message, type, duration) => toasts.push({ message, type, duration });
  window.vex = {
    onUpdateAvailable: (cb) => { handlers.available = cb; },
    onUpdateDownloadProgress: (cb) => { handlers.progress = cb; },
    onUpdateDownloaded: (cb) => { handlers.downloaded = cb; },
    onUpdateError: (cb) => { handlers.error = cb; },
    checkForUpdates: vi.fn(async () => ({ ok: true, hasUpdate: false })),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
  };
  require('../../src/renderer/js/update-notifier.js');
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const lastToast = () => toasts[toasts.length - 1] || {};

describe('update notifier', () => {
  it('shows a download failure in the notification, with a retry', () => {
    const notifier = window.UpdateNotifier;
    notifier.init();
    notifier._showAvailable({ version: '9.9.9' });
    document.getElementById('update-dl-btn').click();
    expect(window.vex.downloadUpdate).toHaveBeenCalled();

    handlers.error(new Error('ENOTFOUND github.com'));
    const el = document.getElementById('update-notification');
    expect(el.querySelector('.update-notif-title').textContent).toMatch(/Update failed/);
    expect(el.querySelector('.update-notif-sub').textContent).toMatch(/ENOTFOUND/);
    expect(document.getElementById('upd-retry')).toBeTruthy();
  });

  it('falls back to a toast when there is no notification on screen', () => {
    const notifier = window.UpdateNotifier;
    notifier.init();
    handlers.error(new Error('signature check failed'));
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/signature check failed/);
  });

  it('refuses to announce a download for a release with no asset link', () => {
    const notifier = window.UpdateNotifier;
    const created = [];
    global.TabManager = { createTab: (u) => created.push(u) };
    notifier._showDownloadPrompt({ latest: '9.9.9', current: '9.9.8' });   // no downloadUrl
    document.getElementById('update-get-btn').click();
    expect(created).toHaveLength(0);
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/no download link/i);
    delete global.TabManager;
  });

  it('only opens https download links', () => {
    const notifier = window.UpdateNotifier;
    const created = [];
    global.TabManager = { createTab: (u) => created.push(u) };
    notifier._showDownloadPrompt({ latest: '9.9.9', current: '9.9.8', downloadUrl: 'javascript:alert(1)' });
    document.getElementById('update-get-btn').click();
    expect(created).toHaveLength(0);

    notifier._showDownloadPrompt({ latest: '9.9.9', current: '9.9.8', downloadUrl: 'https://github.com/x/Vex-Setup.exe' });
    document.getElementById('update-get-btn').click();
    expect(created).toEqual(['https://github.com/x/Vex-Setup.exe']);
    delete global.TabManager;
  });

  it('rounds the download percentage instead of printing it raw', () => {
    const notifier = window.UpdateNotifier;
    notifier._showAvailable({ version: '9.9.9' });
    document.getElementById('update-dl-btn').click();
    notifier._updateProgress({ percent: 12.3456 });
    expect(document.getElementById('upd-text').textContent).toBe('12%');
    notifier._updateProgress({ percent: 9999 });
    expect(document.getElementById('upd-text').textContent).toBe('100%');
    notifier._updateProgress({});
    expect(document.getElementById('upd-text').textContent).toBe('0%');
  });

  it('a manual check that fails is reported as an error, not an aside', async () => {
    const notifier = window.UpdateNotifier;
    window.vex.checkForUpdates = async () => ({ ok: false, error: 'rate limited' });
    await notifier.checkManually();
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/rate limited/);
  });
});
