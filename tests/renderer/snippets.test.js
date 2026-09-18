// @vitest-environment jsdom
//
// A snippet is an abbreviation and the text it becomes. The expansion itself
// happens in the guest preload, because that is where the caret is; this module
// owns the list and pushes it to every tab. So what is testable here is the
// list: what makes a valid abbreviation, and exactly what each page is told.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { Snippets } = require('../../src/renderer/js/snippets.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.VexIcons = { svg: () => '<svg></svg>' };
  Snippets.items = [];
  Snippets.init();
});

describe('what counts as an abbreviation', () => {
  it('takes the ones people actually use', () => {
    for (const a of [';addr', 'sig', '@@', 'inv-2', 'a.b', ':shrug', 'my_email']) {
      expect(() => Snippets.normalise(a), a).not.toThrow();
    }
  });

  it('refuses one with a space, because the page matches the word before the caret', () => {
    expect(() => Snippets.normalise('my address')).toThrow(/cannot contain spaces/);
  });

  it('refuses an empty one, an enormous one, and one full of punctuation it cannot match', () => {
    expect(() => Snippets.normalise('   ')).toThrow(/Give the snippet an abbreviation/);
    expect(() => Snippets.normalise('x'.repeat(41))).toThrow(/too long/);
    expect(() => Snippets.normalise('a#b')).toThrow(/Use letters, digits/);
  });

  it('trims it, so a stray space does not make it unmatchable', () => {
    expect(Snippets.normalise('  ;addr  ')).toBe(';addr');
  });
});

describe('keeping them', () => {
  it('saves one and survives a restart', () => {
    Snippets.add(';addr', '12 Bridge Street\nManchester M1 2AB', 'Home address');
    Snippets.items = [];
    Snippets.init();
    expect(Snippets.list()).toHaveLength(1);
    expect(Snippets.list()[0]).toMatchObject({ abbr: ';addr', name: 'Home address' });
    expect(Snippets.list()[0].text).toContain('\n');      // multi-line is the point
  });

  it('will not take two of the same abbreviation', () => {
    Snippets.add(';addr', 'one');
    expect(() => Snippets.add(';addr', 'two')).toThrow(/already a snippet/);
    expect(() => Snippets.add(' ;addr ', 'three')).toThrow(/already a snippet/);
  });

  it('insists on text to expand into', () => {
    expect(() => Snippets.add(';x', '')).toThrow(/some text/);
    expect(() => Snippets.add(';x', 'y'.repeat(Snippets.MAX_TEXT + 1))).toThrow(/too long/);
  });

  it('edits one without letting it collide with another', () => {
    const a = Snippets.add(';a', 'first');
    Snippets.add(';b', 'second');
    expect(() => Snippets.update(a.id, { abbr: ';b' })).toThrow(/already a snippet/);
    Snippets.update(a.id, { abbr: ';aa', text: 'changed' });
    expect(Snippets.list().find(s => s.id === a.id)).toMatchObject({ abbr: ';aa', text: 'changed' });
    expect(() => Snippets.update('gone', { text: 'x' })).toThrow(/gone/);
  });

  it('removes one', () => {
    const a = Snippets.add(';a', 'first');
    Snippets.remove(a.id);
    expect(Snippets.list()).toEqual([]);
  });
});

describe('what a page is told', () => {
  it('the abbreviation and the text, and nothing else about you', () => {
    Snippets.add(';addr', '12 Bridge Street', 'Home address');
    expect(Snippets.forGuest()).toEqual([{ abbr: ';addr', text: '12 Bridge Street' }]);
    // No id, no name, no timestamp reaches the page.
    expect(Object.keys(Snippets.forGuest()[0])).toEqual(['abbr', 'text']);
  });

  it('every open tab is told, and a tab that is not ready yet does not stop the rest', () => {
    const sent = [];
    const wv = (ready) => {
      const el = document.createElement('webview');
      el.send = ready ? ((ch, list) => sent.push([ch, list])) : (() => { throw new Error('not ready'); });
      document.body.appendChild(el);
      return el;
    };
    wv(false); wv(true); wv(true);
    Snippets.add(';a', 'first');
    expect(sent.filter(s => s[0] === 'vex-snippets')).toHaveLength(2);
    expect(sent[0][1]).toEqual([{ abbr: ';a', text: 'first' }]);
  });

  it('a page that loads later is given the list when it is ready', () => {
    Snippets.add(';a', 'first');
    const handlers = {};
    const webview = {
      send: vi.fn(),
      addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    };
    Snippets.attach(webview);
    expect(webview.send).not.toHaveBeenCalled();
    handlers['dom-ready'].forEach(fn => fn());
    expect(webview.send).toHaveBeenCalledWith('vex-snippets', [{ abbr: ';a', text: 'first' }]);
  });

  it('deleting one tells the tabs too, rather than leaving it live in the page', () => {
    const sent = [];
    const el = document.createElement('webview');
    el.send = (ch, list) => sent.push(list);
    document.body.appendChild(el);
    const a = Snippets.add(';a', 'first');
    Snippets.remove(a.id);
    expect(sent[sent.length - 1]).toEqual([]);
  });
});

describe('the editor', () => {
  it('lists each snippet with its abbreviation and a one-line preview', () => {
    Snippets.add(';addr', 'line one\nline two', 'Home address');
    Snippets.openManager();
    const row = document.querySelector('.vex-snip-box [data-list] > div');
    expect(row.querySelector('code').textContent).toBe(';addr');
    expect(row.textContent).toContain('line one line two');
    expect(row.textContent).toContain('Home address');
  });

  it('a snippet cannot smuggle markup into the list', () => {
    Snippets.add(';x', '<img src=x onerror=alert(1)>');
    Snippets.openManager();
    const list = document.querySelector('[data-list]');
    expect(list.querySelector('img')).toBe(null);
    expect(list.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('says why a bad abbreviation was refused, beside the field, and keeps the form open', async () => {
    Snippets.openManager();
    document.querySelector('[data-add]').click();
    await vi.waitFor(() => expect(document.querySelector('.vex-snip-editor')).not.toBe(null));
    document.querySelector('#snip-abbr').value = 'my address';
    document.querySelector('#snip-text').value = 'somewhere';
    document.querySelector('[data-save]').click();
    const err = document.querySelector('.vex-snip-editor [data-err]');
    expect(err.textContent).toMatch(/cannot contain spaces/);
    expect(err.style.display).not.toBe('none');
    expect(document.querySelector('.vex-snip-editor')).not.toBe(null);   // still open to fix it
    expect(Snippets.list()).toEqual([]);
  });

  it('saves a good one and closes', async () => {
    Snippets.openManager();
    document.querySelector('[data-add]').click();
    await vi.waitFor(() => expect(document.querySelector('.vex-snip-editor')).not.toBe(null));
    document.querySelector('#snip-abbr').value = ';addr';
    document.querySelector('#snip-text').value = '12 Bridge Street';
    document.querySelector('[data-save]').click();
    await vi.waitFor(() => expect(document.querySelector('.vex-snip-editor')).toBe(null));
    expect(Snippets.list()[0]).toMatchObject({ abbr: ';addr', text: '12 Bridge Street' });
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('then Tab'));
  });

  it('Escape closes the editor without saving, and leaves the list open', async () => {
    Snippets.openManager();
    document.querySelector('[data-add]').click();
    await vi.waitFor(() => expect(document.querySelector('.vex-snip-editor')).not.toBe(null));
    document.querySelector('#snip-abbr').value = ';addr';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-snip-editor')).toBe(null);
    expect(document.querySelector('.vex-snip-overlay')).not.toBe(null);   // not both at once
    expect(Snippets.list()).toEqual([]);

    // A second Escape, with nothing on top, closes the list itself.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-snip-overlay')).toBe(null);
  });

  it('an editor left open by an earlier mistake cannot swallow Escape from the next one', async () => {
    // A handler whose form is gone from the page must stand aside.
    Snippets.openManager();
    document.querySelector('[data-add]').click();
    await vi.waitFor(() => expect(document.querySelector('.vex-snip-editor')).not.toBe(null));
    document.querySelector('.vex-snip-editor').remove();          // removed without close()
    document.querySelector('[data-add]').click();
    await vi.waitFor(() => expect(document.querySelector('.vex-snip-editor')).not.toBe(null));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-snip-editor')).toBe(null);
  });

  it('opening the manager twice does not leave two of them', () => {
    Snippets.openManager();
    Snippets.openManager();
    expect(document.querySelectorAll('.vex-snip-overlay')).toHaveLength(1);
  });

  it('says plainly when there are none', () => {
    Snippets.openManager();
    expect(document.querySelector('[data-list]').textContent).toMatch(/No snippets yet/);
  });
});
