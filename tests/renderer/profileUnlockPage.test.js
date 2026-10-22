// @vitest-environment jsdom
// The unlock window's own page (renderer/profile-unlock.js): English as written, Turkish when the main process asks (?lang=tr).
import { describe, it, expect, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/profile-unlock.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../../src/renderer/profile-unlock.js'), 'utf8');

function open(query) {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  window.history.pushState({}, '', '/profile-unlock.html' + query);
  window.vexUnlock = { quit() {}, unlock: async () => ({ ok: false, error: 'Yanlış parola' }) };
  // eslint-disable-next-line no-new-func
  new Function(script)();
}
const text = (id) => document.getElementById(id).textContent;

describe('the unlock page', () => {
  beforeEach(() => { document.documentElement.lang = 'en'; });

  it('is English by default', () => {
    open('');
    expect(text('h1')).toBe('Unlock Vex');
    expect(text('go')).toBe('Unlock');
    expect(text('label')).toBe('Passphrase');
    expect(text('switch')).toBe('Use the recovery code instead');
  });

  it('is Turkish when asked, in both ways of unlocking', () => {
    open('?lang=tr');
    expect(document.documentElement.lang).toBe('tr');
    expect(document.title).toBe('Vex’in kilidini aç');
    expect(text('h1')).toBe('Vex’in kilidini aç');
    expect(text('go')).toBe('Kilidi aç');
    expect(text('quit')).toBe('Çık');
    expect(text('label')).toBe('Parola');
    expect(text('intro')).toBe('Profiliniz şifreli. Açmak için parolanızı yazın.');
    document.getElementById('switch').click();
    expect(text('label')).toBe('Kurtarma kodu');
    expect(text('switch')).toBe('Bunun yerine parolayı kullan');
    expect(text('intro')).toMatch(/^Profili şifrelerken/);
  });

  it('shows the answer the main process gives, already in the language', async () => {
    open('?lang=tr');
    document.getElementById('secret').value = 'x';
    document.getElementById('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(text('msg')).toBe('Yanlış parola');
  });
});
