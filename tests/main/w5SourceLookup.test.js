// T3-002: arXiv and ISBN lookups through fixed public hosts, with a local stand-in fetch.
import { describe, it, expect } from 'vitest';

const L = require('../../src/main/source-lookup.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>http://arxiv.org/abs/2101.00001v2</id><published>2021-01-01T12:00:00Z</published>
<title>Attention &amp; Memory:
 A Study</title>
<author><name>Ada B. Lovelace</name></author><author><name>Plato</name></author>
<arxiv:doi>10.1000/xyz123</arxiv:doi><arxiv:journal_ref>J. Tests 3 (2021) 1-9</arxiv:journal_ref></entry></feed>`;

const stand = (reply, calls = []) => ({ calls, fetch: async (u, i) => { calls.push([u, i]); return reply; } });
const ok = (over) => ({ ok: true, status: 200, text: async () => '', json: async () => ({}), ...over });

describe('ids', () => {
  it('normalizes the usual spellings of an arXiv id', () => {
    expect(L.normalizeArxiv('arXiv:2101.00001v2')).toBe('2101.00001');
    expect(L.normalizeArxiv('https://arxiv.org/abs/2101.00001v3')).toBe('2101.00001');
    expect(L.normalizeArxiv('https://arxiv.org/pdf/hep-th/9901001.pdf')).toBe('hep-th/9901001');
    expect(() => L.normalizeArxiv('hello')).toThrow(/not an arXiv id/);
    expect(() => L.normalizeArxiv('../../etc')).toThrow(/not an arXiv id/);
  });
  it('checks the ISBN check digit', () => {
    expect(L.normalizeIsbn('0-306-40615-2')).toBe('0306406152');
    expect(L.normalizeIsbn('ISBN 978-0-306-40615-7')).toBe('9780306406157');
    expect(L.normalizeIsbn('080442957X')).toBe('080442957X');
    expect(() => L.normalizeIsbn('0-306-40615-3')).toThrow(/wrong check digit/);
    expect(() => L.normalizeIsbn('12345')).toThrow(/not an ISBN/);
  });
});

describe('arXiv', () => {
  it('turns the Atom answer into a record, only what arXiv said', () => {
    const r = L.recordFromArxiv(ATOM, '2101.00001');
    expect(r).toMatchObject({ kind: 'preprint', title: 'Attention & Memory: A Study', arxiv: '2101.00001', doi: '10.1000/xyz123', date: '2021-01-01', url: 'https://arxiv.org/abs/2101.00001', container: 'J. Tests 3 (2021) 1-9' });
    expect(r.authors).toEqual([{ family: 'Lovelace', given: 'Ada B.' }, { family: 'Plato', given: '' }]);
  });
  it('says plainly when arXiv has no such paper', () => {
    expect(() => L.recordFromArxiv('<feed></feed>', '2101.99999')).toThrow(/does not know/);
    expect(() => L.recordFromArxiv('<feed><entry><title>Error</title></entry></feed>', '2101.99999')).toThrow(/does not know/);
  });
  it('asks one fixed host once, with no credentials, an egress hint, and nothing but the id', async () => {
    const s = stand(ok({ text: async () => ATOM }));
    const r = await L.createSourceLookup({ fetch: s.fetch }).arxiv('arXiv:2101.00001v1');
    expect(r.title).toMatch(/Attention/);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0][0]).toBe('https://export.arxiv.org/api/query?max_results=1&id_list=2101.00001');
    expect(s.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', egress: { feature: 'Citation lookup (arXiv)', kind: 'fetch' } });
  });
  it('explains a refusal and an outage', async () => {
    await expect(L.createSourceLookup({ fetch: stand({ ok: false, status: 503 }).fetch }).arxiv('2101.00001')).rejects.toThrow(/arXiv answered 503/);
    await expect(L.createSourceLookup({ fetch: async () => { throw new Error('offline'); } }).arxiv('2101.00001')).rejects.toThrow(/Could not reach arXiv/);
  });
});

describe('ISBN', () => {
  const body = { 'ISBN:9780306406157': { title: 'A Book', subtitle: 'With Parts', authors: [{ name: 'Jo Smith' }], publishers: [{ name: 'Press' }], publish_date: 'March 5, 2001', url: 'https://openlibrary.org/books/OL1M/A_Book' } };
  it('turns Open Library data into a record', () => {
    expect(L.recordFromOpenLibrary(body, '9780306406157')).toMatchObject({ kind: 'book', title: 'A Book: With Parts', publisher: 'Press', date: '2001', isbn: '9780306406157', url: 'https://openlibrary.org/books/OL1M/A_Book', authors: [{ family: 'Smith', given: 'Jo' }] });
    expect(() => L.recordFromOpenLibrary({}, '9780306406157')).toThrow(/does not know/);
  });
  it('asks one fixed host once, and never takes a link from another host', async () => {
    const evil = { 'ISBN:9780306406157': { title: 'T', url: 'https://evil.example/x' } };
    const s = stand(ok({ json: async () => evil }));
    const r = await L.createSourceLookup({ fetch: s.fetch }).isbn('978-0-306-40615-7');
    expect(r.url).toBe('');
    expect(s.calls[0][0]).toBe('https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=ISBN%3A9780306406157');
    expect(s.calls[0][1]).toMatchObject({ credentials: 'omit', egress: { feature: 'Citation lookup (ISBN)' } });
  });
  it('rejects a bad ISBN before any request', async () => {
    const s = stand(ok());
    await expect(L.createSourceLookup({ fetch: s.fetch }).isbn('0-306-40615-3')).rejects.toThrow(/check digit/);
    expect(s.calls).toHaveLength(0);
  });
});

describe('IPC', () => {
  it('bounds the request and keeps it to Vex\'s own window', () => {
    expect(() => validate('sources:resolve-id', ['arxiv', '2101.00001'])).not.toThrow();
    expect(() => validate('sources:resolve-id', ['isbn', '9780306406157'])).not.toThrow();
    expect(() => validate('sources:resolve-id', ['url', 'https://evil.example'])).toThrow(/Invalid payload/);
    expect(() => validate('sources:resolve-id', ['arxiv', 'x'.repeat(200)])).toThrow(/Invalid payload/);
    expect(UI_ONLY_CHANNELS.has('sources:resolve-id')).toBe(true);
  });
});
