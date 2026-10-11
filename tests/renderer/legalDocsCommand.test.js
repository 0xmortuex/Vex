// @vitest-environment jsdom
//
// The documents you agreed to can be read again at any time from Ctrl+K
// ("Privacy Policy", "Terms of Use", "License (MIT)", "Third-party Notices",
// all found by typing "legal"), and Settings › About opens every one of them
// inside Vex instead of sending the licence and notices to GitHub.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
require('../../src/renderer/js/vex-markdown.js');
require('../../src/renderer/js/i18n.js');
const { VexLegal } = require('../../src/renderer/js/legal.js');
globalThis.VexLegal = VexLegal;   // a top-level const in the app
const { CommandBar } = require('../../src/renderer/js/command.js');

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const cmd = (id) => CommandBar.commands.find(c => c.id === id);

beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.vex = { legalRead: vi.fn(async (name) => '# ' + name + '\n\nText.') };
});

describe('Ctrl+K opens the legal documents', () => {
  it.each([
    ['legal-privacy', 'PRIVACY.md', 'Privacy policy'],
    ['legal-terms', 'TERMS.md', 'Terms of use'],
    ['legal-license', 'LICENSE', 'License (MIT)'],
    ['legal-notices', 'THIRD_PARTY_NOTICES.md', 'Third-party notices'],
  ])('%s shows %s in the reader', async (id, doc, title) => {
    await cmd(id).action();
    await flush();
    expect(window.vex.legalRead).toHaveBeenCalledWith(doc);
    expect(document.getElementById('vex-legal-doc-title').textContent).toBe(title);
  });

  it('typing "legal" finds all four', () => {
    const found = CommandBar._rankCommands('legal').map(c => c.id);
    expect(found).toEqual(expect.arrayContaining(['legal-privacy', 'legal-terms', 'legal-license', 'legal-notices']));
  });

  it('says why when the documents cannot be read', async () => {
    window.vex = {};
    await expect(cmd('legal-terms').action()).rejects.toThrow(/legalRead is missing/);
  });
});

describe('Settings › About', () => {
  it('opens every document inside Vex, none on GitHub', () => {
    const app = readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    const html = readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
    const linked = [...html.matchAll(/data-legal-doc="([^"]+)"/g)].map(m => m[1]);
    expect(linked.sort()).toEqual(Object.values(VexLegal.DOCS).sort());
    expect(app).not.toMatch(/blob\/main\/' \+ doc/);
  });
});
