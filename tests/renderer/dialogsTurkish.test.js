// js/dialogs-tr.js: the Turkish for the questions and prompts of Vex's features. It joins the shared Turkish table as it loads.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const holes = (s) => [...new Set(s.match(/\{\d?\}/g) || [])].sort();

describe('dialogs-tr.js', () => {
  const shared = { ...VexI18nUI.TABLE.tr };
  const { VexDialogsTr } = require('../../src/renderer/js/dialogs-tr.js');

  it('repeats no key of the shared Turkish table', () => {
    const dup = Object.keys(VexDialogsTr).filter(k => Object.prototype.hasOwnProperty.call(shared, k));
    expect(dup).toEqual([]);
  });

  it('never invents a hole the English does not have, and gives every entry a Turkish text', () => {
    for (const [en, tr] of Object.entries(VexDialogsTr)) {
      expect(typeof tr === 'string' && tr.length > 0, en).toBe(true);
      const he = holes(en);
      expect(holes(tr).every(h => he.includes(h)), en).toBe(true);
    }
  });

  it('joins the table when it loads (a question and a template with a value)', () => {
    VexI18nUI.TABLE.tr = Object.assign(VexI18nUI.TABLE.tr, VexDialogsTr);
    VexI18nUI.resetTemplates();
    expect(VexI18nUI.lookup('Remove this recipe?', 'tr')).toBe('Bu tarif kaldırılsın mı?');
    expect(VexI18nUI.lookup('Delete the profile "Qwerty"?', 'tr')).toBe('“Qwerty” profili silinsin mi?');
  });
});
