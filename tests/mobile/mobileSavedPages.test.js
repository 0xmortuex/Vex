// @vitest-environment jsdom
//
// Saving a page for offline. The part worth pinning down is what comes out of
// the page before it is stored: a saved page is read back with the ORIGIN of the
// site it came from, so a script left in it would run as that site against the
// cookies you have months later.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// tools.js takes its DOM helpers from VexDom at module scope; the parts this
// test touches need none of them.
window.VexDom = { $: () => null, el: () => document.createElement('div'), icon: () => null, clear: node => node };

const rows = { pages: [], pagehtml: [] };
let nextId = 1;
window.VexDB = {
  add: vi.fn(async (store, record) => { const id = nextId++; rows[store].push({ ...record, id }); return id; }),
  put: vi.fn(async (store, record) => { rows[store].push(record); return record.id; }),
  get: vi.fn(async (store, id) => rows[store].find(row => row.id === id) || null),
  delete: vi.fn(async (store, id) => { rows[store] = rows[store].filter(row => row.id !== id); }),
  scan: vi.fn(async store => rows[store].slice())
};
window.VexSearch = {
  prettyHost: url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
};
window.VexUI = { toast: vi.fn() };
window.VexTabStore = { active: () => ({ id: 't1' }), update: vi.fn() };
window.VexBridge = {
  // The real thing runs the script in the page; here it runs against jsdom's
  // document, which is as close as a test can get without a phone.
  // eslint-disable-next-line no-eval
  evaluate: vi.fn(async (id, code) => ({ result: JSON.stringify(eval(code)) })),
  loadHtml: vi.fn(async () => {})
};

const { VexTools } = require('../../mobile/www/js/tools.js');

const tab = { id: 't1', url: 'https://example.com/article', title: 'An article' };

beforeEach(() => {
  rows.pages = []; rows.pagehtml = []; nextId = 1;
  document.documentElement.innerHTML = '<head><title>t</title></head><body></body>';
  for (const fn of Object.values(window.VexDB)) fn.mockClear();
  window.VexBridge.loadHtml.mockClear();
  window.VexUI.toast.mockClear();
});

function pageOf(html) {
  document.body.innerHTML = html + '<p>' + 'padding '.repeat(40) + '</p>';
}

describe('what gets saved', () => {
  it('takes the scripts out', async () => {
    pageOf('<p>Words</p><script>window.evil = 1;</script><script src="https://x.example/a.js"></script>');
    const record = await VexTools.savePage(tab);
    const html = rows.pagehtml[0].html;
    expect(html).toContain('Words');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('window.evil');
    expect(record.size).toBe(html.length);
  });

  it('takes the inline handlers out, whatever case they were written in', async () => {
    pageOf('<button onclick="steal()" ONMOUSEOVER="also()" class="keep">Tap</button>');
    await VexTools.savePage(tab);
    const html = rows.pagehtml[0].html;
    expect(html).not.toMatch(/onclick/i);
    expect(html).not.toMatch(/onmouseover/i);
    // And leaves everything else alone.
    expect(html).toContain('class="keep"');
    expect(html).toContain('Tap');
  });

  it('keeps the document shape, so it renders as it looked', async () => {
    pageOf('<h1>Heading</h1><img src="/pic.png"><p>Body</p>');
    await VexTools.savePage(tab);
    const html = rows.pagehtml[0].html;
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('src="/pic.png"');
  });

  it('stores the row and the document apart, under one id', async () => {
    pageOf('<p>Words</p>');
    const record = await VexTools.savePage(tab);
    expect(rows.pages[0].html).toBeUndefined();
    expect(rows.pages[0]).toMatchObject({ url: tab.url, title: 'An article' });
    expect(rows.pagehtml[0].id).toBe(record.id);
  });

  it('refuses a page with nothing on it, and a blank tab', async () => {
    document.body.innerHTML = '<p>short</p>';
    await expect(VexTools.savePage(tab)).rejects.toThrow('nothing to save');
    await expect(VexTools.savePage({ id: 't1', url: 'about:blank' })).rejects.toThrow('Open a page first');
  });
});

describe('reading one back', () => {
  it('reads the document out of its own store', async () => {
    pageOf('<p>Words</p>');
    const record = await VexTools.savePage(tab);
    await VexTools.openSaved(record);
    expect(window.VexBridge.loadHtml)
      .toHaveBeenCalledWith('t1', rows.pagehtml[0].html, tab.url);
  });

  it('still opens one saved before the document moved out of the row', async () => {
    await VexTools.openSaved({ id: 99, url: 'https://old.example/', title: 'Old', html: '<p>inline</p>' });
    expect(window.VexBridge.loadHtml).toHaveBeenCalledWith('t1', '<p>inline</p>', 'https://old.example/');
  });

  it('says so rather than showing a blank page', async () => {
    window.VexBridge.loadHtml.mockClear();
    await VexTools.openSaved({ id: 1234, url: 'https://gone.example/' });
    expect(window.VexUI.toast).toHaveBeenCalledWith('That saved page is empty');
    expect(window.VexBridge.loadHtml).not.toHaveBeenCalled();
  });

  it('deletes both halves', async () => {
    pageOf('<p>Words</p>');
    const record = await VexTools.savePage(tab);
    await VexTools.deleteSaved(record.id);
    expect(window.VexDB.delete).toHaveBeenCalledWith('pages', record.id);
    expect(window.VexDB.delete).toHaveBeenCalledWith('pagehtml', record.id);
  });
});
