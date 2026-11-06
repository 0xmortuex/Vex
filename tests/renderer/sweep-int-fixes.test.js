// @vitest-environment jsdom
//
// Fixes from the 2026-09-29 sweep: extension popups from Settings know the
// page, the catalogue stays open after Install, uninstall names the extension,
// deep links land on the right Settings section, the GitHub panel shows the
// right user and says why it failed, mail errors read as sentences, and the
// safe-mode banner promises only what safe mode does.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { VexExtensionCatalog } = require('../../src/renderer/js/extension-catalog.js');
const { ExtensionsSettings } = require('../../src/renderer/js/extensions-settings.js');
const { ExtensionsMenu } = require('../../src/renderer/js/extensions-menu.js');
const { VexMail } = require('../../src/renderer/js/mail.js');
const { SafeModeBanner } = require('../../src/renderer/js/safe-mode-banner.js');
const GitHubPanel = new Function(fs.readFileSync(path.join(__dirname, '../../src/renderer/js/github-panel.js'), 'utf8') + '\nreturn GitHubPanel;')();

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  globalThis.VexExtensionCatalog = VexExtensionCatalog;
  globalThis.SettingsUI = { openSection: vi.fn() };
  globalThis.TabManager = { createTab: vi.fn() };
  globalThis.WebviewManager = { getActiveWebview: () => ({ getWebContentsId: () => 42 }) };
  globalThis.vexConfirm = vi.fn(async () => false);
});

const EXT = { folder: 'devforum-plus-1790659315165', name: 'DevForum+', version: '1.2', enabled: true, loaded: true, hasPopup: true, error: null };

describe('Settings › Extensions', () => {
  function mount(list) {
    window.vex = {
      extensionsList: vi.fn(async () => list),
      extensionsOpenPopup: vi.fn(async () => ({ ok: true })),
      extensionsInstallCatalog: vi.fn(async () => ({ ok: true, name: 'Dark Reader', version: '4.9' })),
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    return c;
  }

  it('a popup opened from Settings is given the active tab, like the toolbar menu', async () => {
    const c = mount([EXT]);
    await ExtensionsSettings.render(c);
    c.querySelector('[data-popup]').click();
    await tick();
    expect(window.vex.extensionsOpenPopup).toHaveBeenCalledWith(expect.objectContaining({ folder: EXT.folder, tab: 42 }));
  });

  it('the catalogue stays open after Install re-renders the list', async () => {
    const c = mount([EXT]);
    await ExtensionsSettings.render(c);
    const details = c.querySelector('details[data-ext-catalog]');
    expect(details.open).toBe(false);
    details.open = true;
    c.querySelector('[data-install-catalog="dark-reader"]').click();
    await tick(); await tick();
    expect(window.vex.extensionsInstallCatalog).toHaveBeenCalledWith('dark-reader');
    expect(c.querySelector('details[data-ext-catalog]').open).toBe(true);
  });

  // No question any more: it is switched off at once, the toast names the
  // extension (not its folder), Undo turns it back on, and only the toast
  // going removes its files (js/vex-undo.js; main.js uninstall-later).
  it('uninstall names the extension, and its files go only when the Undo toast does', async () => {
    require('../../src/renderer/js/vex-undo.js');
    const offers = [];
    window.showToast = vi.fn((message, _t, _d, opts) => { if (opts) offers.push({ message, opts }); return { dismiss() {} }; });
    const c = mount([EXT]);
    Object.assign(window.vex, {
      extensionsUninstallLater: vi.fn(async () => ({ ok: true })),
      extensionsUninstallUndo: vi.fn(async () => ({ ok: true })),
      extensionsUninstall: vi.fn(async () => ({ ok: true })),
    });
    await ExtensionsSettings.render(c);
    c.querySelector('button[data-folder]').click();
    await tick();
    expect(vexConfirm).not.toHaveBeenCalled();
    expect(window.vex.extensionsUninstallLater).toHaveBeenCalledWith(EXT.folder);
    expect(window.vex.extensionsUninstall).not.toHaveBeenCalled();
    expect(offers[0].message).toBe('Uninstalled “DevForum+”');
    expect(offers[0].message).not.toContain('1790659315165');

    offers[0].opts.action.run();
    await tick();
    expect(window.vex.extensionsUninstallUndo).toHaveBeenCalledWith(EXT.folder);
    expect(window.vex.extensionsUninstall).not.toHaveBeenCalled();

    // Again, and this time the toast runs out.
    c.querySelector('button[data-folder]').click();
    await tick();
    offers[1].opts.onExpire();
    await tick();
    expect(window.vex.extensionsUninstall).toHaveBeenCalledWith(EXT.folder);
  });
});

describe('deep links into Settings', () => {
  it('"Manage Chrome extensions…" opens the extensions section', () => {
    ExtensionsMenu._run(ExtensionsMenu.ITEMS.find(i => i.label === 'Manage Chrome extensions…'));
    expect(SettingsUI.openSection).toHaveBeenCalledWith('extensions-panel-content');
  });

  it('the GitHub panel\'s "Open Settings" goes to the username field', () => {
    document.body.innerHTML = '<div id="panel-github"></div>';
    GitHubPanel.username = '';
    GitHubPanel.render();
    document.getElementById('gh-open-settings').click();
    expect(SettingsUI.openSection).toHaveBeenCalledWith('setting-github-username');
  });
});

describe('the GitHub panel', () => {
  const res = (status, body) => ({ ok: status === 200, status, json: async () => body });
  function open(user) {
    document.body.innerHTML = '<div id="panel-github"></div>';
    GitHubPanel.username = user;
    GitHubPanel.cache = { profile: null, repos: null, timestamp: 0 };
    GitHubPanel.render();
  }

  it('ignores a cache that belongs to the previous user', async () => {
    localStorage.setItem('vex-github-cache', JSON.stringify({ user: 'olduser', profile: { login: 'olduser', name: 'Old' }, repos: [], timestamp: Date.now() }));
    const urls = [];
    window.VexNet = { fetch: vi.fn(async (u) => { urls.push(u); return u.includes('/repos?') ? res(200, []) : u.includes('/search/') ? res(200, { items: [] }) : res(200, { login: 'newuser', name: 'New' }); }) };
    open('newuser');
    await GitHubPanel.loadData();
    expect(document.getElementById('gh-panel-name').textContent).toBe('New');
    expect(urls[0]).toBe('https://api.github.com/users/newuser');
    expect(JSON.parse(localStorage.getItem('vex-github-cache')).user).toBe('newuser');
  });

  it('uses the cache when it is the same user\'s', async () => {
    localStorage.setItem('vex-github-cache', JSON.stringify({ user: 'me', profile: { login: 'me', name: 'Me' }, repos: [], timestamp: Date.now() }));
    window.VexNet = { fetch: vi.fn() };
    open('me');
    await GitHubPanel.loadData();
    expect(window.VexNet.fetch).not.toHaveBeenCalled();
    expect(document.getElementById('gh-panel-name').textContent).toBe('Me');
  });

  it('an unknown user replaces every "Loading" with the reason, and the name is encoded in the URL', async () => {
    const urls = [];
    window.VexNet = { fetch: vi.fn(async (u) => { urls.push(u); return res(404, {}); }) };
    open('no such/user');
    await GitHubPanel.loadData();
    expect(urls[0]).toBe('https://api.github.com/users/no%20such%2Fuser');
    const panel = document.getElementById('panel-github').textContent;
    expect(panel).not.toMatch(/Loading/);
    expect(document.getElementById('gh-panel-name').textContent).toContain('GitHub has no user called "no such/user"');
    expect(document.getElementById('gh-panel-repos').textContent).toContain('GitHub has no user called');
  });

  it('offline: says GitHub could not be reached instead of loading forever', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.VexNet = { fetch: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) };
    open('me');
    await GitHubPanel.loadData();
    expect(document.getElementById('gh-panel-name').textContent).toBe('GitHub could not be reached: Failed to fetch');
    expect(document.getElementById('gh-panel-repos').textContent).toContain('could not be reached');
    expect(document.getElementById('panel-github').textContent).not.toMatch(/Loading/);
    err.mockRestore();
  });

  // GitHub allows 60 unsigned requests an hour and a refresh costs about 8: once it says no, the panel keeps what
  // it saved, says when it will try again, and does not ask again before then.
  describe('when GitHub asks Vex to slow down', () => {
    const refuse = (resetInMin) => ({
      ok: false, status: 403, json: async () => ({}),
      headers: { get: (k) => (k === 'x-ratelimit-reset' && resetInMin ? String(Math.floor((Date.now() + resetInMin * 60000) / 1000)) : null) },
    });
    const staleCache = () => localStorage.setItem('vex-github-cache', JSON.stringify({
      user: 'me', profile: { login: 'me', name: 'Me', followers: 3 }, repos: [{ name: 'proj', full_name: 'me/proj', updated_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/me/proj' }],
      ci: {}, work: [], timestamp: Date.now() - 60 * 60000,
    }));

    it('keeps showing the saved answer, with a note saying when it will try again', async () => {
      staleCache();
      window.VexNet = { fetch: vi.fn(async () => refuse(30)) };
      open('me');
      await GitHubPanel.loadData();
      expect(document.getElementById('gh-panel-name').textContent).toBe('Me');
      expect(document.getElementById('gh-panel-repos').textContent).toContain('proj');
      const note = document.getElementById('gh-panel-note').textContent;
      expect(note).toContain('asked Vex to slow down');
      expect(note).toMatch(/try again after \d/);
      expect(note).toContain('Showing what was saved 1h ago');
      expect(JSON.parse(localStorage.getItem('vex-github-cooldown')).user).toBe('me');
    });

    it('does not ask GitHub again until the reset time, however often the panel is opened', async () => {
      staleCache();
      window.VexNet = { fetch: vi.fn(async () => refuse(30)) };
      open('me');
      await GitHubPanel.loadData();
      const calls = window.VexNet.fetch.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) { open('me'); await GitHubPanel.loadData(); }
      expect(window.VexNet.fetch.mock.calls.length).toBe(calls);
      expect(document.getElementById('gh-panel-note').textContent).toContain('asked Vex to slow down');
    });

    it('without a saved answer it says so in every "Loading" spot', async () => {
      window.VexNet = { fetch: vi.fn(async () => refuse(0)) };
      open('me');
      await GitHubPanel.loadData();
      expect(document.getElementById('gh-panel-name').textContent).toContain('asked Vex to slow down');
      expect(document.getElementById('gh-panel-repos').textContent).toContain('asked Vex to slow down');
      expect(document.getElementById('panel-github').textContent).not.toMatch(/Loading/);
      // No header to go by: it waits the default fifteen minutes, not zero.
      expect(JSON.parse(localStorage.getItem('vex-github-cooldown')).until).toBeGreaterThan(Date.now() + 10 * 60000);
    });

    it('asks again once the time has passed, and forgets the cooldown when GitHub answers', async () => {
      staleCache();
      localStorage.setItem('vex-github-cooldown', JSON.stringify({ user: 'me', until: Date.now() - 1000 }));
      window.VexNet = { fetch: vi.fn(async (u) => (u.includes('/repos?') ? res(200, []) : u.includes('/search/') ? res(200, { items: [] }) : res(200, { login: 'me', name: 'Fresh' }))) };
      open('me');
      await GitHubPanel.loadData();
      expect(document.getElementById('gh-panel-name').textContent).toBe('Fresh');
      expect(localStorage.getItem('vex-github-cooldown')).toBeNull();
    });

    it('a cooldown set for another user does not stop this one', async () => {
      localStorage.setItem('vex-github-cooldown', JSON.stringify({ user: 'someone-else', until: Date.now() + 60 * 60000 }));
      window.VexNet = { fetch: vi.fn(async (u) => (u.includes('/repos?') ? res(200, []) : u.includes('/search/') ? res(200, { items: [] }) : res(200, { login: 'me', name: 'Me' }))) };
      open('me');
      await GitHubPanel.loadData();
      expect(window.VexNet.fetch).toHaveBeenCalled();
      expect(document.getElementById('gh-panel-name').textContent).toBe('Me');
    });

    it('offline with a saved answer still shows it, and says GitHub could not be reached', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      staleCache();
      window.VexNet = { fetch: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) };
      open('me');
      await GitHubPanel.loadData();
      expect(document.getElementById('gh-panel-name').textContent).toBe('Me');
      expect(document.getElementById('gh-panel-note').textContent).toContain('GitHub could not be reached: Failed to fetch');
      err.mockRestore();
    });

    it('reads CI for at most MAX_CI repositories, so a refresh stays cheap', async () => {
      const repos = Array.from({ length: 8 }, (_, i) => ({ name: 'r' + i, full_name: 'me/r' + i, pushed_at: '2026-10-0' + (i + 1) + 'T00:00:00Z', updated_at: '2026-10-0' + (i + 1) + 'T00:00:00Z', html_url: 'x' }));
      const urls = [];
      window.VexNet = { fetch: vi.fn(async (u) => { urls.push(u); return u.includes('/actions/runs') ? res(200, { workflow_runs: [] }) : u.includes('/repos?') ? res(200, repos) : u.includes('/search/') ? res(200, { items: [] }) : res(200, { login: 'me', name: 'Me' }); }) };
      open('me');
      await GitHubPanel.loadData();
      expect(urls.filter(u => u.includes('/actions/runs')).length).toBe(GitHubPanel.MAX_CI);
      expect(urls.length).toBe(3 + GitHubPanel.MAX_CI); // profile, repos, search + CI
    });
  });
});

describe('mail', () => {
  it('the sign-in fields stop at mail:add\'s limits', async () => {
    window.vex = { mail: { accounts: () => Promise.resolve({ ok: true, value: [] }) } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    expect(o.querySelector('[data-pass]').maxLength).toBe(512);
    expect(o.querySelector('[data-email]').maxLength).toBe(320);
    expect(o.querySelector('[data-host]').maxLength).toBe(255);
  });

  it('a refused connection is explained, with the detail kept', async () => {
    await expect(VexMail._call(Promise.resolve({ ok: false, error: 'Mail: connect ECONNREFUSED 127.0.0.1:1' })))
      .rejects.toThrow('The mail server refused the connection — check the server name and port. (connect ECONNREFUSED 127.0.0.1:1)');
    await expect(VexMail._call(Promise.resolve({ ok: false, error: 'The mail server did not answer in time' })))
      .rejects.toThrow(/^The mail server did not answer in time$/);
  });
});

describe('the safe-mode banner', () => {
  it('promises only that extensions are left out', () => {
    window.vex = {};
    SafeModeBanner.show({ safeMode: true, asked: true });
    const text = document.querySelector('.safe-mode-banner').textContent;
    expect(text).toContain('Extensions are not loaded this time');
    expect(text).not.toMatch(/no panels|session restore/);
  });
});
