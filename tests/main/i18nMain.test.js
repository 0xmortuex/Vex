// The language the main process speaks (src/main/i18n-main.js): native dialog text in Turkish when Vex is in Turkish, English otherwise.
import { describe, it, expect, vi } from 'vitest';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { create, translate, localizeOptions, TR } = require('../../src/main/i18n-main.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vex-lang-'));

describe('translate', () => {
  it('is the text as it is in English', () => {
    expect(translate('Reload window', 'en')).toBe('Reload window');
  });
  it('is Turkish in Turkish, and carries a value across', () => {
    expect(translate('Reload window', 'tr')).toBe('Pencereyi yeniden yükle');
    expect(translate('Vex will listen to YOUR microphone for Zoom and turn your voice into text.', 'tr')).toBe('Vex, Zoom için SİZİN mikrofonunuzu dinleyecek ve sesinizi metne çevirecek.');
  });
  it('shows a text it does not know as it was written', () => {
    expect(translate('Something new', 'tr')).toBe('Something new');
    expect(translate(undefined, 'tr')).toBeUndefined();
  });
  it('every Turkish text keeps the same holes as its English', () => {
    for (const [en, tr] of Object.entries(TR)) expect((en.match(/\{\d\}/g) || []).sort().join()).toBe((tr.match(/\{\d\}/g) || []).sort().join());
  });
});

describe('localizeOptions', () => {
  it('translates a dialog\'s title, message, buttons and filter names, and leaves the rest', () => {
    const o = { title: 'Save', message: 'Vex stopped responding', buttons: ['Reload window', 'Wait'], defaultId: 0, filters: [{ name: 'Pictures', extensions: ['png'] }], properties: ['openFile'] };
    expect(localizeOptions(o, 'tr')).toEqual({ title: 'Kaydet', message: 'Vex yanıt vermeyi bıraktı', buttons: ['Pencereyi yeniden yükle', 'Bekle'], defaultId: 0, filters: [{ name: 'Resimler', extensions: ['png'] }], properties: ['openFile'] });
    expect(localizeOptions(o, 'en')).toBe(o);
  });
  it('lets anything that is not an options object through', () => {
    expect(localizeOptions(null, 'tr')).toBeNull();
    const win = { id: 1 };
    expect(localizeOptions(win, 'tr')).toEqual({ id: 1 });
  });
});

describe('the saved language', () => {
  it('is English until told, then Turkish, and survives a restart', () => {
    const dir = tmp();
    const a = create({ fs, dir });
    expect(a.language()).toBe('en');
    expect(a.t('Wait')).toBe('Wait');
    a.setLanguage('tr');
    expect(a.t('Wait')).toBe('Bekle');
    expect(create({ fs, dir }).language()).toBe('tr');
    a.setLanguage('en');
    expect(create({ fs, dir }).language()).toBe('en');
  });
  it('takes anything but tr as English', () => {
    const a = create({ fs, dir: tmp() });
    a.setLanguage('tr');
    a.setLanguage('de');
    expect(a.language()).toBe('en');
  });
  it('says so, and stays English, when the saved file cannot be read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { readFileSync() { const e = new Error('disk'); e.code = 'EIO'; throw e; }, writeFileSync() {} };
    expect(create({ fs: bad, dir: tmp() }).language()).toBe('en');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('install', () => {
  it('wraps the dialog functions once, so the text shown is translated', () => {
    const shown = [];
    const dialog = { showMessageBox: (o) => { shown.push(o); return Promise.resolve({ response: 0 }); }, showErrorBox: (t, c) => shown.push([t, c]) };
    const lang = create({ fs, dir: tmp() });
    lang.install(dialog);
    lang.install(dialog);   // a second install changes nothing
    lang.setLanguage('tr');
    dialog.showMessageBox({ title: 'Save', buttons: ['Wait'] });
    dialog.showErrorBox('Vex cannot open this profile', 'details');
    expect(shown[0]).toEqual({ title: 'Kaydet', buttons: ['Bekle'] });
    expect(shown[1]).toEqual(['Vex bu profili açamıyor', 'details']);
    lang.setLanguage('en');
    dialog.showMessageBox({ title: 'Save' });
    expect(shown[2]).toEqual({ title: 'Save' });
  });
});
