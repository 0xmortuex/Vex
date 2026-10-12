// @vitest-environment jsdom
//
// Vex's passkey sheet, field chooser and Settings list (js/passkeys.js).
// The main process decides everything; this is what the person sees and the
// answers they send back.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let answers, toasts, vexApi, undoOffers;

async function load() {
  vi.resetModules();
  document.body.innerHTML = '<div id="passkeys-panel-content"></div><input id="setting-passkey-hosts"><input id="lock-pin-new">';
  localStorage.clear();
  answers = [];
  toasts = [];
  undoOffers = [];
  let listeners = {};
  vexApi = {
    passkeysAnswer: vi.fn(async (id, a) => { answers.push([id, a]); return vexApi._next || { ok: true }; }),
    passkeysList: vi.fn(async () => vexApi._list || []),
    passkeysDelete: vi.fn(async () => ({ ok: true, undo: 'tok' })),
    passkeysUndoDelete: vi.fn(async () => ({ ok: true })),
    passkeysRename: vi.fn(async () => ({ ok: true })),
    passkeysConditionalChoose: vi.fn(async () => ({ ok: true })),
    onPasskeysAsk: (cb) => { listeners.ask = cb; },
    onPasskeysAskCancel: (cb) => { listeners.cancel = cb; },
    onPasskeysNotice: (cb) => { listeners.notice = cb; },
    onSyncSecretsChanged: () => {},
  };
  window.vex = vexApi;
  window.showToast = (m, kind) => { toasts.push([m, kind]); };
  window.VexUndo = { offer: (o) => { undoOffers.push(o); } };
  window.VexIcons = { svg: (n) => `<svg data-icon="${n}"></svg>` };
  window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.vexPrompt = vi.fn(async () => 'Renamed');
  window.vexAlert = vi.fn(async () => {});
  window.SettingsUI = { openSection: vi.fn() };
  window.SyncEngine = { syncTypes: () => [{ id: 'passkeys', on: false }], setTypeSynced: vi.fn(async () => ({ ok: true })) };
  await import('../../src/renderer/js/passkeys.js?' + Math.random());
  await new Promise(r => setTimeout(r, 0));
  return listeners;
}

const getPayload = (over = {}) => ({
  id: 'ask1', kind: 'get', host: 'login.example.com', rpId: 'example.com', uv: 'none', hasPin: false,
  accounts: [{ credentialId: 'cred1', userName: 'ada@example.com', userDisplayName: 'Ada', nickname: '', createdAt: '2026-01-02T00:00:00Z', lastUsedAt: null, deviceOnly: true }],
  ...over,
});
const createPayload = (over = {}) => ({
  id: 'ask2', kind: 'create', host: 'login.example.com', rpId: 'example.com', rpName: 'Example', userName: 'ada', userDisplayName: 'Ada',
  existing: [], replaces: null, uv: 'none', hasPin: false, syncOn: false, ...over,
});
const click = (sel) => document.querySelector(sel).click();
const sheet = () => document.getElementById('vex-passkey-sheet');

beforeEach(async () => { document.body.innerHTML = ''; });

describe('the sign-in sheet', () => {
  it('lists the passkeys, escaped, and sends the chosen one', async () => {
    const l = await load();
    l.ask(getPayload({ accounts: [
      { credentialId: 'c1', userName: '<img src=x onerror=alert(1)>', userDisplayName: 'Ada', nickname: 'Work <b>laptop</b>', createdAt: '2026-01-02T00:00:00Z' },
      { credentialId: 'c2', userName: 'bob', userDisplayName: 'Bob', nickname: '', createdAt: '2026-01-02T00:00:00Z' }] }));
    expect(sheet()).toBeTruthy();
    expect(sheet().querySelector('img')).toBeNull();
    expect(sheet().querySelector('b')).toBeNull();
    expect(sheet().textContent).toContain('Work <b>laptop</b>');
    expect(sheet().querySelectorAll('input[name="pk-account"]')).toHaveLength(2);
    sheet().querySelectorAll('input[name="pk-account"]')[1].checked = true;
    click('[data-pk="use"]');
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    expect(answers[0]).toEqual(['ask1', { action: 'use', credentialId: 'c2', pin: undefined }]);
    await vi.waitFor(() => expect(sheet()).toBeNull());
  });

  it('asks for the PIN when verification is wanted, and keeps the sheet open on a wrong one', async () => {
    const l = await load();
    l.ask(getPayload({ uv: 'required', hasPin: true }));
    expect(document.getElementById('pk-pin')).toBeTruthy();
    document.getElementById('pk-pin').value = '1111';
    vexApi._next = { ok: false, error: 'Wrong PIN' };
    click('[data-pk="use"]');
    await vi.waitFor(() => expect(document.getElementById('pk-error').textContent).toBe('Wrong PIN'));
    expect(sheet()).toBeTruthy();
    expect(answers[0][1]).toEqual({ action: 'use', credentialId: 'cred1', pin: '1111' });
    expect(document.querySelector('[data-pk="use"]').disabled).toBe(false);
  });

  it('cannot proceed when verification is required and there is no PIN, and says where to set one', async () => {
    const l = await load();
    l.ask(getPayload({ uv: 'required', hasPin: false }));
    expect(sheet().textContent).toMatch(/Set a Vex PIN/);
    expect(document.querySelector('[data-pk="use"]').disabled).toBe(true);
    click('[data-pk-settings]');
    expect(window.SettingsUI.openSection).toHaveBeenCalledWith('lock-pin-new');
    await vi.waitFor(() => expect(answers).toEqual([['ask1', { action: 'cancel' }]]));
  });

  it('"Use a different method" and Escape both cancel; a security key is its own answer', async () => {
    let l = await load();
    l.ask(getPayload());
    click('[data-pk="cancel"]');
    await vi.waitFor(() => expect(answers).toEqual([['ask1', { action: 'cancel' }]]));
    expect(sheet()).toBeNull();
    l = await load();
    l.ask(getPayload());
    sheet().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(answers).toEqual([['ask1', { action: 'cancel' }]]));
    l = await load();
    l.ask(getPayload({ accounts: [] }));
    expect(sheet().textContent).toMatch(/no passkey for/);
    expect(document.querySelector('[data-pk="use"]')).toBeNull();
    click('[data-pk="native"]');
    await vi.waitFor(() => expect(answers).toEqual([['ask1', { action: 'native' }]]));
  });

  it('closes when main withdraws the request', async () => {
    const l = await load();
    l.ask(getPayload());
    l.cancel({ id: 'other' });
    expect(sheet()).toBeTruthy();
    l.cancel({ id: 'ask1' });
    expect(sheet()).toBeNull();
  });

  it('does not show for a page that is not in front: it is answered as cancelled', async () => {
    const l = await load();
    const wv = document.createElement('webview');
    wv.getWebContentsId = () => 7;
    wv.getClientRects = () => [];
    document.body.appendChild(wv);
    l.ask(getPayload({ wcId: 7 }));
    expect(sheet()).toBeNull();
    await vi.waitFor(() => expect(answers).toEqual([['ask1', { action: 'cancel' }]]));
    l.ask(getPayload({ id: 'ask9', wcId: 99 }));          // no such page
    expect(sheet()).toBeNull();
  });
});

describe('the save sheet', () => {
  it('names the site and account, sends the name and PIN', async () => {
    const l = await load();
    l.ask(createPayload({ uv: 'optional', hasPin: true, syncOn: true }));
    expect(sheet().textContent).toMatch(/Save a passkey for Example\?/);
    expect(sheet().textContent).toMatch(/ada/);
    expect(sheet().textContent).toMatch(/syncs end-to-end encrypted through Vex Sync/);
    document.getElementById('pk-name').value = 'My phone';
    document.getElementById('pk-pin').value = '2468';
    click('[data-pk="save"]');
    await vi.waitFor(() => expect(answers[0][1]).toEqual({ action: 'save', nickname: 'My phone', pin: '2468' }));
  });
  it('says when it replaces a passkey and lists the others', async () => {
    const l = await load();
    l.ask(createPayload({ replaces: { credentialId: 'a', createdAt: '2026-01-02T00:00:00Z', userName: 'ada' },
      existing: [{ credentialId: 'a', userName: 'ada', createdAt: '2026-01-02T00:00:00Z' }, { credentialId: 'b', userName: 'bob', nickname: 'Bob key', createdAt: '2026-01-02T00:00:00Z' }] }));
    expect(sheet().textContent).toMatch(/replaces the passkey/);
    expect(sheet().textContent).toMatch(/Bob key/);
  });
  it('"Never for this site" adds the host to the do-not-offer list and keeps "*" as it is', async () => {
    let l = await load();
    l.ask(createPayload());
    click('[data-pk="never"]');
    await vi.waitFor(() => expect(answers[0][1]).toEqual({ action: 'never' }));
    expect(JSON.parse(localStorage.getItem('vex.passkeySuppressedHosts'))).toEqual(['login.example.com']);
    expect(document.getElementById('setting-passkey-hosts').value).toBe('login.example.com');
    l = await load();
    localStorage.setItem('vex.passkeySuppressedHosts', JSON.stringify(['*']));
    window.PasskeyUI.neverOffer('login.example.com');
    expect(JSON.parse(localStorage.getItem('vex.passkeySuppressedHosts'))).toEqual(['*']);
  });
  it('an existing-passkey notice has only OK', async () => {
    const l = await load();
    l.ask({ id: 'ask3', kind: 'exists', host: 'login.example.com', rpId: 'example.com', rpName: 'Example', userName: 'ada' });
    expect(sheet().textContent).toMatch(/already have a passkey/);
    click('[data-pk="ok"]');
    await vi.waitFor(() => expect(answers[0]).toEqual(['ask3', { action: 'ok' }]));
  });
});

describe('notices and Settings', () => {
  it('shows main\'s notices as toasts', async () => {
    const l = await load();
    l.notice({ message: 'Passkeys are not used in private windows.', kind: 'warning' });
    expect(toasts).toEqual([['Passkeys are not used in private windows.', 'warning']]);
  });

  it('lists passkeys by site, deletes with an Undo that puts it back, and renames', async () => {
    await load();
    vexApi._list = [
      { credentialId: 'c1', rpId: 'example.com', rpName: 'Example', userName: '<b>ada</b>', userDisplayName: 'Ada', nickname: '', createdAt: '2026-01-02T00:00:00Z', lastUsedAt: null, deviceOnly: true },
      { credentialId: 'c2', rpId: 'example.com', rpName: 'Example', userName: 'bob', userDisplayName: 'Bob', nickname: 'Bob key', createdAt: '2026-01-02T00:00:00Z', lastUsedAt: '2026-02-01T00:00:00Z', deviceOnly: false },
    ];
    await window.PasskeyUI.refresh();
    const box = document.getElementById('passkeys-panel-content');
    expect(box.querySelectorAll('.pk-site')).toHaveLength(1);
    expect(box.querySelectorAll('.pk-item')).toHaveLength(2);
    expect(box.querySelector('.pk-item b')).toBeNull();
    expect(box.textContent).toMatch(/this device only/);
    expect(box.textContent).toMatch(/synced/);
    // There is no way to ask for a key here.
    expect([...box.querySelectorAll('button')].map(b => b.textContent).join(' ')).not.toMatch(/export|copy|show/i);
    box.querySelector('[data-id="c2"] [data-act="delete"]').click();
    await vi.waitFor(() => expect(undoOffers).toHaveLength(1));
    expect(vexApi.passkeysDelete).toHaveBeenCalledWith('c2');
    await undoOffers[0].undo();
    expect(vexApi.passkeysUndoDelete).toHaveBeenCalledWith('tok');
    box.querySelector('[data-id="c1"] [data-act="rename"]').click();
    await vi.waitFor(() => expect(vexApi.passkeysRename).toHaveBeenCalledWith('c1', 'Renamed'));
  });

  it('the sync switch turns the "passkeys" kind of Vex Sync on and back off on a refusal', async () => {
    await load();
    const sw = document.getElementById('setting-passkey-sync');
    await vi.waitFor(() => expect(sw.disabled).toBe(false));
    expect(sw.checked).toBe(false);
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(window.SyncEngine.setTypeSynced).toHaveBeenCalledWith('passkeys', true));
    window.SyncEngine.setTypeSynced.mockResolvedValueOnce({ ok: false, canceled: true });
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sw.checked).toBe(true));
  });

  it('shows the chooser under a field and sends the pick', async () => {
    await load();
    const wv = document.createElement('webview');
    wv.getBoundingClientRect = () => ({ left: 100, top: 80, width: 800, height: 500 });
    wv.getZoomFactor = () => 1;
    document.body.appendChild(wv);
    const handlers = {};
    wv.addEventListener = (ev, fn) => { handlers[ev] = fn; };
    window.PasskeyUI.attach(wv);
    handlers['ipc-message']({ channel: 'vex-passkey-field', args: [{ requestId: 'req1', uv: 'preferred', hasPin: false, host: 'example.com',
      rect: { x: 10, y: 20, width: 300, height: 30 }, accounts: [{ credentialId: 'c1', userName: 'ada', nickname: 'Ada' }] }] });
    const chooser = document.querySelector('.pk-chooser');
    expect(chooser).toBeTruthy();
    expect(chooser.style.left).toBe('110px');
    expect(chooser.style.top).toBe('134px');
    chooser.querySelector('.pk-chooser-row').click();
    await vi.waitFor(() => expect(vexApi.passkeysConditionalChoose).toHaveBeenCalledWith('req1', 'c1', undefined));
    expect(document.querySelector('.pk-chooser')).toBeNull();
  });
});

describe('searching the Settings list', () => {
  const pk = (id, rpId, userName, nickname = '') => ({ credentialId: id, rpId, rpName: '', userName, userDisplayName: userName, nickname, createdAt: '2026-01-02T00:00:00Z', lastUsedAt: null, deviceOnly: true });
  const visible = (box) => [...box.querySelectorAll('.pk-item')].filter(i => i.style.display !== 'none').map(i => i.dataset.id);
  const type = (search, value) => { search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })); };

  it('shows a search box only for six or more passkeys, and narrows by site, account or name', async () => {
    await load();
    vexApi._list = [pk('c1', 'github.com', 'ada'), pk('c2', 'gitlab.com', 'bob'), pk('c3', 'google.com', 'ada'), pk('c4', 'bank.example', 'carl', 'Work phone')];
    await window.PasskeyUI.refresh();
    const box = document.getElementById('passkeys-panel-content');
    const search = box.querySelector('.pk-search');
    expect(search.style.display).toBe('none');
    vexApi._list.push(pk('c5', 'shop.example', 'dee'), pk('c6', 'mail.example', 'eve'));
    await window.PasskeyUI.refresh();
    expect(search.style.display).toBe('');
    type(search, 'git');
    expect(visible(box)).toEqual(['c1', 'c2']);
    type(search, 'ada');
    expect(visible(box)).toEqual(['c1', 'c3']);
    type(search, 'work phone');
    expect(visible(box)).toEqual(['c4']);
    expect([...box.querySelectorAll('.pk-site')].filter(s => s.style.display !== 'none')).toHaveLength(1);
    type(search, 'zzz');
    expect(box.querySelector('.pk-nomatch')).not.toBeNull();
    type(search, '');
    expect(visible(box)).toHaveLength(6);
    expect(box.querySelector('.pk-nomatch')).toBeNull();
  });
});

describe('found 2026-10-12 by driving the sheet', () => {
  it('puts the focus inside a sheet that has no passkey to choose, so Escape closes it', async () => {
    const l = await load();
    l.ask(getPayload({ accounts: [] }));
    expect(sheet().contains(document.activeElement)).toBe(true);
    sheet().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(answers).toEqual([['ask1', { action: 'cancel' }]]));
  });

  it('lets the list under a field be used from the keyboard: Down and Up mark a row, Enter takes it', async () => {
    await load();
    const wv = document.createElement('webview');
    wv.getBoundingClientRect = () => ({ left: 100, top: 80, width: 800, height: 500 });
    wv.getZoomFactor = () => 1;
    document.body.appendChild(wv);
    const handlers = {};
    wv.addEventListener = (ev, fn) => { handlers[ev] = fn; };
    window.PasskeyUI.attach(wv);
    handlers['ipc-message']({ channel: 'vex-passkey-field', args: [{ requestId: 'req1', uv: 'preferred', hasPin: false, host: 'example.com',
      rect: { x: 10, y: 20, width: 300, height: 30 }, accounts: [{ credentialId: 'c1', userName: 'ada', nickname: 'Ada' }, { credentialId: 'c2', userName: 'bob', nickname: 'Bob' }] }] });
    const key = (k) => handlers['ipc-message']({ channel: 'vex-passkey-field-key', args: [{ key: k }] });
    const rows = () => [...document.querySelectorAll('.pk-chooser-row')];
    key('Enter');                                     // nothing marked yet: nothing taken
    expect(vexApi.passkeysConditionalChoose).not.toHaveBeenCalled();
    key('ArrowDown');
    expect(rows().map(r => r.classList.contains('is-active'))).toEqual([true, false]);
    key('ArrowDown');
    expect(rows().map(r => r.classList.contains('is-active'))).toEqual([false, true]);
    key('ArrowDown');                                 // wraps
    expect(rows().map(r => r.classList.contains('is-active'))).toEqual([true, false]);
    key('ArrowUp');                                   // up from the first goes to the last
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
    key('Enter');
    await vi.waitFor(() => expect(vexApi.passkeysConditionalChoose).toHaveBeenCalledWith('req1', 'c2', undefined));
    expect(document.querySelector('.pk-chooser')).toBeNull();
  });

  it('the page preload relays Down, Up and Enter only while the list is up', () => {
    const src = require('node:fs').readFileSync('src/preload-passkeys.js', 'utf8');
    expect(src).toContain("sendToHost('vex-passkey-field-key'");
    expect(src).toMatch(/key === 'Enter' && navigating/);
    // and never for a key event a page made up itself: Enter takes a passkey
    expect(src).toMatch(/!e\.isTrusted \|\| !shown/);
  });

  it('draws a button that cannot be pressed as one (the dialog stylesheet has a disabled rule)', async () => {
    const css = (await import('node:fs')).readFileSync('src/renderer/css/vex-dialog.css', 'utf8');
    expect(css).toMatch(/\.vex-dialog-btn:disabled\s*\{[^}]*opacity/);
    expect(css).toMatch(/\.vex-dialog-btn:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  });
});
