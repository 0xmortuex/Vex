// @vitest-environment jsdom
//
// Scriptable page actions: a tiny per-site language run on demand. The safety
// properties are the point: off by default, a warning first, one exact origin,
// never in private/Tor tabs, never by itself unless that script was marked,
// and no way for a script to make a request or read the page back.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { VexSettingsGroups, VexModuleCommands } = require('../../src/renderer/js/settings-groups.js');
globalThis.VexSettingsGroups = VexSettingsGroups;
globalThis.VexModuleCommands = VexModuleCommands;
const { PageActions } = require('../../src/renderer/js/page-actions.js');

const confirmYes = () => vi.fn(async () => true);

function guest(url = 'https://shop.example') {
  return {
    url,
    getAttribute: () => 'persist:main',
    executeJavaScript: vi.fn(async (code) => (0, eval)(code)),
  };
}
function mountTabs(url, wv) {
  globalThis.TabManager = { tabs: [{ id: 't1', url }], getActiveTab: () => ({ id: 't1', url }) };
  globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true, canFillWebview: () => true };
  globalThis.vexConfirm = confirmYes();
  delete globalThis.TabManager;
  delete globalThis.WebviewManager;
  Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 });
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});

describe('the language', () => {
  it('parses every step kind', () => {
    const r = PageActions.parse([
      '# comment', '',
      'click "Accept all"', 'click selector: #ok', 'scroll to "Comments"', 'scroll to selector: #c',
      'scroll top', 'scroll bottom', 'wait 500', 'hide selector: .banner', 'type selector: input[name="q"] = "hello world"',
    ].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.steps.map(s => s.op + ':' + s.by)).toEqual(['click:text', 'click:selector', 'scroll:text', 'scroll:selector', 'scroll:top', 'scroll:bottom', 'wait:', 'hide:selector', 'type:selector']);
    expect(r.steps[8]).toMatchObject({ value: 'input[name="q"]', text: 'hello world' });
  });

  it('reports a bad line by its number and keeps no step from it', () => {
    const r = PageActions.parse('click "ok"\nfetch https://evil.example\nwait 99999');
    expect(r.steps).toHaveLength(1);
    expect(r.errors.map(e => e.line)).toEqual([2, 3]);
  });

  it('has no step that can run code or make a request', () => {
    for (const bad of ['eval alert(1)', 'run fetch("//x")', 'goto https://evil.example', 'open https://evil.example', 'javascript: alert(1)', 'click "a" ; fetch("x")']) {
      const r = PageActions.parse(bad);
      if (r.steps.length) expect(r.steps[0].op).toBe('click');
    }
    expect(PageActions.parse('eval alert(1)').errors).toHaveLength(1);
  });

  it('limits the size and the step count', () => {
    expect(PageActions.parse('x'.repeat(5000)).errors[0].message).toMatch(/longer/);
    const many = Array.from({ length: 60 }, () => 'scroll top').join('\n');
    const r = PageActions.parse(many);
    expect(r.steps.length).toBe(PageActions.MAX_STEPS);
    expect(r.errors).toHaveLength(1);
  });

  it('hands the guest a fixed interpreter with the steps as data, and no network or storage', () => {
    const code = PageActions.guestCode(PageActions.parse('click "Accept"; fetch("//evil")').steps);
    // The only thing that varies is the JSON; the quote in the text cannot break out of it.
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB|\beval\s*\(|new Function|import\s*\(/);
  });

  it('runs against a page: click by words, selector, scroll, hide, type', async () => {
    document.body.innerHTML = '<button id="a">Accept all cookies</button><h2>Comments (4)</h2><div class="banner">x</div><input name="q">';
    const clicks = vi.fn();
    document.getElementById('a').addEventListener('click', clicks);
    const steps = PageActions.parse('click "accept all"\nscroll to "comments"\nhide selector: .banner\ntype selector: input[name="q"] = "hi"\nclick "no such thing"').steps;
    const out = await (0, eval)(PageActions.guestCode(steps));
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.querySelector('.banner').style.display).toBe('none');
    expect(document.querySelector('input').value).toBe('hi');
    expect(out.slice(0, 4).every(l => /: ok$/.test(l))).toBe(true);
    expect(out[4]).toMatch(/not found/);
  });
});

describe('turning it on', () => {
  it('is off until the person says yes to the warning', async () => {
    expect(PageActions.enabled()).toBe(false);
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await PageActions.setEnabled(true)).toBe(false);
    expect(PageActions.enabled()).toBe(false);
    expect(globalThis.vexConfirm).toHaveBeenCalledTimes(1);
    expect(globalThis.vexConfirm.mock.calls[0][0].message).toMatch(/act as you/);
    globalThis.vexConfirm = confirmYes();
    expect(await PageActions.setEnabled(true)).toBe(true);
    expect(PageActions.enabled()).toBe(true);
  });

  it('is never available in a private window', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    expect(PageActions.available()).toBe(false);
    await expect(PageActions.setEnabled(true)).rejects.toThrow(/private window/);
    expect(() => PageActions.add({ name: 'x', origin: 'https://a.com', source: 'scroll top' })).toThrow(/private window/);
    window.VexTabPolicy.isPrivateWindow = false;
  });
});

describe('running a script', () => {
  async function ready(url = 'https://shop.example/cart') {
    await PageActions.setEnabled(true);
    const id = PageActions.add({ name: 'Cookies', origin: 'https://shop.example', source: 'click "Accept"\nscroll to "Comments"' });
    const wv = guest(url);
    mountTabs(url, wv);
    return { id, wv };
  }

  it('runs on the exact origin it was written for', async () => {
    document.body.innerHTML = '<button>Accept</button><h2>Comments</h2>';
    const { id, wv } = await ready();
    const out = await PageActions.run(id);
    expect(out).toEqual(['1 click: ok', '2 scroll: ok']);
    expect(wv.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it('refuses another origin, even a sibling subdomain or another scheme or port', async () => {
    for (const url of ['https://evil.example/', 'https://www.shop.example/', 'http://shop.example/', 'https://shop.example:8443/']) {
      const { id, wv } = await ready(url);
      await expect(PageActions.run(id)).rejects.toThrow(/is for https:\/\/shop\.example/);
      expect(wv.executeJavaScript).not.toHaveBeenCalled();
    }
  });

  it('refuses while off, and in private, Tor or routed tabs', async () => {
    const { id, wv } = await ready();
    await PageActions.setEnabled(false);
    await expect(PageActions.run(id)).rejects.toThrow(/turned off/);
    await PageActions.setEnabled(true);
    window.VexTabPolicy.canReadWebview = () => false;
    await expect(PageActions.run(id)).rejects.toThrow(/private, Tor or routed/);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it('saving an edit takes the script off auto-run', async () => {
    const { id } = await ready();
    expect(await PageActions.setAutoRun(id, true)).toBe(true);
    expect(PageActions.scripts()[0].autoRun).toBe(true);
    PageActions.update(id, { source: 'scroll top' });
    expect(PageActions.scripts()[0].autoRun).toBe(false);
  });

  it('auto-run needs its own yes, and then runs only for that script and origin', async () => {
    document.body.innerHTML = '<button>Accept</button><h2>Comments</h2>';
    const { id, wv } = await ready();
    PageActions.add({ name: 'Manual', origin: 'https://shop.example', source: 'scroll top' });
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await PageActions.setAutoRun(id, true)).toBe(false);
    expect(PageActions.scripts().find(s => s.id === id).autoRun).toBe(false);
    globalThis.vexConfirm = confirmYes();
    await PageActions.setAutoRun(id, true);

    PageActions._onSettled({ detail: { tabId: 't1' } });
    await new Promise(r => setTimeout(r, 0));
    expect(wv.executeJavaScript).toHaveBeenCalledTimes(1);   // only the marked one
    wv.executeJavaScript.mockClear();

    mountTabs('https://other.example/', guest('https://other.example/'));
    const other = WebviewManager.webviews.get('t1');
    PageActions._onSettled({ detail: { tabId: 't1' } });
    await new Promise(r => setTimeout(r, 0));
    expect(other.executeJavaScript).not.toHaveBeenCalled();
  });

  it('never auto-runs in a private tab', async () => {
    const { id, wv } = await ready();
    await PageActions.setAutoRun(id, true);
    window.VexTabPolicy.canReadWebview = () => false;
    PageActions._onSettled({ detail: { tabId: 't1' } });
    await new Promise(r => setTimeout(r, 0));
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it('keeps only well-formed scripts from storage', () => {
    localStorage.setItem(PageActions.KEY, JSON.stringify({ enabled: true, scripts: [
      { id: 'pa_1', name: 'ok', origin: 'https://a.com', source: 'scroll top', autoRun: true },
      { id: 'pa_2', name: 'bad origin', origin: 'javascript:alert(1)', source: 'scroll top' },
      { id: '../x', name: 'bad id', origin: 'https://a.com', source: 'scroll top' },
      { id: 'pa_3', name: 'huge', origin: 'https://a.com', source: 'x'.repeat(9999) },
    ] }));
    expect(PageActions.scripts().map(s => s.id)).toEqual(['pa_1']);
  });
});

describe('Ctrl+K and Settings', () => {
  it('offers only "turn on" while off, and the scripts once on', async () => {
    globalThis.CommandBar = { commands: [] };
    PageActions._registerCommands();
    expect(CommandBar.commands.map(c => c.id)).toEqual(['pageaction:enable']);
    await PageActions.setEnabled(true);
    PageActions.add({ name: 'One', origin: 'https://a.com', source: 'scroll top' });
    const ids = CommandBar.commands.map(c => c.id);
    expect(ids).toContain('pageaction:new');
    expect(ids.some(i => i.startsWith('pageaction:run:'))).toBe(true);
    delete globalThis.CommandBar;
  });

  it('draws a settings group that lists scripts as plain text rows', async () => {
    await PageActions.setEnabled(true);
    PageActions.add({ name: 'Cookies <b>', origin: 'https://a.com', source: 'scroll top' });
    const box = document.createElement('div');
    PageActions.renderSettings(box);
    expect(box.querySelector('#pa-enabled').checked).toBe(true);
    expect(box.innerHTML).not.toContain('<b>');
    expect(box.textContent).toContain('https://a.com');
    expect(VexSettingsGroups.ids()).toContain('page-actions');
  });
});
