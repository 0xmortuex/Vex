// @vitest-environment jsdom
// The small windows Vex opens (quick capture, the pop-out toolbar, the floating video) speak Turkish when Vex does.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; document.documentElement.lang = 'en'; });

describe('quick capture', () => {
  const page = read('renderer/capture.html');
  function open() {
    const doc = new DOMParser().parseFromString(page, 'text/html');
    document.body.innerHTML = doc.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '');
    window.vexCapture = { close: vi.fn(), submit: vi.fn(async () => ({ said: undefined })) };
    // eslint-disable-next-line no-new-func
    new Function(doc.querySelector('script').textContent)();
  }
  it('is English as written', () => {
    open();
    expect(document.getElementById('q').placeholder).toMatch(/^A note/);
    expect(document.querySelector('.hint').textContent).toMatch(/saves a note/);
  });
  it('is Turkish when Vex is, and still explains the Turkish reminder', async () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    open();
    expect(document.documentElement.lang).toBe('tr');
    expect(document.querySelector('.title').textContent).toBe('Vex — hızlı not');
    expect(document.getElementById('q').placeholder).toContain('hatırlat');
    expect(document.querySelector('.hint').textContent).toContain('not kaydeder');
    const input = document.getElementById('q');
    input.value = 'süt al';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.getElementById('said').textContent).toBe('Kaydediliyor…');
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('said').textContent).toBe('Kaydedildi');
  });
});

describe('the pop-out toolbar', () => {
  const script = read('renderer/js/popup-chrome.js');
  const html = read('renderer/popup-chrome.html');
  function open() {
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '');
    window.popupChrome = { onUrl() {}, action() {}, onPalette() {} };
    // eslint-disable-next-line no-new-func
    new Function(script)();
  }
  it('is English as written', () => {
    open();
    expect(document.querySelector('[data-act="close"]').title).toBe('Close (Esc)');
  });
  it('is Turkish when Vex is', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    open();
    expect(document.querySelector('[data-act="back"]').title).toBe('Geri');
    expect(document.querySelector('[data-act="close"]').title).toBe('Kapat (Esc)');
    expect(document.querySelector('[data-act="open-as-tab"] span').textContent).toBe('Sekme olarak aç');
  });
});

describe('the floating video window', () => {
  const source = read('preload-pip.js');
  it('has Turkish for every text it shows', () => {
    const table = source.slice(source.indexOf('const TR = {'), source.indexOf('};', source.indexOf('const TR = {')));
    const keys = [...source.matchAll(/\bt\('((?:[^'\\]|\\.)+)'\)/g)].map(m => m[1].replace(/\\'/g, "'"));
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const k of keys) expect(table, k).toContain(k.replace(/'/g, "\\'"));
  });
  it('takes the language from main, not from the page it shows', () => {
    expect(source).toContain("process.argv.includes('--vex-lang=tr')");
    expect(read('pip.js')).toContain('additionalArguments: [languageArgument()]');
  });
});
