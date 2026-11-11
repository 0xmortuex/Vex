// @vitest-environment jsdom
//
// What the person sees of a passkey a site no longer accepts, and of the recent
// passkey requests (js/passkeys.js). Found 2026-11-10: Discord refused a passkey
// Vex had signed with and Vex said nothing.
import { describe, it, expect, vi } from 'vitest';

let vexApi, toasts;
async function load(api = {}) {
  vi.resetModules();
  document.body.innerHTML = '<div id="passkeys-panel-content"></div>';
  localStorage.clear();
  toasts = [];
  const listeners = {};
  vexApi = {
    passkeysAnswer: vi.fn(async () => ({ ok: true })),
    passkeysList: vi.fn(async () => vexApi._list || []),
    passkeysAttempts: vi.fn(async () => vexApi._attempts || []),
    passkeysRestore: vi.fn(async () => ({ ok: true })),
    passkeysConditionalChoose: vi.fn(async () => ({ ok: true })),
    onPasskeysAsk: (cb) => { listeners.ask = cb; },
    onPasskeysAskCancel: () => {},
    onPasskeysNotice: () => {},
    onSyncSecretsChanged: () => {},
    ...api,
  };
  window.vex = vexApi;
  window.showToast = (m, kind) => { toasts.push([m, kind]); };
  window.VexIcons = { svg: (n) => `<svg data-icon="${n}"></svg>` };
  window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.vexAlert = vi.fn(async () => {});
  window.SyncEngine = { syncTypes: () => [{ id: 'passkeys', on: false }], setTypeSynced: vi.fn() };
  await import('../../src/renderer/js/passkeys.js?' + Math.random());
  await new Promise(r => setTimeout(r, 0));
  return listeners;
}
const tick = () => new Promise(r => setTimeout(r, 0));
const held = (over = {}) => ({ credentialId: 'cred1', rpId: 'discord.com', rpName: 'Discord', userName: 'ada@example.com', userDisplayName: 'vesperhex', nickname: '',
  createdAt: '2026-10-16T19:28:00Z', lastUsedAt: '2026-11-10T16:05:58Z', deviceOnly: true, setAside: false, setAsideAt: null, ...over });
const ask = (over = {}) => ({ id: 'ask1', kind: 'get', host: 'discord.com', rpId: 'discord.com', uv: 'none', hasPin: false, accounts: [], unlisted: [], setAside: [], ...over });

describe('the sign-in sheet when Vex holds a passkey it does not offer', () => {
  it('says the site no longer accepts it', async () => {
    const l = await load();
    l.ask(ask({ setAside: [held({ setAside: true, setAsideAt: '2026-11-10T16:06:00Z' })] }));
    const text = document.querySelector('#vex-passkey-sheet .vex-dialog-msg').textContent;
    expect(text).toBe('discord.com no longer accepts the passkey Vex holds for it (vesperhex), so Vex does not offer it. Sign in another way, then add a new passkey in the site’s security settings.');
    expect(document.querySelector('#vex-passkey-sheet [data-pk="use"]')).toBeNull();
    expect(document.querySelector('#vex-passkey-sheet [data-pk="cancel"]')).toBeTruthy();
  });
  it('says the site did not ask for it, with the three reasons', async () => {
    const l = await load();
    l.ask(ask({ unlisted: [held({ nickname: 'Old <b>key</b>' })] }));
    const msg = document.querySelector('#vex-passkey-sheet .vex-dialog-msg');
    expect(msg.textContent).toBe('discord.com did not ask for the passkey Vex holds for it (Old <b>key</b>). It may have been removed from your account there, belong to another account, or its setup never finished. Sign in another way, then add a passkey again in the site’s security settings.');
    expect(msg.querySelector('b')).toBeNull();          // a name is text, never markup
  });
  it('keeps the plain "no passkey" wording when Vex holds none, and the chooser when it holds one', async () => {
    const l = await load();
    l.ask(ask());
    expect(document.querySelector('#vex-passkey-sheet .vex-dialog-msg').textContent).toMatch(/^You have no passkey for discord\.com on this device\./);
    l.ask(ask({ accounts: [held()], setAside: [held({ credentialId: 'cred2', setAside: true })] }));
    expect(document.querySelector('#vex-passkey-sheet .vex-dialog-msg').textContent).toMatch(/^Choose the passkey to sign in to discord\.com with\./);
  });
});

describe('the sign-in sheet when the site asks again right after a sign-in', () => {
  it('says the site is probably refusing the passkey and what to do, and still lets it be used', async () => {
    const l = await load();
    l.ask(ask({ accounts: [held()], repeat: { name: 'vesper<hex>', secondsAgo: 28 } }));
    const note = document.querySelector('#vex-passkey-sheet .pk-repeat');
    expect(note.textContent).toBe('Vex signed in here with “vesper<hex>” 28 seconds ago and the site is asking again. If the site showed an error, it is refusing this passkey: choose “Use a different method”, then add a new passkey in the site’s security settings.');
    expect(note.getAttribute('role')).toBe('alert');
    expect(note.querySelector('hex')).toBeNull();
    expect(document.querySelector('#vex-passkey-sheet [data-pk="use"]')).toBeTruthy();
  });
  it('says nothing on an ordinary sign-in', async () => {
    const l = await load();
    l.ask(ask({ accounts: [held()], repeat: null }));
    expect(document.querySelector('#vex-passkey-sheet .pk-repeat')).toBeNull();
  });
});

describe('Settings › Passkeys', () => {
  it('marks a passkey the site refused and offers it again on request', async () => {
    await load();
    vexApi._list = [held({ setAside: true, setAsideAt: '2026-11-10T16:06:00Z' }), held({ credentialId: 'cred2', rpId: 'github.com', userName: 'ada' })];
    await window.PasskeyUI.refresh();
    const rows = [...document.querySelectorAll('.pk-item')];
    expect(rows[0].querySelector('.pk-aside').textContent).toMatch(/^The site said on .+ that it no longer accepts this passkey, so Vex does not offer it\.$/);
    expect(rows[1].querySelector('.pk-aside')).toBeNull();
    expect(rows[1].querySelector('[data-act="restore"]')).toBeNull();
    vexApi._list = [held()];
    rows[0].querySelector('[data-act="restore"]').click();
    await tick(); await tick();
    expect(vexApi.passkeysRestore).toHaveBeenCalledWith('cred1');
    expect(document.querySelector('.pk-aside')).toBeNull();
    expect(toasts[0][0]).toMatch(/^Vex offers the passkey for ada@example\.com on discord\.com again\./);
  });
  it('says so when it could not be offered again', async () => {
    await load({ passkeysRestore: vi.fn(async () => ({ ok: false, error: 'That passkey is gone' })) });
    vexApi._list = [held({ setAside: true, setAsideAt: '2026-11-10T16:06:00Z' })];
    await window.PasskeyUI.refresh();
    document.querySelector('[data-act="restore"]').click();
    await tick(); await tick();
    expect(toasts).toEqual([['That passkey is gone', 'error']]);
  });
  it('the details say when a passkey is not offered', async () => {
    await load();
    vexApi._list = [held({ setAside: true, setAsideAt: '2026-11-10T16:06:00Z' })];
    await window.PasskeyUI.refresh();
    document.querySelector('[data-act="details"]').click();
    await tick();
    expect(window.vexAlert.mock.calls[0][0].message).toMatch(/\nNot offered: the site said on .+ that it no longer accepts it$/);
  });
});

describe('recent passkey requests', () => {
  const open = async () => { const d = document.querySelector('.pk-attempts'); d.open = true; d.dispatchEvent(new Event('toggle')); await tick(); await tick(); };
  it('is read only when opened, and says what each request came to', async () => {
    await load();
    expect(vexApi.passkeysAttempts).not.toHaveBeenCalled();
    vexApi._attempts = [
      { at: '2026-11-10T16:05:58Z', op: 'get', host: 'discord.com', rpId: 'discord.com', outcome: 'signed', detail: '', asked: 2, saved: 1, matched: 1, uv: true, credential: 'RP20zeO2', name: 'vesperhex', signCount: 22 },
      { at: '2026-11-10T16:05:30Z', op: 'get', host: 'discord.com', rpId: 'discord.com', outcome: 'signed', detail: '', asked: 0, saved: 1, matched: 1, uv: false, credential: 'RP20zeO2', name: 'vesperhex', signCount: 21 },
      { at: '2026-11-10T16:04:00Z', op: 'get', host: 'github.com', rpId: 'github.com', outcome: 'cancelled', detail: 'The request was cancelled', asked: 1, saved: 2, matched: 1 },
      { at: '2026-11-10T16:03:00Z', op: 'get', host: 'bank.example', rpId: 'bank.example', outcome: 'native', detail: 'The site asked for a security key or a phone' },
      { at: '2026-11-10T16:02:00Z', op: 'create', host: 'x.com', rpId: 'x.com', outcome: 'created', detail: '', name: 'ada', uv: false, credential: 'abcdefgh' },
      { at: '2026-11-10T16:01:00Z', op: 'get', host: 'shop.example', rpId: 'shop.example', outcome: 'refused', detail: 'Passkeys are turned off for this site in Vex' },
      { at: '2026-11-10T16:00:00Z', op: 'create', host: 'y.com', rpId: 'y.com', outcome: 'cancelled', detail: 'The passkey was not saved', name: 'ada' },
      { at: '2026-11-10T15:59:00Z', op: 'get', host: 'z.com', rpId: 'z.com', outcome: 'aborted', detail: 'The request was replaced by a newer one' },
    ];
    await open();
    const what = [...document.querySelectorAll('.pk-attempt')].map(r => r.querySelector('.pk-attempt-site').textContent + ' | ' + r.querySelector('.pk-attempt-what').textContent);
    expect(what).toEqual([
      'discord.com | Vex signed in with “vesperhex” · the site named 2 passkeys (1 in Vex) · PIN checked',
      'discord.com | Vex signed in with “vesperhex” · the site named no passkey',
      'github.com | You cancelled · the site named 1 passkey (1 in Vex)',
      'bank.example | Left to a security key or a phone · The site asked for a security key or a phone',
      'x.com | Passkey made for ada',
      'shop.example | Not answered: Passkeys are turned off for this site in Vex',
      'y.com | You did not save a passkey',
      'z.com | The page ended the request',
    ]);
    expect(document.querySelector('.pk-attempts-note').textContent).toMatch(/the site refused the passkey/);
  });
  it('says when there are none, and when Vex is locked', async () => {
    await load();
    await open();
    expect(document.querySelector('.pk-attempts-list').textContent).toBe('No site has asked for a passkey since Vex started.');
    expect(document.querySelector('.pk-attempts-note')).toBeNull();
    await load({ passkeysAttempts: vi.fn(async () => { throw new Error('Vex is locked'); }) });
    await open();
    expect(document.querySelector('.pk-attempts-list').textContent).toBe('Unlock Vex to see them.');
  });
  it('a site name is text, never markup', async () => {
    await load();
    vexApi._attempts = [{ at: '2026-11-10T16:05:58Z', op: 'get', host: '<img src=x onerror=1>', rpId: 'x', outcome: 'signed', detail: '', asked: 0, matched: 1, name: '<i>n</i>' }];
    await open();
    expect(document.querySelector('.pk-attempts-list img, .pk-attempts-list i')).toBeNull();
  });
});
