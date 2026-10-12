// @vitest-environment jsdom
// Form Fill's bare "name" rule took "Company name", "User name" and "Nickname"
// fields for the person's full name.
import { it, expect, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/form-fill.js');

it('fills the person\'s name, never a company, user or nick name', async () => {
  let js = '';
  const wv = { executeJavaScript: vi.fn(async (code) => { js = code; return 0; }) };
  globalThis.WebviewManager = { getActiveWebview: () => wv };
  document.body.innerHTML = `
    <label for="c">Company name</label><input id="c" name="name">
    <input name="org" aria-label="Organization name">
    <input name="user name">
    <input placeholder="Nickname">
    <label for="n">Name</label><input id="n" name="name2">
    <input autocomplete="email" name="company email">`;
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 });
  window.FormFill.fill({ fullName: 'Ada Lovelace', email: 'ada@example.com' });
  await Promise.resolve();
  const n = window.eval(js);
  const v = (sel) => document.querySelector(sel).value;
  expect(v('#c')).toBe('');
  expect(v('[name=org]')).toBe('');
  expect(v('[name="user name"]')).toBe('');
  expect(v('[placeholder=Nickname]')).toBe('');
  expect(v('#n')).toBe('Ada Lovelace');
  expect(v('[autocomplete=email]')).toBe('ada@example.com');
  expect(n).toBe(2);
  rect.mockRestore();
  delete globalThis.WebviewManager;
});
