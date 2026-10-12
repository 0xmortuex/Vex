// Download rules: which folder a file lands in and what it is called.
// A rule's folder and name are things a person typed, so they are also the
// one place a download could be talked out of the Downloads folder.
import { describe, it, expect } from 'vitest';
const path = require('path');
const { place, matches, rename, safeFolder } = require('../../src/main/download-rules.js');

const PDF = { filename: 'invoice_final_2.pdf', url: 'https://billing.github.com/x' };

describe('which rule applies', () => {
  it('by kind of file, by site, or both', () => {
    expect(matches({ ext: 'pdf' }, PDF)).toBe(true);
    expect(matches({ ext: 'zip' }, PDF)).toBe(false);
    expect(matches({ site: 'github.com' }, PDF)).toBe(true);          // a subdomain counts
    expect(matches({ site: 'gitlab.com' }, PDF)).toBe(false);
    expect(matches({ ext: 'pdf', site: 'github.com' }, PDF)).toBe(true);
    expect(matches({ ext: 'pdf', site: 'gitlab.com' }, PDF)).toBe(false);
    expect(matches({ ext: 'pdf, zip, png' }, PDF)).toBe(true);
  });

  it('a rule with nothing to match on never applies', () => {
    expect(matches({ folder: 'Everything' }, PDF)).toBe(false);
  });

  it('the first that matches wins, so the specific ones go first', () => {
    const rules = [
      { id: 'gh-pdf', ext: 'pdf', site: 'github.com', folder: 'Invoices' },
      { id: 'any-pdf', ext: 'pdf', folder: 'Documents' },
    ];
    expect(place(rules, PDF).rule).toBe('gh-pdf');
    expect(place(rules, { filename: 'a.pdf', url: 'https://elsewhere.example/a' }).rule).toBe('any-pdf');
    expect(place(rules, { filename: 'a.zip', url: 'https://elsewhere.example/a' })).toMatchObject({ folder: '', rule: null });
  });
});

describe('the new name', () => {
  const date = new Date(2026, 8, 20);
  it('fills in the date, the site and the original name', () => {
    expect(rename('{date} {site} {name}', { ...PDF, date })).toBe('2026-09-20 billing.github.com invoice_final_2.pdf');
    expect(rename('', { ...PDF, date })).toBe('invoice_final_2.pdf');
    expect(rename('{name}.{ext}', { ...PDF, date })).toBe('invoice_final_2.pdf');
  });

  it('cannot be talked into another folder, or a reserved name', () => {
    expect(rename('../../{name}', { ...PDF, date })).not.toContain('..');
    expect(rename('{name}', { filename: 'CON.txt', url: '' , date })).toBe('_CON.txt');
    expect(safeFolder('../../Windows/System32')).not.toContain('..');
    expect(safeFolder('Invoices/2026')).toBe(path.join('Invoices', '2026'));
    expect(safeFolder('C:\\\\Windows')).not.toMatch(/^C:/);
  });
});

describe('rules typed the way people write them', () => {
  it('a site given as a web address matches its host', () => {
    const r = place([{ id: 'x', ext: 'pdf', site: 'https://github.com/', folder: 'Inv' }], { filename: 'a.pdf', url: 'https://github.com/o/r/a.pdf' });
    expect(r.folder).toBe('Inv');
    expect(matches({ site: 'https://www.github.com/x' }, PDF)).toBe(true);
    expect(matches({ site: 'github.com/' }, PDF)).toBe(true);
  });
  it('a kind of file given with its dot still matches', () => {
    expect(matches({ ext: '.pdf' }, PDF)).toBe(true);
    expect(matches({ ext: '.zip, .pdf' }, PDF)).toBe(true);
  });
});
