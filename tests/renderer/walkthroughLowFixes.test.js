// @vitest-environment jsdom
// The Low findings of the 2026-10-07 walkthrough (scan/walkthrough.md L2, L4,
// L5, L6, L7, L8, L10, L11, L12, L13).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fresh = (p) => { const r = require.resolve(path.join(ROOT, p)); delete require.cache[r]; return require(r); };
const START = 'file:///C:/Users/x/AppData/Local/Programs/Vex/resources/app.asar/src/renderer/start.html?theme=oxford';

beforeEach(() => {
  document.body.innerHTML = '';
  window.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
});

describe('L2 — the New Tab page is "New Tab", not a file path', () => {
  it('Memory panel', () => {
    const { MemoryPanel } = fresh('src/renderer/js/memory-panel.js');
    expect(MemoryPanel.shownUrl(START)).toBe('New Tab');
    expect(MemoryPanel.shownUrl('vex://start')).toBe('New Tab');
    expect(MemoryPanel.shownUrl('https://example.com/start.html')).toBe('https://example.com/start.html');
    expect(MemoryPanel.shownUrl('file:///C:/notes/start.html.bak')).toBe('file:///C:/notes/start.html.bak');
  });

  it('tab hover preview', () => {
    globalThis.TabManager = { tabs: [] };
    globalThis.WebviewManager = { webviews: new Map() };
    const { TabPreview } = fresh('src/renderer/js/tab-preview.js');
    TabPreview.init();
    const el = document.createElement('div'); document.body.appendChild(el);
    TabPreview._show(el, { title: 'New Tab', url: START }, null);
    expect(document.querySelector('#tab-preview .preview-url').textContent).toBe('New Tab');
    TabPreview._show(el, { title: 'Ex', url: 'https://example.com/' }, null);
    expect(document.querySelector('#tab-preview .preview-url').textContent).toBe('https://example.com/');
  });
});

describe('L4 — a site\'s own analytics are not listed as trackers', () => {
  it('a host blocked only on its own site is set apart; one seen on other sites is a tracker', async () => {
    const { PrivacyDashboard } = fresh('src/renderer/js/privacy-dashboard.js');
    expect(PrivacyDashboard.ownSiteOnly({ host: 'web.whatsapp.com', sites: [] })).toBe(true);
    expect(PrivacyDashboard.ownSiteOnly({ host: 'logs.netflix.com', sites: ['www.netflix.com'] })).toBe(true);
    expect(PrivacyDashboard.ownSiteOnly({ host: 'stats.bbc.co.uk', sites: ['www.bbc.co.uk'] })).toBe(true);
    expect(PrivacyDashboard.ownSiteOnly({ host: 'doubleclick.net', sites: ['cnn.com'] })).toBe(false);

    window.vex = {
      privacyTrackerStats: async () => ({ total: 30, crossSite: [], byHost: [
        { host: 'web.whatsapp.com', count: 20, sites: [] },
        { host: 'doubleclick.net', count: 10, sites: ['cnn.com'] },
      ] }),
      getAdBlockerState: async () => true,
      privacyTrackerReset: async () => {},
    };
    const el = document.createElement('div'); document.body.appendChild(el);
    await PrivacyDashboard.renderPanel(el);
    PrivacyDashboard.stop();
    const offenders = [...el.querySelectorAll('.pd-list .pd-host')].map(e => e.textContent);
    expect(offenders).toEqual(['doubleclick.net']);
    expect(el.textContent).toMatch(/1 tracker\/ad host from other sites/);
    expect(el.textContent).toMatch(/A site's own analytics/);
    expect(el.textContent).toMatch(/web\.whatsapp\.com/);
  });
});

describe('L5 — mail setup form', () => {
  it('the server row hides until an unknown provider is typed; empty help takes no room', () => {
    const { VexMail } = fresh('src/renderer/js/mail.js');
    const body = document.createElement('div'); document.body.appendChild(body);
    VexMail._ui = { body };
    VexMail._drawSetup(false);
    const custom = body.querySelector('[data-custom]'), help = body.querySelector('[data-help]'), email = body.querySelector('[data-email]');
    expect(custom.hidden).toBe(true);
    expect(custom.style.display).toBe('none');
    expect(help.hidden).toBe(true);
    email.value = 'me@gmail.com'; email.dispatchEvent(new Event('input'));
    expect(custom.style.display).toBe('none');
    expect(help.hidden).toBe(false);
    email.value = 'me@my-own-server.example'; email.dispatchEvent(new Event('input'));
    expect(custom.hidden).toBe(false);
    expect(custom.style.display).toBe('grid');
    expect(body.textContent).toMatch(/app password in your account's security settings/);
  });
});

describe('L6 — the translate bar pushes the page down', () => {
  it('the webviews move under a visible bar', () => {
    expect(read('src/renderer/css/translate.css')).toMatch(/:has\(> \.translate-bar\.visible\) > #webviews-container \{ margin-top: 32px; height: calc\(100% - 32px\); \}/);
  });
});

describe('L7 — "How I Got Here" on a tab with no trail', () => {
  it('is a plain note, not an error', () => {
    globalThis.TabManager = { getActiveTab: () => ({ id: 'a' }) };
    const { TabTrail } = fresh('src/renderer/js/tab-trail.js');
    vi.spyOn(TabTrail, 'chain').mockReturnValue([]);
    expect(() => TabTrail.show()).not.toThrow();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/where you started/), 'info');
  });
});

describe('L8 — the "Downloading…" note goes once the download is done', () => {
  it('is removed after the preview step', async () => {
    let resolvePreview;
    window.vex = { extensionsWebStorePreview: () => new Promise(r => { resolvePreview = r; }) };
    window.showToast = (m) => {
      let c = document.getElementById('toast-container');
      if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
      const t = document.createElement('div'); t.className = 'toast-item'; t.textContent = m; c.appendChild(t);
    };
    const { VexWebStore } = fresh('src/renderer/js/web-store.js');
    const done = VexWebStore.install('abcdefghijklmnopabcdefghijklmnop');
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('toast-container').textContent).toMatch(/Downloading from the Chrome Web Store/);
    resolvePreview({ ok: false, error: 'test stop' });
    await done;
    expect(document.getElementById('toast-container').textContent).not.toMatch(/Downloading from the Chrome Web Store/);
  });
});

describe('L10 — the tab menu', () => {
  it('has Reload and Bookmark, and the snooze times in one submenu', () => {
    const { TabManager } = fresh('src/renderer/js/tabs.js');
    globalThis.TabSnooze = { canSnooze: () => true, WHEN: { hour: { label: 'In an hour' }, evening: { label: 'This evening' }, week: { label: 'In a week' } }, snooze: vi.fn(() => ({ at: Date.now() })) };
    globalThis.Bookmarks = { has: () => false, toggle: vi.fn() };
    globalThis.VexIcons = { svg: () => '<svg></svg>' };
    TabManager.tabs = [{ id: 't1', url: 'https://example.com/', title: 'Ex' }];
    TabManager.groups = [];
    TabManager.activeTabId = 't1';
    vi.spyOn(TabManager, '_clampMenuToViewport').mockImplementation(() => {});
    vi.spyOn(TabManager, '_attachMenuDismissal').mockImplementation(() => {});
    TabManager.showContextMenu({ clientX: 10, clientY: 10 }, TabManager.tabs[0]);
    const menu = document.querySelector('.tab-context-menu');
    const labels = [...menu.children].filter(e => e.classList.contains('tab-context-item')).map(e => e.textContent);
    expect(labels).toContain('Reload');
    expect(labels).toContain('Bookmark…');
    expect(labels).toContain('Snooze until');
    expect(labels.some(l => /In an hour|This evening|In a week/.test(l))).toBe(false);
    const snooze = [...menu.children].find(e => e.textContent === 'Snooze until');
    snooze.dispatchEvent(new Event('mouseenter'));
    const sub = document.querySelector('.tab-context-menu.ctx-submenu');
    expect([...sub.children].map(e => e.textContent)).toEqual(['In an hour', 'This evening', 'In a week']);
    sub.children[1].click();
    expect(TabSnooze.snooze).toHaveBeenCalledWith('t1', 'evening');
    expect(document.querySelector('.ctx-submenu')).toBeNull();
  });
});

describe('L11 — page zoom in the address bar', () => {
  it('shows the zoom when it is not 100%, and resets on click', () => {
    document.body.innerHTML = '<div id="url-bar"><input id="url-input"><button id="btn-copy-url"></button></div>';
    let z = 1.2;
    const wv = document.createElement('div');
    wv.getZoomFactor = () => z;
    document.body.appendChild(wv);
    globalThis.WebviewManager = { getActiveWebview: () => wv, zoomReset: vi.fn(() => { z = 1; }) };
    globalThis.VexJobs = { every: vi.fn() };
    const ZI = fresh('src/renderer/js/zoom-indicator.js');
    const pill = document.getElementById('url-zoom');
    expect(pill).not.toBeNull();
    expect(pill.nextElementSibling.id).toBe('btn-copy-url');
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe('120%');
    pill.click();
    expect(WebviewManager.zoomReset).toHaveBeenCalled();
    expect(pill.hidden).toBe(true);
    z = 0.9; ZI.update();
    expect(pill.textContent).toBe('90%');
  });
});

describe('L12 — schedules and the verse', () => {
  it('reminders above an empty task list do not say "No scheduled tasks yet"', async () => {
    document.body.innerHTML = '<div id="sched-content"></div>';
    window.VexUI = { emptyState: (i, t, h) => `<div class="vex-empty"><div class="vex-empty-title">${t}</div><div class="vex-empty-hint">${h}</div></div>` };
    window.vex = { reminders: { list: async () => [{ id: 'r', at: Date.now() + 3600e3, message: 'Weekly review' }], delete: async () => {} } };
    globalThis.Scheduler = { getAllTasks: () => [] };
    const { SchedulesPanel } = fresh('src/renderer/js/schedules-panel.js');
    SchedulesPanel._renderActive();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    const c = document.getElementById('sched-content');
    expect(c.textContent).toMatch(/Weekly review/);
    expect(c.textContent).not.toMatch(/No scheduled tasks yet/);
    expect(c.querySelector('.vex-empty-title').textContent).toBe('No tasks yet');
  });

  it('"(all mankind]" from the verse API reads "[all mankind]"', () => {
    const html = read('src/renderer/start.html');
    const src = /const fixBrackets = (\(s\) => [^\n]+);/.exec(html)[1];
    const fixBrackets = new Function('return ' + src)();
    expect(fixBrackets('CALL THOU (all mankind] unto thy Sustainer')).toBe('CALL THOU [all mankind] unto thy Sustainer');
    expect(fixBrackets('a [b] (c) d')).toBe('a [b] (c) d');
  });
});

describe('L13 — the New Tab page does not hold its load open for site icons', () => {
  it('quick-access and recent icons are lazy', () => {
    const html = read('src/renderer/start.html');
    expect(html).toContain('alt="" loading="lazy"');
    expect(html).toContain("img.loading = 'lazy'");
  });
});
