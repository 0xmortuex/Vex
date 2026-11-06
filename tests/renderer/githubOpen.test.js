// @vitest-environment jsdom
//
// Clicking GitHub: the Control Center (Vex's GitHub panel) or github.com in a tab, asked each time or kept (js/github-open.js),
// and the hand-over from SidebarManager.showPanel('github') and the right-click menu of the GitHub button (js/sidebar.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const KEY = 'vex.githubOpenMode';

function install({ username = 'octocat' } = {}) {
  localStorage.clear();
  if (username) localStorage.setItem('vex.githubUsername', username);
  document.body.innerHTML = `<div id="icon-sidebar"><button class="sidebar-icon" data-panel="github"></button></div>
    <div id="panels-container"><div id="panel-github" class="panel"></div></div>
    <select id="setting-github-open-mode"><option value="ask"></option><option value="control-center"></option><option value="direct"></option></select>
    <div id="setting-github-open-mode-note"></div>`;
  globalThis.GitHubPanel = {};
  globalThis.SidebarManager = { activePanel: null, hideActivePanel: vi.fn(), showPanel: vi.fn() };
  globalThis.TabManager = {
    createTab: vi.fn(),
    _clampMenuToViewport: vi.fn(),
    _dismissMenu: (m) => { if (m && m._closeMenu) m._closeMenu(); else if (m) m.remove(); },
    _attachMenuDismissal: (menu) => { menu._closeMenu = () => menu.remove(); },
  };
  globalThis.SettingsUI = { openSection: vi.fn() };
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
}

const rows = () => [...document.querySelectorAll('.vex-github-open .tab-context-item')];

describe('VexGithubOpen', () => {
  let G;
  beforeEach(async () => {
    vi.resetModules();
    install();
    await import('../../src/renderer/js/github-open.js');
    G = window.VexGithubOpen;
  });

  it('asks when nothing is saved, and the two rows say what they do', () => {
    expect(G.mode()).toBe('ask');
    expect(G.open({})).toBe('asked');
    const menu = document.querySelector('.vex-github-open');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(rows().map(r => r.getAttribute('role'))).toEqual(['menuitem', 'menuitem']);
    expect(menu.textContent).toContain('Control Center or GitHub directly?');
    expect(menu.textContent).toContain("Vex's GitHub panel");
    expect(menu.textContent).toContain('Opens github.com in a tab');
    expect(SidebarManager.showPanel).not.toHaveBeenCalled();
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });

  it('Control Center opens the panel past the hand-over; Direct opens the profile in a tab', () => {
    G.open({});
    rows()[0].click();
    expect(SidebarManager.showPanel).toHaveBeenCalledWith('github', { chosen: true });
    expect(document.querySelector('.vex-github-open')).toBeNull();
    G.open({});
    rows()[1].click();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://github.com/octocat', true);
  });

  it('Direct without a username goes to github.com, and a username with odd characters is encoded', () => {
    localStorage.removeItem('vex.githubUsername');
    expect(G.directUrl()).toBe('https://github.com');
    localStorage.setItem('vex.githubUsername', 'a b/c');
    expect(G.directUrl()).toBe('https://github.com/a%20b%2Fc');
  });

  it('a kept choice opens at once, with no question', () => {
    G.setMode('direct');
    expect(G.open({})).toBe('direct');
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.vex-github-open')).toBeNull();
    G.setMode('control-center');
    expect(G.open({})).toBe('control-center');
    expect(SidebarManager.showPanel).toHaveBeenCalledWith('github', { chosen: true });
  });

  it('with no username the Control Center says so, offers Settings and the direct way', () => {
    localStorage.removeItem('vex.githubUsername');
    G.setMode('control-center');
    expect(G.open({})).toBe('unusable');
    const menu = document.querySelector('.vex-github-open');
    expect(menu.textContent).toContain('Set your GitHub username in Settings to use the Control Center');
    expect(rows()[0].getAttribute('aria-disabled')).toBe('true');
    rows()[0].click();   // a click on the row that is off does nothing and keeps the menu
    expect(document.querySelector('.vex-github-open')).not.toBeNull();
    expect(SidebarManager.showPanel).not.toHaveBeenCalled();
    const settings = rows().find(r => r.textContent === 'Open Settings');
    settings.click();
    expect(SettingsUI.openSection).toHaveBeenCalledWith('setting-github-username');
    G.open({});
    rows().find(r => r.textContent.includes('GitHub directly')).click();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://github.com', true);
  });

  it('when the panel is not in the window the chooser says that instead', () => {
    document.getElementById('panel-github').remove();
    expect(G.controlCenterProblem()).toBe(G.NO_PANEL);
    G.open({});
    expect(document.querySelector('.vex-github-open').textContent).toContain(G.NO_PANEL);
  });

  it('a bad saved value is reported and nothing opens; it never becomes "ask" quietly', () => {
    localStorage.setItem(KEY, 'sometimes');
    expect(() => G.mode()).toThrow(/sometimes/);
    expect(G.open({})).toBe('error');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('sometimes'), 'error', 9000);
    expect(window.VexProblems.note).toHaveBeenCalled();
    expect(document.querySelector('.vex-github-open')).toBeNull();
    expect(TabManager.createTab).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe('sometimes');
  });

  it('setMode refuses anything but the three values', () => {
    expect(() => G.setMode('maybe')).toThrow(/maybe/);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(G.setMode('direct')).toBe('direct');
    expect(localStorage.getItem(KEY)).toBe('direct');
  });

  it('the right-click items: open now, keep on either way, ask every time, with a check on the current one', () => {
    let items = G.menuItems();
    expect(items.filter(i => i.label).map(i => i.label)).toEqual(['Open Control Center now', 'Open GitHub now', 'Keep on Control Center', 'Keep on Direct', 'Ask every time']);
    expect(items.filter(i => i.checked).map(i => i.label)).toEqual(['Ask every time']);
    items.find(i => i.label === 'Keep on Direct').action();
    expect(localStorage.getItem(KEY)).toBe('direct');
    items = G.menuItems();
    expect(items.filter(i => i.checked).map(i => i.label)).toEqual(['Keep on Direct']);
    items.find(i => i.label === 'Keep on Control Center').action();
    expect(localStorage.getItem(KEY)).toBe('control-center');
    items.find(i => i.label === 'Ask every time').action();
    expect(localStorage.getItem(KEY)).toBe('ask');
    items.find(i => i.label === 'Open GitHub now').action();
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
    items.find(i => i.label === 'Open Control Center now').action();
    expect(SidebarManager.showPanel).toHaveBeenCalledWith('github', { chosen: true });
  });

  it('the Settings drop-down shows the saved choice, changes it, and shows a bad value instead of hiding it', () => {
    const sel = document.getElementById('setting-github-open-mode');
    G.setMode('direct');
    expect(sel.value).toBe('direct');
    sel.value = 'control-center';
    sel.dispatchEvent(new Event('change'));
    expect(localStorage.getItem(KEY)).toBe('control-center');
    localStorage.setItem(KEY, 'zzz');
    document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel: 'settings' } }));
    expect(document.getElementById('setting-github-open-mode-note').textContent).toContain('zzz');
    expect(sel.selectedIndex).toBe(-1);
  });
});

describe('SidebarManager hands every GitHub open to the chooser', () => {
  let S;
  beforeEach(async () => {
    vi.resetModules();
    install();
    globalThis.VexJobs = { every: vi.fn(() => ({ stop: vi.fn() })) };
    ({ SidebarManager: S } = await import('../../src/renderer/js/sidebar.js'));
  });
  const fake = (over) => ({ _resolveAlias: (n) => n, activePanel: null, sidePanel: null, _withGithubOpen: S._withGithubOpen, ...over });

  it('showPanel("github") calls open(), not the panel', () => {
    const open = vi.fn();
    window.VexGithubOpen = { open };
    const t = fake();
    S.showPanel.call(t, 'github');
    expect(open).toHaveBeenCalledTimes(1);
    delete window.VexGithubOpen;
  });

  it('{ chosen: true } and a panel that is already on show skip the hand-over', () => {
    const open = vi.fn();
    window.VexGithubOpen = { open };
    // Past the gate showPanel needs a real window; the thrown error proves it went on to the panel code.
    expect(() => S.showPanel.call(fake(), 'github', { chosen: true })).toThrow();
    expect(() => S.showPanel.call(fake({ activePanel: 'github' }), 'github')).toThrow();
    expect(() => S.showPanel.call(fake({ sidePanel: 'github' }), 'github')).toThrow();
    expect(open).not.toHaveBeenCalled();
    delete window.VexGithubOpen;
  });

  it('before the module has loaded it is loaded on demand; a failure is shown', async () => {
    delete window.VexGithubOpen;
    const ensure = vi.fn(() => Promise.reject(new Error('boom')));
    globalThis.VexLazy = { ensure };
    S._withGithubOpen(() => {});
    await Promise.resolve(); await Promise.resolve();
    expect(ensure).toHaveBeenCalledWith('js/github-open.js');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error', 9000);
    delete globalThis.VexLazy;
  });
});
