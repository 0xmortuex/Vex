// @vitest-environment jsdom
//
// Settings › Extensions: automatic updates (an update that waits for approval,
// "Check now", the on/off switch), "Allow access to file URLs" per extension,
// where each one came from, and the .zip / .crx / folder install going through
// the permissions dialog before anything is installed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/extension-catalog.js');
const { ExtensionsSettings } = require('../../src/renderer/js/extensions-settings.js');
const { VexWebStore } = require('../../src/renderer/js/web-store.js');

const flush = () => new Promise(r => setTimeout(r, 0));
const base = { folder: 'tester-1', name: 'Tester', version: '1.0.0', enabled: true, loaded: true, where: [], scope: 'auto', audit: null };

function setup(list, vexOver = {}) {
  window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.vexAlert = vi.fn(async () => {});
  globalThis.vexConfirm = window.vexConfirm;
  globalThis.vexAlert = window.vexAlert;
  globalThis.VexWebStore = VexWebStore;
  window.vex = {
    extensionsList: async () => list,
    extensionsUpdateStatus: async () => ({ ok: true, auto: true, lastCheck: Date.now() - 3 * 3600 * 1000, lastOutcome: 'Every extension is up to date.', checking: false }),
    ...vexOver,
  };
  document.body.innerHTML = '<div id="extensions-panel-content"></div>';
  return document.getElementById('extensions-panel-content');
}

describe('Settings › Extensions: updates and file access', () => {
  beforeEach(() => { document.head.innerHTML = ''; });

  it('shows the automatic-update switch, the last check and "Check now"', async () => {
    const c = setup([base]);
    await ExtensionsSettings.render(c);
    expect(c.querySelector('#ext-auto-update').checked).toBe(true);
    expect(c.querySelector('#ext-updates-status').textContent).toMatch(/Last checked 3 h ago\. Every extension is up to date\./);
    expect(c.querySelector('#btn-ext-check-updates')).not.toBeNull();
  });

  it('switching automatic updates off is saved in main', async () => {
    const set = vi.fn(async (on) => ({ ok: true, auto: on }));
    const c = setup([base], { extensionsSetAutoUpdate: set });
    await ExtensionsSettings.render(c);
    const box = c.querySelector('#ext-auto-update');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect(set).toHaveBeenCalledWith(false);
  });

  it('an update that asks for more waits on the card, with what it asks for and an Update button', async () => {
    const approve = vi.fn(async () => ({ ok: true, version: '2.0.0', name: 'Tester' }));
    const ext = { ...base, source: { kind: 'webstore', id: 'a'.repeat(32) }, update: { pending: { version: '2.0.0', added: [{ id: 'cookies', says: 'Read and change your cookies' }] }, error: null, last: null } };
    const c = setup([ext], { extensionsUpdateApprove: approve });
    await ExtensionsSettings.render(c);
    const card = c.querySelector('.extension-card');
    expect(card.textContent).toMatch(/Update needs approval/);
    expect(card.textContent).toMatch(/Read and change your cookies/);
    expect(card.textContent).toMatch(/From the Chrome Web Store/);
    card.querySelector('[data-update-approve]').click();
    await flush(); await flush();
    expect(window.vexConfirm).toHaveBeenCalled();
    expect(approve).toHaveBeenCalledWith('tester-1');
  });

  it('says how it was updated last, and a failed check', async () => {
    const ext = { ...base, source: { kind: 'catalog', id: 'dark-reader', repo: 'darkreader/darkreader', tag: 'v4.9.133', digestChecked: true },
      update: { pending: null, error: 'GitHub answered 503', last: { at: Date.now(), from: '4.9.120', to: '4.9.133', how: 'auto' } } };
    const c = setup([ext]);
    await ExtensionsSettings.render(c);
    const t = c.querySelector('.extension-card').textContent;
    expect(t).toMatch(/Updated automatically from v4\.9\.120 to v4\.9\.133/);
    expect(t).toMatch(/Last update check failed: GitHub answered 503/);
    expect(t).toMatch(/darkreader\/darkreader, v4\.9\.133/);
    expect(t).toMatch(/matched the digest GitHub published/);
  });

  it('a file or folder install says Vex cannot update it', async () => {
    const c = setup([{ ...base, source: null }]);
    await ExtensionsSettings.render(c);
    expect(c.querySelector('.extension-card').textContent).toMatch(/not from the Chrome Web Store, and Vex cannot update it/);
  });

  it('file access is off unless allowed, and says why when it was kept on', async () => {
    const set = vi.fn(async (_f, allow) => ({ ok: true, allow }));
    const c = setup([
      { ...base, folder: 'a-1', fileAccess: false, fileUrls: true },
      { ...base, folder: 'b-2', fileAccess: true, fileAccessKept: true, fileUrls: true },
    ], { extensionsSetFileAccess: set });
    await ExtensionsSettings.render(c);
    const [a, b] = [...c.querySelectorAll('[data-file-access]')];
    expect(a.checked).toBe(false);
    expect(b.checked).toBe(true);
    const cards = c.querySelectorAll('.extension-card');
    expect(cards[0].textContent).toMatch(/cannot run on files on this computer until you allow this/);
    expect(cards[1].textContent).toMatch(/Left on when Vex made this a choice/);
    a.checked = true;
    a.dispatchEvent(new Event('change'));
    await flush();
    expect(set).toHaveBeenCalledWith('a-1', true);
  });

  it('a picked .crx shows the permissions dialog first, and only then installs it by token', async () => {
    const preview = { ok: true, token: 'f'.repeat(32), name: 'Tester', version: '1.0.0', source: 'developer', id: 'b'.repeat(32), file: 'tester.crx',
      reach: { level: 'some', says: 'Can read and change pages on example.com' }, powers: [], permissions: ['storage'], optionalPermissions: [], hostPermissions: ['https://example.com/*'], cautions: [], installed: null };
    const pickedInstall = vi.fn(async () => ({ ok: true, name: 'Tester', version: '1.0.0' }));
    const c = setup([], { extensionsInstallZip: async () => preview, extensionsInstallPicked: pickedInstall });
    await ExtensionsSettings.render(c);
    c.querySelector('#btn-install-zip').click();
    await flush(); await flush();
    const arg = window.vexConfirm.mock.calls[0][0];
    expect(arg.html).toMatch(/not from the Chrome Web Store/);
    expect(arg.html).toMatch(/signed themselves/);
    expect(pickedInstall).toHaveBeenCalledWith('f'.repeat(32));
  });

  it('saying no installs nothing', async () => {
    const pickedInstall = vi.fn();
    const c = setup([], { extensionsInstallFolder: async () => ({ ok: true, token: 'e'.repeat(32), name: 'X', version: '1', source: 'folder', reach: null, powers: [], cautions: [] }), extensionsInstallPicked: pickedInstall });
    window.vexConfirm = vi.fn(async () => false);
    globalThis.vexConfirm = window.vexConfirm;
    await ExtensionsSettings.render(c);
    c.querySelector('#btn-install-folder').click();
    await flush(); await flush();
    expect(window.vexConfirm.mock.calls[0][0].html).toMatch(/from a folder on this computer/);
    expect(pickedInstall).not.toHaveBeenCalled();
  });

  it('a refused package is explained, not installed', async () => {
    const pickedInstall = vi.fn();
    const c = setup([], { extensionsInstallZip: async () => ({ ok: true, token: 'd'.repeat(32), name: 'A Theme', refuse: 'This is a Chrome theme, not an extension.' }), extensionsInstallPicked: pickedInstall });
    await ExtensionsSettings.render(c);
    c.querySelector('#btn-install-zip').click();
    await flush(); await flush();
    expect(window.vexAlert).toHaveBeenCalled();
    expect(pickedInstall).not.toHaveBeenCalled();
  });
});
