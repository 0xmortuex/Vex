// @vitest-environment jsdom
//
// Two things every page has that no browser hands you: the real cells of a
// table (copying one gives run-together text), and a video's speed (sites bury
// it three menus deep, or do not offer it at all).

import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { PageTools } = require('../../src/renderer/js/page-tools.js');

// A webview that runs the injected script against this jsdom document, which
// is what the real one does inside the page.
function guest() {
  return { getURL: () => 'https://data.example/report', isLoading: () => false, executeJavaScript: (code) => Promise.resolve((0, eval)(code)) };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.WebviewManager = { getActiveWebview: () => null };
  // The injected speed script stays wired to the page it ran in; jsdom shares
  // one window across tests, so a leftover rate would reach the next one.
  delete window.__vexRate; delete window.__vexRateWired;
});

describe('taking a table', () => {
  it('reads the real cells, keeps the caption, and skips layout tables', async () => {
    document.body.innerHTML = `
      <table><caption>Prices</caption>
        <tr><th>Item</th><th>Cost</th></tr>
        <tr><td>Monitor</td><td>£250</td></tr>
        <tr><td>Desk</td><td>£99</td></tr>
      </table>
      <table><tr><td>a single row, so it is layout</td></tr></table>`;
    const tables = await PageTools.tables(guest());
    expect(tables).toHaveLength(1);
    expect(tables[0].caption).toBe('Prices');
    expect(tables[0].rows).toEqual([['Item', 'Cost'], ['Monitor', '£250'], ['Desk', '£99']]);
  });

  it('a cell spanning columns leaves the later ones empty, so the rows still line up', async () => {
    document.body.innerHTML = `<table>
      <tr><th colspan="2">Two wide</th><th>Third</th></tr>
      <tr><td>a</td><td>b</td><td>c</td></tr></table>`;
    const [t] = await PageTools.tables(guest());
    expect(t.rows).toEqual([['Two wide', '', 'Third'], ['a', 'b', 'c']]);
  });

  it('says so when there is no page', async () => {
    await expect(PageTools.tables()).rejects.toThrow('No page is open');
  });
});

describe('as CSV', () => {
  it('quotes a field with a comma, a quote or a line break — spreadsheets are unforgiving', () => {
    expect(PageTools.toCsv([['plain', 'with,comma'], ['say "hi"', 'two\nlines']]))
      .toBe('plain,"with,comma"\r\n"say ""hi""","two\nlines"');
  });

  it('as Markdown, the first row is the header and a pipe is escaped', () => {
    expect(PageTools.toMarkdown([['A', 'B'], ['1', 'x|y']])).toBe('| A | B |\n| --- | --- |\n| 1 | x\\|y |');
    expect(PageTools.toMarkdown([])).toBe('');
  });

  it('a short row is padded, so the columns do not shift', () => {
    expect(PageTools.toMarkdown([['A', 'B', 'C'], ['1']])).toContain('| 1 |  |  |');
  });
});

describe('video speed', () => {
  it('is remembered per site, and 1x means "nothing to remember"', () => {
    PageTools.setSpeedFor('https://lectures.example/x', 1.5);
    expect(PageTools.speedFor('https://lectures.example/anything')).toBe(1.5);
    expect(PageTools.speedFor('https://other.example/')).toBe(1);
    PageTools.setSpeedFor('https://lectures.example/x', 1);
    expect(JSON.parse(localStorage.getItem(PageTools.SPEED_KEY))).toEqual({});
  });

  it('refuses a speed that is not one, and a tab with no address', () => {
    expect(() => PageTools.setSpeedFor('https://a.example/', 0)).toThrow(/between 0.1 and 5/);
    expect(() => PageTools.setSpeedFor('https://a.example/', 99)).toThrow(/between 0.1 and 5/);
    expect(() => PageTools.setSpeedFor('not a url', 2)).toThrow(/no address yet/);
  });

  it('sets every video on the page and holds it against the site changing it back', async () => {
    document.body.innerHTML = '<video id="v1"></video><video id="v2"></video>';
    const n = await PageTools.applySpeed(guest(), 'https://lectures.example/x', 2);
    expect(n).toBe(2);
    expect(document.getElementById('v1').playbackRate).toBe(2);
    // A player that resets its own rate is put back.
    const v = document.getElementById('v2');
    v.playbackRate = 1;
    v.dispatchEvent(new Event('ratechange', { bubbles: true }));
    expect(v.playbackRate).toBe(2);
  });

  it('a video that appears later gets the speed too', async () => {
    document.body.innerHTML = '<video id="v1"></video>';
    await PageTools.applySpeed(guest(), 'https://lectures.example/x', 1.5);
    const later = document.createElement('video');
    document.body.appendChild(later);
    later.dispatchEvent(new Event('play', { bubbles: true }));
    expect(later.playbackRate).toBe(1.5);
  });

  it('does nothing on a site with no remembered speed', async () => {
    document.body.innerHTML = '<video id="v1"></video>';
    expect(await PageTools.applySpeed(guest(), 'https://plain.example/')).toBe(0);
    expect(document.getElementById('v1').playbackRate).toBe(1);
  });

  it('a page that will not answer is recorded, not thrown at the caller', async () => {
    const broken = { getURL: () => 'https://a.example/', isLoading: () => false, executeJavaScript: () => Promise.reject(new Error('guest gone')) };
    expect(await PageTools.applySpeed(broken, 'https://a.example/', 2)).toBe(0);
    expect(VexProblems.note).toHaveBeenCalledWith('Video speed', 'Could not set the speed on this page', expect.any(Error));
  });
});
