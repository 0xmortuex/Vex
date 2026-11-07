// @vitest-environment jsdom
//
// The window's half of the encrypted secrets file: it asks for the passphrase (twice for a new one), hands it to main for
// one call, shows only counts, and never keeps the passphrase anywhere.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/i18n-ui.js');
const { VexSecretsLifeboat } = require('../../src/renderer/js/secrets-lifeboat.js');

const PASS = 'ui test passphrase 4242';
let api, prompts, confirmAnswer, confirms;
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); };
const counts = { passwords: 2, authenticator: 1, cards: 0, cardsIncluded: false, passkeys: 3 };

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  prompts = []; confirms = []; confirmAnswer = true;
  const queue = [];
  window.__answers = queue;
  window.vexPrompt = vi.fn(async (o) => { prompts.push(o); return queue.length ? queue.shift() : null; });
  window.vexConfirm = vi.fn(async (o) => { confirms.push(o); return confirmAnswer; });
  globalThis.vexConfirm = window.vexConfirm;
  api = {
    exportSecrets: vi.fn(async () => ({ ok: true, counts, verified: true })),
    pick: vi.fn(async () => ({ ok: true, token: 'tok', name: 'x.vexsecrets' })),
    pickLast: vi.fn(async () => ({ ok: true, token: 'last', name: 'secrets-before-restore-1.vexsecrets' })),
    verify: vi.fn(async () => ({ ok: true, counts, createdAt: '2026-11-07T00:00:00.000Z', live: { passwords: 1, authenticator: 0, cards: null, passkeys: 3 } })),
    plan: vi.fn(async () => ({ ok: true, passwords: { add: 2, have: 0 }, authenticator: { add: 1, have: 0 }, cards: { add: 0, have: 0, included: false }, unreadable: [], passkeys: [{ rpId: 'a.test', userName: 'u' }] })),
    restore: vi.fn(async () => ({ ok: true, restored: { passwords: 2, authenticator: 1, cards: 0 }, kept: {}, before: { name: 'secrets-before-restore-20261107120000.vexsecrets' }, setAside: [], failed: [] })),
    live: vi.fn(),
  };
  window.vex = { lifeboat: api };
});
const click = (id) => document.querySelector(id).click();

describe('export', () => {
  it('asks twice, sends the passphrase for one call, defaults to no cards, and shows counts only', async () => {
    VexSecretsLifeboat.open();
    window.__answers.push(PASS, PASS);
    click('#lb-export');
    await flush();
    expect(prompts.map(p => p.password)).toEqual([true, true]);
    expect(api.exportSecrets).toHaveBeenCalledWith(PASS, false);
    expect(document.querySelector('#lb-msg').textContent).toMatch(/Saved and verified/);
    expect(document.querySelector('#lb-report').textContent).toMatch(/Saved logins2/);
    expect(document.querySelector('#lb-report').textContent).toMatch(/not included/);
    // the passphrase is nowhere on the page or in any storage
    expect(document.body.innerHTML).not.toContain(PASS);
    expect(JSON.stringify({ ...localStorage })).not.toContain(PASS);
  });
  it('sends nothing when the two passphrases differ or the first is short', async () => {
    VexSecretsLifeboat.open();
    window.__answers.push(PASS, PASS + 'x');
    click('#lb-export');
    await flush();
    expect(api.exportSecrets).not.toHaveBeenCalled();
    expect(document.querySelector('#lb-msg').textContent).toMatch(/not the same/);
    window.__answers.push('short');
    click('#lb-export');
    await flush();
    expect(api.exportSecrets).not.toHaveBeenCalled();
    expect(document.querySelector('#lb-msg').textContent).toMatch(/at least 10/);
  });
  it('the cards box is passed on only when ticked, and a failure is shown, not hidden', async () => {
    api.exportSecrets = vi.fn(async () => ({ ok: false, error: 'The export did not verify, so it was deleted (x). Nothing was kept.' }));
    VexSecretsLifeboat.open();
    document.querySelector('#lb-cards').checked = true;
    window.__answers.push(PASS, PASS);
    click('#lb-export');
    await flush();
    expect(api.exportSecrets).toHaveBeenCalledWith(PASS, true);
    expect(document.querySelector('#lb-msg').textContent).toMatch(/did not verify/);
  });
  it('a cancelled save dialog says nothing was saved', async () => {
    api.exportSecrets = vi.fn(async () => ({ ok: false, canceled: true }));
    VexSecretsLifeboat.open();
    window.__answers.push(PASS, PASS);
    click('#lb-export');
    await flush();
    expect(document.querySelector('#lb-msg').textContent).toBe('Nothing was saved');
  });
});

describe('check and restore', () => {
  it('check compares the file with what Vex has, and writes nothing', async () => {
    VexSecretsLifeboat.open();
    window.__answers.push(PASS);
    click('#lb-check');
    await flush();
    expect(api.verify).toHaveBeenCalledWith('tok', PASS);
    expect(api.restore).not.toHaveBeenCalled();
    expect(document.querySelector('#lb-msg').textContent).toMatch(/opens this file/);
  });
  it('restore shows the plan, asks, and does nothing when the answer is no', async () => {
    confirmAnswer = false;
    VexSecretsLifeboat.open();
    window.__answers.push(PASS);
    click('#lb-restore');
    await flush();
    expect(api.plan).toHaveBeenCalledWith('tok', PASS);
    expect(confirms[0]).toMatchObject({ title: 'Restore these secrets?', danger: true });
    expect(confirms[0].message).toMatch(/safety copy/);
    expect(api.restore).not.toHaveBeenCalled();
    expect(document.querySelector('#lb-msg').textContent).toBe('Nothing was changed');
  });
  it('restore with a yes passes the confirmation to main and names the safety copy', async () => {
    VexSecretsLifeboat.open();
    window.__answers.push(PASS);
    click('#lb-restore');
    await flush();
    expect(api.restore).toHaveBeenCalledWith('tok', PASS, true, false);
    expect(document.querySelector('#lb-report').textContent).toContain('secrets-before-restore-20261107120000.vexsecrets');
    expect(document.querySelector('#lb-msg').textContent).toBe('Restored.');
  });
  it('a wrong passphrase is shown as the error main gave, and nothing is restored', async () => {
    api.plan = vi.fn(async () => ({ ok: false, error: 'Wrong passphrase, or the file was changed' }));
    VexSecretsLifeboat.open();
    window.__answers.push('not the one at all 1');
    click('#lb-restore');
    await flush();
    expect(document.querySelector('#lb-msg').textContent).toBe('Wrong passphrase, or the file was changed');
    expect(api.restore).not.toHaveBeenCalled();
  });
  it('"go back" uses the newest safety copy and asks main to make the stores exactly that', async () => {
    VexSecretsLifeboat.open();
    window.__answers.push(PASS);
    click('#lb-undo');
    await flush();
    expect(api.pickLast).toHaveBeenCalled();
    expect(api.restore).toHaveBeenCalledWith('last', PASS, true, true);
  });
  it('a window without the bridge disables the buttons instead of failing silently', () => {
    delete window.vex;
    VexSecretsLifeboat.open();
    expect(document.querySelector('#lb-msg').textContent).toMatch(/cannot reach/);
    expect(document.querySelector('#lb-export').disabled).toBe(true);
  });
});
