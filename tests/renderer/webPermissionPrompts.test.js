// @vitest-environment jsdom
//
// The question for the requests Vex used to refuse without asking (keyboardLock): English and Turkish copy, the buttons, and that a private window offers
// only "this time". Pure DOM, no Electron.
import { describe, it, expect, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
require('../../src/renderer/js/permission-prompts.js');

let answers;
beforeEach(() => {
  document.body.innerHTML = '';
  answers = [];
  window.vex = { permissionRespond: async (p) => { answers.push(p); return { ok: true }; } };
  window.showToast = () => {};
  window.PermissionPrompts._queue.length = 0;
  delete window.vexTr;
});

const buttons = () => [...document.querySelectorAll('.permission-prompt [data-decision]')].map(b => [b.textContent, b.dataset.decision, b.dataset.remember]);
const message = () => document.querySelector('.perm-message').textContent.replace(/\s+/g, ' ').trim();
const turkish = () => { window.vexTr = (text) => { const hit = VexI18nUI.lookup(text, 'tr'); return hit == null ? text : hit; }; };

const REQUESTS = [
  { permission: 'keyboardLock', origin: 'https://game.example', en: 'wants to take over some keyboard keys (like Esc) while this page is full screen', trWord: 'klavye tuşlarını' },
];

describe.each(REQUESTS)('the question for $permission', (req) => {
  const show = () => window.PermissionPrompts.showPrompt({ id: 'p1', origin: req.origin, permission: req.permission, ...(req.embeddedIn ? { embeddedIn: req.embeddedIn, crossSite: req.crossSite } : {}) });

  it('says in plain English what is asked and who asks', () => {
    show();
    expect(document.querySelector('.perm-origin').textContent).toBe(req.origin);
    expect(message()).toContain(req.en);
  });

  it('is in Turkish when the language is Turkish, with no English sentence left', () => {
    turkish();
    show();
    expect(message()).toContain(req.trWord);
    expect(message()).not.toContain(req.en);
  });

  it('offers the same choices as the camera: block for good, this visit, a day, always', () => {
    show();
    expect(buttons()).toEqual([
      ['Block', 'deny', 'true'],
      ['Allow this visit', 'allow', 'session'],
      ['Allow for a day', 'allow', 'day'],
      ['Always allow', 'allow', 'true'],
    ]);
  });

  it('a private window, a Tor tab or a burner offers only this time, and keeps nothing', async () => {
    window.PermissionPrompts.showPrompt({ id: 'p2', origin: req.origin, permission: req.permission, choice: 'this-time', remember: false, ...(req.embeddedIn ? { embeddedIn: req.embeddedIn } : {}) });
    expect(buttons()).toEqual([['Block this time', 'deny', 'false'], ['Allow this time', 'allow', 'false']]);
    document.querySelector('[data-decision="allow"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(answers[0]).toMatchObject({ id: 'p2', decision: 'allow', remember: false });
  });

  it('the private window buttons are in Turkish too', () => {
    turkish();
    window.PermissionPrompts.showPrompt({ id: 'p3', origin: req.origin, permission: req.permission, choice: 'this-time', remember: false });
    expect(buttons()).toEqual([['Bu seferlik engelle', 'deny', 'false'], ['Bu seferlik izin ver', 'allow', 'false']]);
  });

  it('is never worded as "use: <internal name>"', () => {
    show();
    expect(message()).not.toMatch(/use: /);
  });
});

describe('the older questions are unchanged', () => {
  it('the camera question still reads and offers what it did', () => {
    window.PermissionPrompts.showPrompt({ id: 'c', origin: 'https://meet.example', permission: 'camera' });
    expect(message()).toBe('wants to use your camera');
    expect(buttons().map(b => b[0])).toEqual(['Block', 'Allow this visit', 'Allow for a day', 'Always allow']);
  });
  it('an automatic-downloads question is still just Allow and Block', () => {
    window.PermissionPrompts.showPrompt({ id: 'd', origin: 'https://files.example', permission: 'automatic-downloads', choice: 'allow-block', remember: true });
    expect(buttons()).toEqual([['Block', 'deny', 'true'], ['Allow', 'allow', 'true']]);
  });
});
