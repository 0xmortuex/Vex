// T3-011: APA / MLA / Chicago / Kaynakca / BibTeX from one source record (js/cite-styles.js).
import { describe, it, expect } from 'vitest';

const { VexCiteStyles: C } = require('../../src/renderer/js/cite-styles.js');

const article = {
  kind: 'article', title: 'Attention is all you need', authors: [{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }],
  date: '2017-06-12', container: 'Advances in Neural Information Processing Systems', volume: '30', issue: '2', pages: '5998-6008', doi: '10.5555/3295222.3295349',
  url: 'https://example.org/paper', accessed: '2026-10-16',
};
const web = {
  kind: 'webpage', title: 'How the boot process works', authors: [{ family: 'Doe', given: 'Jane Q.' }], date: '2024-03-05', site: 'Example Tech',
  url: 'https://example.com/boot', accessed: '2026-10-16',
};

describe('APA 7', () => {
  it('writes a journal article with initials, volume, issue, pages and the DOI link', () => {
    expect(C.format('apa', article)).toBe('Vaswani, A., & Shazeer, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30(2), 5998–6008. https://doi.org/10.5555/3295222.3295349');
  });
  it('writes a web page with the full date and the site name, italic title only when asked', () => {
    expect(C.format('apa', web)).toBe('Doe, J. Q. (2024, March 5). How the boot process works. Example Tech. https://example.com/boot');
    expect(C.format('apa', web, { md: true })).toBe('Doe, J. Q. (2024, March 5). *How the boot process works*. Example Tech. https://example.com/boot');
  });
  it('starts with the title when there is no author, and says n.d. when there is no date', () => {
    expect(C.format('apa', { kind: 'webpage', title: 'Untitled page', url: 'https://x.org/a', site: 'x.org' })).toBe('Untitled page. (n.d.). x.org. https://x.org/a');
  });
  it('joins three authors with commas and an ampersand', () => {
    const r = { ...article, authors: [{ family: 'A', given: 'Ann' }, { family: 'B', given: 'Bo' }, { family: 'C', given: 'Cy' }] };
    expect(C.format('apa', r)).toMatch(/^A, A\., B, B\., & C, C\. \(2017\)/);
  });
  it('writes an organisation author as it is', () => {
    expect(C.format('apa', { ...web, authors: [{ family: 'World Health Organization', given: '' }] })).toMatch(/^World Health Organization\. \(2024, March 5\)/);
  });
  it('keeps hyphenated given names as hyphenated initials', () => {
    expect(C.format('apa', { ...web, authors: [{ family: 'Kim', given: 'Jean-Pierre' }] })).toMatch(/^Kim, J\.-P\./);
  });
});

describe('MLA 9', () => {
  it('writes an article with container, volume, number, date and pages', () => {
    expect(C.format('mla', article)).toBe('Vaswani, Ashish, and Noam Shazeer. "Attention is all you need." Advances in Neural Information Processing Systems, vol. 30, no. 2, 12 June 2017, pp. 5998–6008. doi.org/10.5555/3295222.3295349.');
  });
  it('writes a web page with the access date and the address without https://', () => {
    expect(C.format('mla', web)).toBe('Doe, Jane Q. "How the boot process works." Example Tech, 5 Mar. 2024. example.com/boot. Accessed 16 Oct. 2026.');
  });
  it('uses et al. for three or more authors', () => {
    const r = { ...article, authors: [{ family: 'A', given: 'Ann' }, { family: 'B', given: 'Bo' }, { family: 'C', given: 'Cy' }] };
    expect(C.format('mla', r)).toMatch(/^A, Ann, et al\. "/);
  });
});

describe('Chicago', () => {
  it('writes an article with the year in parentheses and the pages after a colon', () => {
    expect(C.format('chicago', article)).toBe('Vaswani, Ashish, and Noam Shazeer. "Attention is all you need." Advances in Neural Information Processing Systems 30, no. 2 (2017): 5998–6008. https://doi.org/10.5555/3295222.3295349.');
  });
  it('writes a web page with site and full date', () => {
    expect(C.format('chicago', web)).toBe('Doe, Jane Q. "How the boot process works." Example Tech. March 5, 2024. https://example.com/boot.');
  });
});

describe('Kaynakca (Turkish)', () => {
  it('writes the year first and uses Turkish month names and "Erisim tarihi" for a web page', () => {
    expect(C.format('tr', web)).toBe('Doe, J. Q. (2024). How the boot process works. Example Tech. https://example.com/boot Erişim tarihi: 16 Ekim 2026.');
  });
  it('joins two authors with "ve"', () => {
    expect(C.format('tr', article)).toMatch(/^Vaswani, A\. ve Shazeer, N\. \(2017\)\./);
  });
  it('writes s.t. when there is no date', () => {
    expect(C.format('tr', { kind: 'webpage', title: 'Sayfa', url: 'https://a.tr/x' })).toMatch(/\(s\.t\.\)/);
  });
});

describe('BibTeX', () => {
  it('writes an @article with escaped special characters, a key and a page range with --', () => {
    const out = C.format('bibtex', { ...article, title: 'R&D at 100% & more' });
    expect(out.startsWith('@article{Vaswani2017More,')).toBe(true);
    expect(out).toContain('author = {Vaswani, Ashish and Shazeer, Noam}');
    expect(out).toContain('title = {{R\\&D at 100\\% \\& more}}');
    expect(out).toContain('pages = {5998--6008}');
    expect(out).toContain('doi = {10.5555/3295222.3295349}');
    expect(out).toContain('year = {2017}');
    expect(out).toContain('month = {jun}');
  });
  it('writes a web page as @misc with url and urldate', () => {
    const out = C.format('bibtex', web);
    expect(out.startsWith('@misc{Doe2024Boot,')).toBe(true);
    expect(out).toContain('howpublished = {Example Tech}');
    expect(out).toContain('urldate = {2026-10-16}');
  });
  it('keeps an organisation author in braces so it is not split into first and last name', () => {
    expect(C.format('bibtex', { ...web, authors: [{ family: 'World Health Organization', given: '' }] })).toContain('author = {{World Health Organization}}');
  });
  it('makes an ASCII key out of a Turkish name', () => {
    expect(C.bibKey({ title: 'Osmanlı tarihi', authors: [{ family: 'Öztürk', given: 'Ayşe' }], date: '2020' })).toBe('Ozturk2020Osmanli');
  });
});

describe('refusals and bibliography', () => {
  it('refuses an unknown style and a record without a title', () => {
    expect(() => C.format('harvard', web)).toThrow(/Unknown citation style/);
    expect(() => C.format('apa', { kind: 'webpage', title: '   ' })).toThrow(/no title/);
  });
  it('sorts a bibliography by first author and counts what it left out', () => {
    const r = C.bibliography('apa', [web, article, { title: '' }]);
    expect(r.count).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.text.startsWith('Doe, J. Q.')).toBe(true);
  });
  it('parses dates of three precisions', () => {
    expect(C.parseDate('2020')).toEqual({ y: 2020, m: 0, d: 0 });
    expect(C.parseDate('2020-03')).toEqual({ y: 2020, m: 3, d: 0 });
    expect(C.parseDate('2020-03-05T10:00:00Z')).toEqual({ y: 2020, m: 3, d: 5 });
    expect(C.parseDate('last week')).toBe(null);
  });
});
