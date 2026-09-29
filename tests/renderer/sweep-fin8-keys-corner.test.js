// @vitest-environment jsdom
// Fixed in the 2026-09-29 sweep (fin8-keys): a download card lay on top of the
// update card's buttons in the bottom-right corner ("Skip this one" clicked
// the download's Show). The update card now sits in the download cards'
// column, so the two stack instead of overlapping.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

require('../../src/renderer/js/vex-utils.js');

beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = () => {};
  window.vex = {};
  const fresh = (rel) => { const f = require.resolve(rel); delete require.cache[f]; return require(f); };
  fresh('../../src/renderer/js/update-notifier.js');
  fresh('../../src/renderer/js/download-toast.js');
});

const info = { ok: true, hasUpdate: true, latest: '9.9.9', current: '1.0.0', downloadUrl: 'https://example.com/x.exe' };

describe('update card and download cards share one column', () => {
  it('update first, then a download: one container, the update card at the bottom', () => {
    window.UpdateNotifier._showDownloadPrompt(info);
    window.DownloadToast.show({ filename: 'a.zip', path: 'C:/a.zip', size: 10 });
    const c = document.getElementById('download-toast-container');
    expect(document.querySelectorAll('#download-toast-container').length).toBe(1);
    // column-reverse: the first child is the bottom one.
    expect(c.firstElementChild.id).toBe('update-notification');
    expect(c.querySelectorAll('.download-toast').length).toBe(1);
  });

  it('a download first, then the update: the update card still goes to the bottom', () => {
    window.DownloadToast.show({ filename: 'a.zip', path: 'C:/a.zip', size: 10 });
    window.UpdateNotifier._showAvailable({ version: '9.9.9' });
    const c = document.getElementById('download-toast-container');
    expect(c.firstElementChild.id).toBe('update-notification');
    // Showing it again replaces it rather than adding a second.
    window.UpdateNotifier._showDownloadPrompt(info);
    expect(document.querySelectorAll('#update-notification').length).toBe(1);
    expect(c.firstElementChild.id).toBe('update-notification');
  });

  it('inside the column the card is placed by it and takes clicks', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/update-notifier.css'), 'utf8');
    expect(css).toMatch(/#download-toast-container > \.update-notif \{[^}]*position: static;[^}]*pointer-events: auto;/);
  });
});
