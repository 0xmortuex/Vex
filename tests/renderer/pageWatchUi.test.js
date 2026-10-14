// @vitest-environment jsdom
//
// Page Watcher, what you touch: the dialog that makes a watch, picking a part
// of a page by selecting it, the diff view, the badge and the Settings block.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { PageWatch } = require('../../src/renderer/js/page-watch.js');
const { PageWatchUI } = require('../../src/renderer/js/page-watch-ui.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-page-watch" hidden></button><div id="settings-host"></div>';
  document.head.querySelector('#pw-styles')?.remove();
  window.escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  globalThis.PageWatch = PageWatch;
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.AgentTools = {
    readUrl: vi.fn(async () => ({ text: 'Price $299.00\nIn stock' })),
    _get: vi.fn(async () => ({ ok: true, status: 200, body: '<html><body><p class="price">$299.00</p></body></html>' })),
  };
  window.showToast = vi.fn();
  window.vex = { notify: vi.fn() };
  delete window.VexTabPolicy;
});
afterEach(() => { delete globalThis.TabManager; delete globalThis.PageWatch; delete globalThis.Ollama; delete globalThis.AIRouter; });

const submit = (form) => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
const settle = () => new Promise(r => setTimeout(r, 0));

describe('picking a part of a page by selecting it', () => {
  const pick = (html, target) => {
    document.body.innerHTML = html;
    const el = document.querySelector(target);
    const sel = window.getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.addRange(r);
    return window.eval(PageWatchUI.SELECTION_SCRIPT);
  };

  it('gives a selector that finds exactly that element, and the first words', () => {
    const r = pick('<div id="app"><section><p class="a">x</p><p class="price">Now $299.00 only</p></section></div>', '.price');
    expect(r.anchor).toBe('Now $299.00 only');
    expect(document.querySelectorAll(r.selector)).toHaveLength(1);
    expect(document.querySelector(r.selector).textContent).toBe('Now $299.00 only');
  });

  it('prefers an id and skips generated class names', () => {
    const r = pick('<div><span id="status">All systems go</span></div>', '#status');
    expect(r.selector).toBe('#status');
    const g = pick('<ul><li class="css-1a2b3c">one</li><li class="css-1a2b3c">two</li></ul>', 'li:nth-child(2)');
    expect(g.selector).not.toMatch(/css-/);
    expect(document.querySelector(g.selector).textContent).toBe('two');
  });

  it('is null with nothing selected', () => {
    document.body.innerHTML = '<p>hello</p>';
    window.getSelection().removeAllRanges();
    expect(window.eval(PageWatchUI.SELECTION_SCRIPT)).toBeNull();
  });
});

describe('the dialog', () => {
  const open = (extra = {}) => PageWatchUI.open({ url: 'https://shop.example/card', title: 'Card', ...extra });
  const el = (s) => document.querySelector('#pw-add ' + s);

  it('is accessible: a labelled modal dialog with the first control focused', () => {
    open();
    const d = document.getElementById('pw-add');
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-labelledby')).textContent).toMatch(/Watch this page for changes/);
    for (const input of d.querySelectorAll('input:not([type=radio]):not([type=checkbox]), select')) {
      const named = input.getAttribute('aria-label') || (input.id && d.querySelector('label[for="' + input.id + '"]'));
      expect(named, input.id).toBeTruthy();
    }
  });

  it('makes a whole-page watch with the interval and wake choices', async () => {
    const done = open();
    el('#pw-every').value = String(6 * 3600000);
    el('#pw-wake').checked = true;
    submit(el('form'));
    const w = await done;
    expect(w).toMatchObject({ url: 'https://shop.example/card', kind: 'text', selector: '', every: 6 * 3600000, wake: true, render: false, source: 'user' });
    expect(PageWatch.list()).toHaveLength(1);
    expect(document.getElementById('pw-add')).toBeNull();
  });

  it('a selected part prefills the selector and keeps the anchor', async () => {
    const done = open({ picked: { selector: 'section > p.price', anchor: 'Now $299.00 only', text: 'Now $299.00 only' } });
    expect(el('#pw-selector').value).toBe('section > p.price');
    expect(el('input[name="pw-where"]:checked').value).toBe('part');
    submit(el('form'));
    expect(await done).toMatchObject({ selector: 'section > p.price', anchor: 'Now $299.00 only' });
  });

  it('a number that goes below a figure becomes a number watch with its target', async () => {
    const done = open();
    el('input[name="pw-what"][value="number"]').checked = true;
    el('#pw-extract').value = 'price';
    el('#pw-when').value = 'below';
    el('#pw-target').value = '250';
    submit(el('form'));
    const w = await done;
    expect(w).toMatchObject({ kind: 'number', direction: 'below', target: 250 });
    expect(w.pattern).toMatch(/\$£€/);
  });

  it('a version is watched for "it changes" and a custom pattern is checked in the dialog', async () => {
    const done = open();
    el('input[name="pw-what"][value="number"]').checked = true;
    el('#pw-extract').value = 'version';
    submit(el('form'));
    expect(await done).toMatchObject({ kind: 'regex' });
  });

  it('says what is wrong and stays open', async () => {
    open();
    el('input[name="pw-where"][value="part"]').checked = true;
    submit(el('form'));
    await settle();
    expect(el('#pw-error').textContent).toMatch(/Give the selector/);
    expect(document.getElementById('pw-add')).not.toBeNull();

    el('input[name="pw-where"][value="page"]').checked = true;
    el('input[name="pw-what"][value="number"]').checked = true;
    el('#pw-extract').value = 'custom';
    el('#pw-pattern').value = '(';
    submit(el('form'));
    await settle();
    expect(el('#pw-error').textContent).toMatch(/not valid/);

    el('#pw-extract').value = 'version';
    el('#pw-when').value = 'down';
    submit(el('form'));
    await settle();
    expect(el('#pw-error').textContent).toMatch(/no up or down/);
    expect(PageWatch.list()).toEqual([]);
  });

  it('Escape closes it and makes nothing', async () => {
    const done = open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await done).toBeNull();
    expect(document.getElementById('pw-add')).toBeNull();
    expect(PageWatch.list()).toEqual([]);
  });

  it('local AI is offered only when a local model exists', () => {
    open();
    expect(el('#pw-ai').disabled).toBe(true);
    document.getElementById('pw-add').remove();
    globalThis.Ollama = {};
    globalThis.AIRouter = { isOllamaAvailable: () => true, getModel: () => 'qwen3:8b' };
    open();
    expect(el('#pw-ai').disabled).toBe(false);
  });
});

describe('where a watch is refused, before a form is filled in', () => {
  const tabs = (partition) => {
    globalThis.TabManager = { tabs: [], windowMayAsk: (p) => !p || p === 'persist:main', mayAskSiteForIcon: () => true };
    return PageWatchUI.open({ url: 'https://news.example/', title: 'News', partition });
  };

  it.each(['tor:abc', 'persist:container-work', 'persist:private-1'])('a tab in %s says so and opens nothing', async (partition) => {
    expect(await tabs(partition)).toBeNull();
    expect(document.getElementById('pw-add')).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Tor, a proxy, a container or a private session/), 'error');
  });

  it('a private window does not make or run watches', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(await PageWatchUI.open({ url: 'https://news.example/', title: 'News' })).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/private window does not keep watches/), 'error');
    expect(() => PageWatch.add({ url: 'https://news.example/' })).toThrow(/private window/);
    PageWatch.start();
    expect(PageWatch._timer).toBeFalsy();
  });

  it('the switch in Settings refuses too', async () => {
    PageWatch.setSettings({ enabled: false });
    expect(await PageWatchUI.open({ url: 'https://news.example/', title: 'News' })).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/switched off/), 'error');
  });
});

describe('the badge', () => {
  it('appears only while a watched page has changed and nobody looked', () => {
    PageWatchUI.init();
    const b = document.getElementById('btn-page-watch');
    expect(b.hidden).toBe(true);
    localStorage.setItem(PageWatch.KEY, JSON.stringify([
      { id: 'a', url: 'https://a.example/', title: 'A', every: 900000, lastChangedAt: 10 },
      { id: 'b', url: 'https://b.example/', title: 'B', every: 900000, lastChangedAt: 10, seenAt: 20 },
    ]));
    PageWatchUI.refreshBadge();
    expect(b.hidden).toBe(false);
    expect(b.querySelector('.pw-badge').textContent).toBe('1');
    expect(b.getAttribute('aria-label')).toBe('1 watched page changed');
    PageWatch.markSeen('a');
    expect(b.hidden).toBe(true);
  });
});

describe('what changed', () => {
  const seed = () => {
    localStorage.setItem(PageWatch.KEY, JSON.stringify([{ id: 'w1', url: 'https://a.example/', title: 'Card', every: 900000, lastChangedAt: 5, lastSummary: 'The price dropped.' }]));
    localStorage.setItem(PageWatch.SNAPS_KEY, JSON.stringify({ w1: [
      { at: 1, text: 'Card\n$299.00\nIn stock', hash: 'a' },
      { at: 2, text: 'Card\n$249.00\nIn stock\nFree shipping', hash: 'b' },
    ] }));
  };

  it('shows removed and added lines between two looks, and marks the change seen', () => {
    seed();
    globalThis.TabManager = { createTab: vi.fn() };
    PageWatchUI.showDiff('w1');
    const body = document.querySelector('#pw-diff-body');
    const del = [...body.querySelectorAll('.pw-del')].map(n => n.textContent);
    const add = [...body.querySelectorAll('.pw-add')].map(n => n.textContent);
    expect(del).toEqual(['-$299.00']);
    expect(add).toEqual(['+$249.00', '+Free shipping']);
    expect(document.getElementById('pw-diff').textContent).toMatch(/The price dropped/);
    expect(PageWatch.isUnseen(PageWatch.list()[0])).toBe(false);
  });

  it('the Watched pages list offers pause, what changed and stop, and pause holds the checks', async () => {
    seed();
    globalThis.PageWatchUI = PageWatchUI;
    globalThis.TabManager = { createTab: vi.fn() };
    PageWatch.showManager();
    const row = document.querySelector('#vex-watches [data-id="w1"]');
    expect(row.querySelector('[data-diff]')).toBeTruthy();
    row.querySelector('[data-pause]').click();
    expect(PageWatch.list()[0].paused).toBe(true);
    expect(document.querySelector('#vex-watches [data-id="w1"]').textContent).toMatch(/paused/i);
    expect(await PageWatch.checkDue(Date.now() + 99 * 3600000)).toEqual([]);
    delete globalThis.PageWatchUI;
  });

  it('stopping a watch with a history asks first', async () => {
    seed();
    globalThis.vexConfirm = vi.fn(async () => false);
    PageWatch.showManager();
    document.querySelector('#vex-watches [data-x]').click();
    await settle();
    expect(vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ okLabel: 'Stop watching' }));
    expect(PageWatch.list()).toHaveLength(1);
    globalThis.vexConfirm = vi.fn(async () => true);
    document.querySelector('#vex-watches [data-x]').click();
    await settle();
    expect(PageWatch.list()).toHaveLength(0);
    expect(PageWatch.history('w1')).toEqual([]);
    delete globalThis.vexConfirm;
  });
});

describe('Settings', () => {
  it('saves the switch and the limits, and cleans them', () => {
    const host = document.getElementById('settings-host');
    PageWatchUI.renderSettings(host);
    host.querySelector('#pw-set-enabled').checked = false;
    host.querySelector('#pw-set-enabled').dispatchEvent(new Event('change'));
    expect(PageWatch.settings().enabled).toBe(false);
    host.querySelector('#pw-set-max').value = '12';
    host.querySelector('#pw-set-max').dispatchEvent(new Event('change'));
    host.querySelector('#pw-set-snaps').value = '5';
    host.querySelector('#pw-set-snaps').dispatchEvent(new Event('change'));
    host.querySelector('#pw-set-sens').value = 'low';
    host.querySelector('#pw-set-sens').dispatchEvent(new Event('change'));
    expect(PageWatch.settings()).toMatchObject({ enabled: false, maxWatches: 12, maxSnapshots: 5, sensitivity: 'low' });
  });
});
