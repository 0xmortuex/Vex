// === Passkeys: Vex's sheet, field chooser and Settings list ================
//
// The main process (src/main/passkeys.js) is the authenticator: it makes the
// keys, keeps them, and signs. This module is only what the person sees:
//
//   - the sheet: "Save a passkey for <site>?" / "Sign in with a passkey" /
//     "You already have a passkey here", with the Vex PIN as user verification;
//   - the chooser under a field marked autocomplete="webauthn" (conditional
//     mediation), anchored to the field through the webview's own rectangle;
//   - Settings › Passkeys: the list by site, rename, delete with Undo, details,
//     and the Vex Sync switch.
//
// A private key never reaches this window: the list holds names, dates and
// ids only (main/passkeys.js publicView).
(function () {
  'use strict';

  const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const icon = (name, size = 16) => (typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : '');
  const toast = (m, kind, ms, opts) => (typeof window.showToast === 'function' ? window.showToast(m, kind, ms, opts) : null);
  const SUPPRESSED_KEY = 'vex.passkeySuppressedHosts';

  function when(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return 'never';
    return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const displayName = (a) => a.nickname || a.userDisplayName || a.userName || 'Passkey';

  // "Never for this site": the same list Settings › Privacy shows as the sites
  // where Vex does not offer passkeys (main reads it as 'vex.passkeySuppressedHosts').
  function neverOffer(host) {
    let list = [];
    try {
      const raw = localStorage.getItem(SUPPRESSED_KEY);
      const parsed = raw == null ? [] : JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch (err) { console.error('[Passkeys] the "do not offer" list could not be read:', err.message); }
    if (!list.includes('*') && !list.includes(host)) list.push(host);
    localStorage.setItem(SUPPRESSED_KEY, JSON.stringify(list));
    const field = document.getElementById('setting-passkey-hosts');
    if (field) field.value = list.join(', ');
  }

  // --- The sheet --------------------------------------------------------------
  let sheet = null;       // { id, overlay }

  function closeSheet() {
    if (!sheet) return;
    const { overlay, prevFocus } = sheet;
    sheet = null;
    overlay.remove();
    try { if (prevFocus && document.contains(prevFocus)) prevFocus.focus(); } catch { /* the page moved on */ }
  }

  function openSettingsForPin() {
    closeSheetAndCancel();
    if (window.SettingsUI && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('lock-pin-new');
  }
  function closeSheetAndCancel() {
    if (!sheet) return;
    const id = sheet.id;
    closeSheet();
    window.vex.passkeysAnswer(id, { action: 'cancel' }).catch(err => console.error('[Passkeys] cancel failed:', err.message));
  }

  function pinBlock(p) {
    if (p.uv === 'none') return '';
    if (!p.hasPin) {
      return `<div class="pk-note" role="alert">${icon('lock', 15)}<span>This site wants you to verify it is you. Set a Vex PIN in Settings, then try again. <button type="button" class="pk-link" data-pk-settings>Open Settings</button></span></div>`;
    }
    const need = p.uv === 'required';
    return `<label class="vex-dialog-label" for="pk-pin">${need ? 'Vex PIN' : 'Vex PIN (optional)'}</label>
      <input class="vex-dialog-input" id="pk-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" aria-describedby="pk-error"${need ? ' aria-required="true"' : ''}>`;
  }

  function sheetHtml(p) {
    const site = `<strong>${esc(p.rpName || p.host)}</strong>${p.rpName && p.rpName !== p.host ? ` <span class="pk-host">${esc(p.host)}</span>` : ''}`;
    if (p.kind === 'exists') {
      return { title: 'You already have a passkey here', body: `<div class="vex-dialog-msg">A passkey for ${esc(p.userName)} on ${site} is already on this device, so Vex did not make another.</div>`, actions: '<button class="vex-dialog-btn primary" data-pk="ok">OK</button>' };
    }
    if (p.kind === 'create') {
      const others = (p.existing || []).filter(e => !p.replaces || e.credentialId !== p.replaces.credentialId);
      const blocked = p.uv === 'required' && !p.hasPin;
      return {
        title: `Save a passkey for ${esc(p.rpName || p.host)}?`,
        body: `<div class="vex-dialog-msg">Sign in to ${site} as <strong>${esc(p.userName)}</strong> without a password. The passkey is kept encrypted in Vex on this device${p.syncOn ? ' and syncs end-to-end encrypted through Vex Sync' : ' only'}.</div>
          <label class="vex-dialog-label" for="pk-name">Name</label>
          <input class="vex-dialog-input" id="pk-name" maxlength="80" value="${esc(p.userDisplayName || p.userName)}" autocomplete="off">
          ${p.replaces ? `<div class="pk-note">${icon('refresh', 15)}<span>This replaces the passkey you made for this account on ${esc(when(p.replaces.createdAt))}.</span></div>` : ''}
          ${others.length ? `<div class="pk-existing"><div class="pk-existing-title">Passkeys you already have here</div>${others.map(o => `<div class="pk-existing-row">${icon('key', 14)}<span>${esc(displayName(o))}</span><span class="pk-dim">${esc(o.userName)}</span></div>`).join('')}</div>` : ''}
          ${pinBlock(p)}
          <div class="pk-error" id="pk-error" role="alert"></div>`,
        actions: `<button class="vex-dialog-btn" data-pk="never" style="margin-right:auto">Never for this site</button>
          <button class="vex-dialog-btn" data-pk="cancel">Not now</button>
          <button class="vex-dialog-btn primary" data-pk="save"${blocked ? ' disabled' : ''}>Save passkey</button>`,
      };
    }
    // get
    const accounts = p.accounts || [];
    const blocked = p.uv === 'required' && !p.hasPin;
    const rows = accounts.map((a, i) => `<label class="pk-row">
        <input type="radio" name="pk-account" value="${esc(a.credentialId)}"${i === 0 ? ' checked' : ''}>
        <span class="pk-row-icon">${icon('key', 18)}</span>
        <span class="pk-row-text"><span class="pk-row-name">${esc(displayName(a))}</span><span class="pk-dim">${esc(a.userName)} · last used ${esc(when(a.lastUsedAt || a.createdAt))}</span></span>
      </label>`).join('');
    return {
      title: 'Sign in with a passkey',
      body: `<div class="vex-dialog-msg">${accounts.length ? `Choose the passkey to sign in to ${site} with.` : `You have no passkey for ${site} on this device. You can use a security key or your phone, or sign in another way.`}</div>
        ${accounts.length ? `<div class="pk-rows" role="radiogroup" aria-label="Passkeys for ${esc(p.host)}">${rows}</div>` : ''}
        ${accounts.length ? pinBlock(p) : ''}
        <div class="pk-error" id="pk-error" role="alert"></div>`,
      actions: `<button class="vex-dialog-btn" data-pk="native" style="margin-right:auto">Use a security key or phone</button>
        <button class="vex-dialog-btn" data-pk="cancel">Use a different method</button>
        ${accounts.length ? `<button class="vex-dialog-btn primary" data-pk="use"${blocked ? ' disabled' : ''}>Use passkey</button>` : ''}`,
    };
  }

  function openSheet(p) {
    if (!p || typeof p.id !== 'string') return;
    // Only a request from the page the person is looking at gets a sheet: a
    // background tab (or a hidden panel) asking is refused, never queued.
    if (!requesterVisible(p)) {
      window.vex.passkeysAnswer(p.id, { action: 'cancel' }).catch(err => console.error('[Passkeys] cancel failed:', err.message));
      return;
    }
    if (sheet) closeSheet();
    const parts = sheetHtml(p);
    const overlay = document.createElement('div');
    overlay.className = 'vex-dialog-overlay pk-overlay';
    overlay.id = 'vex-passkey-sheet';
    overlay.innerHTML = `<div class="vex-dialog pk-sheet" role="dialog" aria-modal="true" aria-labelledby="pk-title">
        <div class="pk-head"><span class="pk-head-icon">${icon('key', 20)}</span><div class="vex-dialog-title" id="pk-title">${parts.title}</div></div>
        ${parts.body}
        <div class="vex-dialog-actions">${parts.actions}</div>
      </div>`;
    document.body.appendChild(overlay);
    sheet = { id: p.id, overlay, prevFocus: document.activeElement };
    overlay._vexCancel = closeSheetAndCancel;

    const error = (m) => { const e = overlay.querySelector('#pk-error'); if (e) e.textContent = m || ''; };
    let busy = false;
    const send = async (a) => {
      if (busy) return;
      busy = true;
      overlay.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        const r = await window.vex.passkeysAnswer(p.id, a);
        if (r && r.ok === false && r.error) {
          busy = false;
          overlay.querySelectorAll('button').forEach(b => { b.disabled = false; });
          error(r.error);
          overlay.querySelector('#pk-pin')?.focus();
          return;
        }
        closeSheet();
      } catch (err) {
        console.error('[Passkeys] the answer could not be sent:', err);
        busy = false;
        overlay.querySelectorAll('button').forEach(b => { b.disabled = false; });
        error('Vex could not complete that: ' + err.message);
      }
    };
    const pinValue = () => (overlay.querySelector('#pk-pin')?.value || '').trim();
    const act = {
      ok: () => send({ action: 'ok' }),
      cancel: () => { closeSheetAndCancel(); },
      native: () => send({ action: 'native' }),
      never: () => { try { neverOffer(p.host); } catch (err) { console.error('[Passkeys] could not save the choice:', err); } send({ action: 'never' }); },
      save: () => send({ action: 'save', nickname: (overlay.querySelector('#pk-name')?.value || '').trim(), pin: pinValue() || undefined }),
      use: () => {
        const picked = overlay.querySelector('input[name="pk-account"]:checked');
        if (!picked) { error('Choose a passkey'); return; }
        send({ action: 'use', credentialId: picked.value, pin: pinValue() || undefined });
      },
    };
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pk]');
      if (btn && !btn.disabled) { act[btn.dataset.pk]?.(); return; }
      if (e.target.closest('[data-pk-settings]')) openSettingsForPin();
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeSheetAndCancel(); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeSheetAndCancel(); return; }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.type !== 'radio') {
        e.preventDefault();
        const primary = overlay.querySelector('.vex-dialog-btn.primary');
        if (primary && !primary.disabled) primary.click();
      }
      if (e.key === 'Tab' && window.VexFocusTrap) VexFocusTrap.onTab(e, overlay.firstElementChild);
    });
    const first = overlay.querySelector('#pk-pin') && p.uv === 'required' ? overlay.querySelector('#pk-pin')
      : overlay.querySelector('input[name="pk-account"]:checked') || overlay.querySelector('#pk-name') || overlay.querySelector('.vex-dialog-btn.primary');
    first?.focus();
    if (first && first.id === 'pk-name') first.select();
  }

  // The asking page is in front: a visible webview whose contents id matches.
  function requesterVisible(p) {
    if (typeof p.wcId !== 'number') return true;
    for (const wv of document.querySelectorAll('webview')) {
      let id;
      try { id = wv.getWebContentsId(); } catch { continue; }
      if (id === p.wcId) return wv.offsetParent !== null || wv.getClientRects().length > 0;
    }
    return false;
  }

  // --- The field chooser (conditional mediation) ------------------------------
  let chooser = null;
  let chooserGuard = 0;
  function hideChooser(force) {
    if (!chooser) return;
    if (!force && Date.now() - chooserGuard < 250) return;   // a click on it is in progress
    chooser.remove();
    chooser = null;
  }

  async function chooseFor(requestId, credentialId, info) {
    let pin;
    const needPin = info.uv === 'required' || (info.uv !== 'discouraged' && info.hasPin);
    if (needPin) {
      if (!info.hasPin) { toast('Set a Vex PIN in Settings to use this passkey', 'warning'); return; }
      let skipped = false;
      const entered = await vexPrompt({
        title: 'Verify with your Vex PIN', message: info.host ? `Sign in to ${info.host} with a passkey.` : '',
        label: 'Vex PIN', password: true, okLabel: 'Verify',
        ...(info.uv === 'required' ? {} : { extra: { label: 'Continue without', run: () => { skipped = true; } } }),
      });
      if (entered === null && !skipped) return;
      pin = entered || undefined;
    }
    const r = await window.vex.passkeysConditionalChoose(requestId, credentialId, pin);
    if (r && r.ok === false) toast(r.error || 'The passkey could not be used', 'warning');
  }

  function showChooser(webview, d) {
    hideChooser(true);
    if (!d || typeof d.requestId !== 'string' || !Array.isArray(d.accounts) || !d.accounts.length || !d.rect) return;
    const box = webview.getBoundingClientRect();
    let zoom = 1;
    try { zoom = webview.getZoomFactor ? webview.getZoomFactor() : 1; } catch { zoom = 1; }
    const left = box.left + d.rect.x * zoom;
    const top = box.top + (d.rect.y + d.rect.height) * zoom + 4;
    const width = Math.max(260, Math.min(420, d.rect.width * zoom));
    const el = document.createElement('div');
    el.className = 'pk-chooser';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Passkeys');
    el.style.left = Math.max(4, Math.min(left, window.innerWidth - width - 8)) + 'px';
    el.style.top = Math.min(top, window.innerHeight - 60) + 'px';
    el.style.width = width + 'px';
    el.innerHTML = d.accounts.map(a => `<button type="button" class="pk-chooser-row" role="option" data-id="${esc(a.credentialId)}">${icon('key', 16)}<span class="pk-row-text"><span class="pk-row-name">${esc(displayName(a))}</span><span class="pk-dim">${esc(a.userName)}</span></span></button>`).join('')
      + `<div class="pk-chooser-foot">Passkeys saved in Vex</div>`;
    // A click must not take the focus from the page: the field would blur and
    // this list would go before the click lands.
    el.addEventListener('mousedown', (e) => { e.preventDefault(); chooserGuard = Date.now(); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.pk-chooser-row');
      if (!b) return;
      hideChooser(true);
      chooseFor(d.requestId, b.dataset.id, { uv: d.uv, hasPin: d.hasPin, host: d.host })
        .catch(err => { console.error('[Passkeys] could not use the passkey:', err); toast('The passkey could not be used', 'error'); });
    });
    document.body.appendChild(el);
    chooser = el;
  }

  function attach(webview) {
    if (!webview || typeof window.vex?.passkeysConditionalChoose !== 'function') return;
    const on = (webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-passkey-field' && e.channel !== 'vex-passkey-field-hide') return;
      if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview)) return;
      if (e.channel === 'vex-passkey-field-hide') { hideChooser(false); return; }
      showChooser(webview, (e.args && e.args[0]) || null);
    });
  }

  // --- Settings › Passkeys ----------------------------------------------------
  let listBox = null;
  async function refresh() {
    if (!listBox) return;
    let list;
    try { list = await window.vex.passkeysList(); }
    catch (err) {
      listBox.querySelector('.pk-list').innerHTML = `<div class="pk-empty">${esc(/locked/i.test(err.message) ? 'Unlock Vex to see your passkeys.' : 'Passkeys could not be read: ' + err.message)}</div>`;
      return;
    }
    const host = listBox.querySelector('.pk-list');
    if (!list.length) { host.innerHTML = '<div class="pk-empty">No passkeys yet. When a site offers to create one, Vex asks first and keeps it here.</div>'; return; }
    const bySite = new Map();
    for (const p of list) { if (!bySite.has(p.rpId)) bySite.set(p.rpId, []); bySite.get(p.rpId).push(p); }
    host.innerHTML = [...bySite].map(([site, items]) => `<div class="pk-site"><div class="pk-site-name">${esc(items[0].rpName && items[0].rpName !== site ? items[0].rpName + ' · ' : '')}${esc(site)}</div>
      ${items.map(p => `<div class="pk-item" data-id="${esc(p.credentialId)}">
        <span class="pk-row-icon">${icon('key', 18)}</span>
        <span class="pk-row-text"><span class="pk-row-name">${esc(displayName(p))}</span><span class="pk-dim">${esc(p.userName)} · created ${esc(when(p.createdAt))} · last used ${esc(when(p.lastUsedAt))} · ${p.deviceOnly ? 'this device only' : 'synced'}</span></span>
        <span class="pk-item-actions">
          <button type="button" class="btn-secondary" data-act="details">Details</button>
          <button type="button" class="btn-secondary" data-act="rename">Rename</button>
          <button type="button" class="btn-danger" data-act="delete">Delete</button>
        </span></div>`).join('')}</div>`).join('');
    host._items = new Map(list.map(p => [p.credentialId, p]));
  }

  async function onAction(act, id) {
    const item = listBox.querySelector('.pk-list')._items?.get(id);
    if (!item) return;
    if (act === 'details') {
      await vexAlert({ title: displayName(item), message:
        `Site: ${item.rpId}\nAccount: ${item.userName}${item.userDisplayName && item.userDisplayName !== item.userName ? ' (' + item.userDisplayName + ')' : ''}\nCreated: ${when(item.createdAt)}\nLast used: ${when(item.lastUsedAt)}\nStored: ${item.deviceOnly ? 'on this device only' : 'synced through Vex Sync'}\nKey: ES256 (P-256), never leaves Vex\nPasskey ID: ${item.credentialId.slice(0, 12)}…` });
    } else if (act === 'rename') {
      const name = await vexPrompt({ title: 'Rename passkey', label: 'Name', value: displayName(item), okLabel: 'Rename' });
      if (name === null) return;
      try { await window.vex.passkeysRename(id, name); } catch (err) { toast('Could not rename: ' + err.message, 'error'); return; }
      await refresh();
    } else if (act === 'delete') {
      let r;
      try { r = await window.vex.passkeysDelete(id); } catch (err) { toast('Could not delete: ' + err.message, 'error'); return; }
      if (!r || !r.ok) { toast((r && r.error) || 'Could not delete that passkey', 'error'); return; }
      await refresh();
      const offer = (typeof VexUndo !== 'undefined') ? VexUndo.offer : null;
      const message = `Deleted the passkey for ${item.userName} on ${item.rpId}. You can no longer sign in to the site with it.`;
      if (offer) offer({ message, undo: async () => { const u = await window.vex.passkeysUndoDelete(r.undo); if (!u || !u.ok) throw new Error((u && u.error) || 'Could not undo'); await refresh(); } });
      else toast(message);
    }
  }

  async function syncState() {
    const engine = window.SyncEngine;
    if (!engine || typeof engine.syncTypes !== 'function') return null;
    const t = engine.syncTypes().find(x => x.id === 'passkeys');
    return t ? t.on : null;
  }

  async function mountSettings() {
    const box = document.getElementById('passkeys-panel-content');
    if (!box || box._pkMounted) return;
    box._pkMounted = true;
    listBox = box;
    box.innerHTML = `<div class="setting-hint pk-intro">Vex can sign you in to sites that offer a passkey, in tabs and in side panels. The passkey's private key is made inside Vex and never leaves it: sites and Vex's own window only ever see the finished signature. If you set a Vex PIN (Settings › Privacy &amp; Security), the PIN is how Vex checks it is you when a site asks.</div>
      <div class="setting-toggle-row"><span>Sync new passkeys through Vex Sync <span class="pk-dim">· end-to-end encrypted; off by default</span></span>
        <label class="toggle"><input type="checkbox" id="setting-passkey-sync" aria-label="Sync new passkeys through Vex Sync"><span class="toggle-slider"></span></label></div>
      <div class="pk-dim pk-sync-note" id="pk-sync-note">Passkeys made while this is off stay on this device. Passkeys cannot be exported.</div>
      <div class="pk-list" aria-live="polite"></div>
      <div class="setting-info muted pk-limits">Limits: sites that insist on a passkey from one particular security-key model (some company and bank sign-ins) will not accept Vex. Hardware security keys and phones still work through the browser's own dialog (choose "Use a security key or phone"). Sign-in pop-up windows and embedded frames do not use Vex passkeys yet. Never offered on private or Tor tabs.</div>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const row = b.closest('.pk-item');
      if (row) onAction(b.dataset.act, row.dataset.id).catch(err => { console.error('[Passkeys] action failed:', err); toast(err.message, 'error'); });
    });
    refresh().catch(err => console.error('[Passkeys] the list could not be shown:', err));
    const sync = box.querySelector('#setting-passkey-sync');
    // The sync engine loads a little after this module on some starts.
    let state = await syncState();
    for (let i = 0; state === null && i < 20; i++) { await new Promise(r => setTimeout(r, 500)); state = await syncState(); }
    if (state === null) { sync.disabled = true; box.querySelector('#pk-sync-note').textContent = 'Vex Sync is not available in this window.'; }
    else sync.checked = state;
    sync.addEventListener('change', async () => {
      const want = sync.checked;
      try {
        const r = await window.SyncEngine.setTypeSynced('passkeys', want);
        if (r && r.ok === false) sync.checked = !want;
      } catch (err) {
        sync.checked = !want;
        toast('Could not change passkey sync: ' + err.message, 'error');
      }
    });
  }

  function init() {
    if (!window.vex || typeof window.vex.onPasskeysAsk !== 'function') return;
    window.vex.onPasskeysAsk(openSheet);
    window.vex.onPasskeysAskCancel((d) => { if (sheet && d && d.id === sheet.id) closeSheet(); });
    window.vex.onPasskeysNotice((d) => { if (d && d.message) toast(d.message, d.kind || 'warning', 7000); });
    document.addEventListener('pointerdown', (e) => { if (chooser && !chooser.contains(e.target)) hideChooser(true); }, true);
    mountSettings().catch(err => console.error('[Passkeys] Settings could not be built:', err));
    // The list changes when a synced passkey arrives or one is made.
    if (typeof window.vex.onSyncSecretsChanged === 'function') window.vex.onSyncSecretsChanged(() => { refresh().catch(() => {}); });
  }

  window.PasskeyUI = { init, attach, mountSettings, refresh, openSheet, neverOffer, _sheetHtml: sheetHtml };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
