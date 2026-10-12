// @vitest-environment jsdom
//
// The question a page's automatic downloads get: just Allow or Block, kept for
// the site — or in a private window or Tor tab, kept only by the tab.
import { describe, it, expect, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/permission-prompts.js');

let answers;
beforeEach(() => {
  document.body.innerHTML = '';
  answers = [];
  window.vex = { permissionRespond: async (p) => { answers.push(p); return { ok: true }; } };
  window.showToast = () => {};
  window.PermissionPrompts._queue.length = 0;
});

const buttons = () => [...document.querySelectorAll('.permission-prompt [data-decision]')].map(b => [b.textContent, b.dataset.decision, b.dataset.remember]);

describe('the automatic downloads question', () => {
  it('offers Allow and Block, both kept for the site', async () => {
    window.PermissionPrompts.showPrompt({ id: 'p1', origin: 'https://files.example', permission: 'automatic-downloads', choice: 'allow-block', remember: true });
    expect(document.querySelector('.perm-message').textContent).toContain('download several files');
    expect(buttons()).toEqual([['Block', 'deny', 'true'], ['Allow', 'allow', 'true']]);
    document.querySelector('[data-decision="allow"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(answers[0]).toMatchObject({ id: 'p1', decision: 'allow', remember: true });
  });

  // Found in the v19.1.7 check: the first download opens the Downloads drop
  // by itself, and it sat right over the question's Allow button (and its
  // click-catching layer over Block), so only Block could be seen.
  it('closes the Downloads drop that would cover it', () => {
    let closed = 0;
    window.DownloadsButton = { _open: document.createElement('div'), close() { closed++; this._open = null; } };
    window.PermissionPrompts.showPrompt({ id: 'p3', origin: 'https://files.example', permission: 'automatic-downloads', choice: 'allow-block', remember: true });
    expect(closed).toBe(1);
    delete window.DownloadsButton;
  });

  it('in a private window or Tor tab keeps nothing', () => {
    window.PermissionPrompts.showPrompt({ id: 'p2', origin: 'https://files.example', permission: 'automatic-downloads', choice: 'allow-block', remember: false });
    expect(buttons()).toEqual([['Block', 'deny', 'false'], ['Allow', 'allow', 'false']]);
  });
});
