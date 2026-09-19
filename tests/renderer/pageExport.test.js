// @vitest-environment jsdom
//
// A browser is good at showing a page and oddly bad at letting you keep any of
// it: as a PDF, as a file, its links, its pictures, a citation for it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { PageExport } = require('../../src/renderer/js/page-export.js');

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.vexConfirm = vi.fn(async () => true);
  window.vexPrompt = vi.fn(async () => null);
  window.vex = { pageSave: vi.fn(async () => ({ ok: true, path: 'C:/Users/me/Downloads/An article.pdf' })), mediaDownload: vi.fn() };
  globalThis.WebviewManager = { getActiveWebview: () => ({ getWebContentsId: () => 7 }) };
  globalThis.TabManager = { createTab: vi.fn(), getActiveTab: () => ({ title: 'An article' }) };
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}), readText: vi.fn(async () => '') } });
});

describe('keeping the page', () => {
  it('asks main to save this tab, and names the file it made', async () => {
    await PageExport.savePage('pdf');
    expect(window.vex.pageSave).toHaveBeenCalledWith(7, 'pdf', 'An article');
    expect(window.showToast).toHaveBeenCalledWith('Saved as PDF — An article.pdf');
  });
  it('cancelling says nothing', async () => {
    window.vex.pageSave = vi.fn(async () => ({ ok: false, cancelled: true }));
    expect(await PageExport.savePage('mhtml')).toBe(null);
    expect(window.showToast).not.toHaveBeenCalled();
  });
  it('a failure is reported, not swallowed', async () => {
    window.vex.pageSave = vi.fn(async () => ({ ok: false, error: 'That tab has closed' }));
    await expect(PageExport.savePage('pdf')).rejects.toThrow(/tab has closed/);
  });
  it('a page still opening is refused plainly', async () => {
    WebviewManager.getActiveWebview = () => ({ getWebContentsId: () => -1 });
    await expect(PageExport.savePage('pdf')).rejects.toThrow(/not finished opening/);
  });
});

describe('finding links in whatever was pasted', () => {
  it('one per line, comma-separated, and inside a sentence', () => {
    expect(PageExport.parseUrls('https://a.com/1\nhttps://b.com/2, www.c.com and see example.org/page.')).toEqual([
      'https://a.com/1', 'https://b.com/2', 'https://www.c.com/', 'https://example.org/page',
    ]);
  });
  it('drops duplicates and trailing punctuation', () => {
    expect(PageExport.parseUrls('https://a.com/x. https://a.com/x! (https://a.com/x)')).toEqual(['https://a.com/x']);
  });
  it('only http(s) — never javascript:, file: or a bare word', () => {
    expect(PageExport.parseUrls('javascript:alert(1) file:///C:/x ftp://a.com hello world 3.14')).toEqual([]);
  });
});

describe('opening them', () => {
  it('opens each, the first in front', async () => {
    expect(await PageExport.openMany('a.com b.com c.com')).toBe(3);
    expect(TabManager.createTab.mock.calls).toEqual([['https://a.com/', true], ['https://b.com/', false], ['https://c.com/', false]]);
  });
  it('asks before a lot, and opens none if told no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    const many = Array.from({ length: 12 }, (_, i) => 'site' + i + '.com').join(' ');
    expect(await PageExport.openMany(many)).toBe(0);
    expect(window.vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Open 12 tabs?' }));
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });
  it('refuses an absurd number, and says when there are none', async () => {
    const huge = Array.from({ length: 60 }, (_, i) => 's' + i + '.com').join(' ');
    await expect(PageExport.openMany(huge)).rejects.toThrow(/at most 50/);
    await expect(PageExport.openMany('nothing here')).rejects.toThrow(/no web addresses/);
  });
  it('offers what is already on the clipboard', async () => {
    navigator.clipboard.readText = vi.fn(async () => 'look at https://a.com and https://b.com');
    window.vexPrompt = vi.fn(async (o) => o.value);
    expect(await PageExport.promptOpenMany()).toBe(2);
    expect(window.vexPrompt.mock.calls[0][0].message).toMatch(/Found 2 on your clipboard/);
  });
});

describe('citations', () => {
  const META = { title: 'Boilers and You', authors: ['Jane Q. Smith', 'Alan Doe'], date: '2024-03-03T10:00:00Z', site: 'Which?', url: 'https://which.co.uk/boilers' };
  const TODAY = new Date(2026, 8, 19);

  it('APA 7', () => {
    expect(PageExport.cite(META, 'apa', TODAY)).toBe('Smith, J. Q., & Doe, A. (2024, March 3). Boilers and You. Which?. https://which.co.uk/boilers');
  });
  it('APA with no author puts the title first', () => {
    expect(PageExport.cite({ ...META, authors: [] }, 'apa', TODAY)).toMatch(/^Boilers and You\. \(2024, March 3\)/);
  });
  it('APA with no date says n.d.', () => {
    expect(PageExport.cite({ ...META, date: '' }, 'apa', TODAY)).toContain('(n.d.)');
  });
  it('MLA 9', () => {
    expect(PageExport.cite(META, 'mla', TODAY)).toBe('Smith, Jane Q., and Alan Doe. "Boilers and You." Which?, 3 Mar. 2024, which.co.uk/boilers. Accessed 19 Sept. 2026.');
  });
  it('MLA with three or more authors uses et al.', () => {
    expect(PageExport.cite({ ...META, authors: ['A B', 'C D', 'E F'] }, 'mla', TODAY)).toMatch(/^B, A, et al\./);
  });
  it('Harvard', () => {
    expect(PageExport.cite(META, 'harvard', TODAY)).toBe('Smith, J. Q. and Doe, A. (2024) Boilers and You. Available at: https://which.co.uk/boilers (Accessed: 19 September 2026).');
  });
  it('Chicago', () => {
    expect(PageExport.cite(META, 'chicago', TODAY)).toBe('Smith, Jane Q., and Alan Doe. "Boilers and You." Which?. March 3, 2024. https://which.co.uk/boilers.');
  });
  it('BibTeX, with the characters BibTeX chokes on escaped', () => {
    const b = PageExport.cite({ ...META, title: '100% of_it & more' }, 'bibtex', TODAY);
    expect(b).toMatch(/^@misc\{smith2024,/);
    expect(b).toContain('author = {Smith, Jane Q. and Doe, Alan}');
    expect(b).toContain('title = {100\\% of\\_it \\& more}');
    expect(b).toContain('note = {Accessed 2026-09-19}');
  });
  it('a DOI wins over the page address', () => {
    expect(PageExport.cite({ ...META, doi: '10.1000/xyz' }, 'apa', TODAY)).toContain('https://doi.org/10.1000/xyz');
  });
  it('"Smith, Jane" is read the right way round', () => {
    expect(PageExport._name('Smith, Jane')).toEqual({ last: 'Smith', first: 'Jane' });
    expect(PageExport._name('World Health Organization')).toEqual({ last: 'Organization', first: 'World Health' });
  });
  it('an unknown style is an error, not a blank', () => {
    expect(() => PageExport.cite(META, 'vancouver')).toThrow(/Unknown citation style/);
  });

  it('the sheet copies what it shows, remembers the style, and warns when there is no author', async () => {
    window.vexGuestEval = vi.fn(async () => ({ ...META, authors: [] }));
    await PageExport.openCitation();
    const box = document.querySelector('.vex-cite-overlay');
    expect(box.textContent).toMatch(/names no author/);
    box.querySelector('[data-style="mla"]').click();
    expect(localStorage.getItem('vex.citeStyle')).toBe('mla');
    const shown = document.querySelector('[data-cite]').textContent;
    expect(shown).toMatch(/^"Boilers and You\."/);
    document.querySelector('[data-copy]').click();
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(shown));
  });
});

describe('images', () => {
  it('biggest first, saved through the tab so its cookies go with the request', async () => {
    window.vexGuestEval = vi.fn(async () => [
      { src: 'https://a.com/small.jpg', w: 100, h: 100, alt: '' },
      { src: 'https://a.com/big.jpg', w: 1600, h: 900, alt: 'A boiler' },
    ]);
    await PageExport.openImages();
    const cells = document.querySelectorAll('.vex-img-overlay [data-body] > button');
    expect(cells).toHaveLength(2);
    expect(cells[0].title).toContain('A boiler');
    cells[0].click();
    expect(window.vex.mediaDownload).toHaveBeenCalledWith(7, 'https://a.com/big.jpg');
  });
  it('asks before saving a great many', async () => {
    window.vexGuestEval = vi.fn(async () => Array.from({ length: 14 }, (_, i) => ({ src: 'https://a.com/' + i + '.jpg', w: 200, h: 200 })));
    await PageExport.openImages();
    document.querySelector('[data-all]').click();
    await vi.waitFor(() => expect(window.vex.mediaDownload).toHaveBeenCalledTimes(14));
    expect(window.vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save 14 images?' }));
  });
  it('says so on a page with none', async () => {
    window.vexGuestEval = vi.fn(async () => []);
    await expect(PageExport.openImages()).rejects.toThrow(/no pictures/);
  });
  it('an image address cannot break out of its attribute', async () => {
    window.vexGuestEval = vi.fn(async () => [{ src: 'https://a.com/x.jpg" onerror="alert(1)', w: 200, h: 200 }]);
    await PageExport.openImages();
    const img = document.querySelector('.vex-img-overlay img');
    expect(img.getAttribute('onerror')).toBe(null);
  });
});
