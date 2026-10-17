// @vitest-environment jsdom
//
// T2-078 (Wave 6): the redaction tool also covers plain-text documents, with the same patterns as for pictures.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexPictureRedact: R } = require('../../src/renderer/js/redact-tool.js');

const DOC = [
  'Contact: ayse.demir@example.com or +90 532 123 45 67.',
  'Card 4111 1111 1111 1111 expires 12/28. Not a card: 1234 5678 9012 3456.',
  'IBAN TR33 0006 1005 1978 6457 8413 26 for the transfer.',
  'Key sk-abcdefghijklmnopqrstuvwxyz0123456789.',
].join('\n');

describe('finding the pieces in text', () => {
  it('finds email, phone, a card that passes the check, an IBAN and a key, in order', () => {
    const hits = R.findInText(DOC);
    expect(hits.map(h => h.kind)).toEqual(['email', 'phone', 'card', 'iban', 'token']);
    expect(hits[0].text).toBe('ayse.demir@example.com');
    expect(hits.find(h => h.kind === 'card').text.replace(/\D/g, '')).toBe('4111111111111111');
    expect(DOC.slice(hits[3].start, hits[3].end)).toMatch(/^TR33/);
    for (let i = 1; i < hits.length; i++) expect(hits[i].start).toBeGreaterThanOrEqual(hits[i - 1].end);
  });
  it('does not call a 16-digit number that fails the Luhn check a card', () => {
    expect(R.findInText('number 1234 5678 9012 3456').some(h => h.kind === 'card')).toBe(false);
  });
  it('an empty or clean text has nothing, and a huge one is refused', () => {
    expect(R.findInText('')).toEqual([]);
    expect(R.findInText('Nothing secret here.')).toEqual([]);
    expect(() => R.findInText('x'.repeat(R.MAX_DOC_CHARS + 1))).toThrow(/larger than 2 million characters/);
  });
});

describe('covering them', () => {
  it('replaces the chosen pieces with their kind and leaves the rest alone', () => {
    const hits = R.findInText(DOC);
    const all = R.redactText(DOC, hits, hits.map((h, i) => i));
    expect(all).toContain('Contact: [email] or [phone].');
    expect(all).toContain('Card [card] expires 12/28.');
    expect(all).toContain('IBAN [iban] for the transfer.');
    expect(all).toContain('Key [token].');
    expect(all).not.toMatch(/ayse\.demir|4111|TR33|sk-abc/);
    const onlyEmail = R.redactText(DOC, hits, [0]);
    expect(onlyEmail).toContain('[email]');
    expect(onlyEmail).toContain('4111 1111 1111 1111');
    expect(R.redactText(DOC, hits, [])).toBe(DOC);
  });
  it('refuses overlapping pieces instead of mangling the text', () => {
    expect(() => R.redactText('abcdef', [{ kind: 'a', start: 0, end: 4 }, { kind: 'b', start: 2, end: 6 }], [0, 1])).toThrow(/overlap/);
  });
});

describe('the document dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.showToast = vi.fn();
    globalThis.VexSettingsGroups = require('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups || window.VexSettingsGroups;
  });
  const file = (name, text, type = 'text/plain') => ({ name, size: text.length, type, text: async () => text });

  it('lists each piece with a tick and says nothing was changed', async () => {
    const r = await R.openDocument(file('notes.txt', DOC));
    expect(r).toEqual({ hits: 5 });
    expect(document.querySelectorAll('#vex-redact-doc input[type=checkbox]')).toHaveLength(5);
    expect(document.getElementById('vex-redact-doc').textContent).toMatch(/5 pieces that look sensitive.*original file is not changed/);
  });
  it('says what to do about a PDF, and about a file that is not text', async () => {
    await expect(R.openDocument(file('scan.pdf', '%PDF-1.4', 'application/pdf'))).rejects.toThrow(/keeps its text underneath/);
    await expect(R.openDocument(file('x.bin', 'a\u0000b'))).rejects.toThrow(/does not look like a text file/);
  });
  it('a document with nothing sensitive still opens, with a plain warning that patterns miss things', async () => {
    await R.openDocument(file('plain.txt', 'Hello there.'));
    expect(document.getElementById('vex-redact-doc').textContent).toMatch(/Nothing sensitive was recognised.*patterns miss things/);
  });
});
