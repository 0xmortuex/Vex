// @vitest-environment jsdom
// The Authenticator panel: an account can be renamed (imports often arrive as
// just "Account"), and a long list can be searched.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/authenticator.js');
const A = () => window.Authenticator;
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

const account = (id, issuer, label) => ({ id, issuer, label, digits: 6, period: 30 });
let el; let accounts;

async function mount(list) {
  accounts = list;
  document.body.innerHTML = '<div id="p"></div>';
  el = document.getElementById('p');
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.vex = {
    totpList: vi.fn(async () => accounts), totpCodes: vi.fn(async () => []),
    totpRename: vi.fn(async () => ({ ok: true })),
  };
  vi.spyOn(A(), '_startTicking').mockImplementation(() => {});
  await A().renderPanel(el);
  await A()._refreshList();
}

describe('rename', () => {
  beforeEach(() => mount([account('a1', '', 'Account'), account('a2', 'GitHub', 'me@x.test')]));

  it('asks for the service and the account, then renames through main', async () => {
    const answers = ['Work GitHub', 'me@work.test'];
    window.vexPrompt = vi.fn(async () => answers.shift());
    el.querySelector('.auth-item[data-id="a1"] .auth-ren').click();
    await tick();
    expect(window.vexPrompt).toHaveBeenCalledTimes(2);
    expect(window.vex.totpRename).toHaveBeenCalledWith('a1', 'Work GitHub', 'me@work.test');
  });

  it('cancelling either question changes nothing', async () => {
    window.vexPrompt = vi.fn(async () => null);
    el.querySelector('.auth-item[data-id="a2"] .auth-ren').click();
    await tick();
    expect(window.vex.totpRename).not.toHaveBeenCalled();
  });

  it('clicking the pencil does not copy the code', async () => {
    window.vexPrompt = vi.fn(async () => null);
    window.vexCopySecret = vi.fn(async () => {});
    A()._codes = { a1: { code: '123456' } };
    el.querySelector('.auth-item[data-id="a1"] .auth-ren').click();
    await tick();
    expect(window.vexCopySecret).not.toHaveBeenCalled();
  });

  it('says so when main refuses', async () => {
    const answers = ['X', ''];
    window.vexPrompt = vi.fn(async () => answers.shift());
    window.vex.totpRename = vi.fn(async () => ({ ok: false, error: 'Give it a name' }));
    el.querySelector('.auth-item[data-id="a1"] .auth-ren').click();
    await tick();
    expect(window.showToast).toHaveBeenCalledWith('Could not rename it: Give it a name', 'error');
  });
});

describe('search', () => {
  const many = ['GitHub', 'GitLab', 'Google', 'Discord', 'Dropbox', 'Amazon', 'Steam'].map((n, i) => account('id' + i, n, 'me@x.test'));

  it('is hidden for a short list and shown for a long one', async () => {
    await mount(many.slice(0, 3));
    expect(el.querySelector('#auth-search').style.display).toBe('none');
    await mount(many);
    expect(el.querySelector('#auth-search').style.display).toBe('');
  });

  it('keeps only the rows that hold every word, and says when none do', async () => {
    await mount(many);
    const box = el.querySelector('#auth-search');
    const visible = () => [...el.querySelectorAll('.auth-item')].filter(r => r.style.display !== 'none').map(r => r.dataset.id);
    box.value = 'git';
    box.dispatchEvent(new Event('input'));
    expect(visible()).toEqual(['id0', 'id1']);
    box.value = 'git lab';
    box.dispatchEvent(new Event('input'));
    expect(visible()).toEqual(['id1']);
    box.value = 'nothing like it';
    box.dispatchEvent(new Event('input'));
    expect(visible()).toEqual([]);
    expect(el.querySelector('#auth-nomatch')).not.toBeNull();
    box.value = '';
    box.dispatchEvent(new Event('input'));
    expect(visible()).toHaveLength(7);
    expect(el.querySelector('#auth-nomatch')).toBeNull();
  });
});
