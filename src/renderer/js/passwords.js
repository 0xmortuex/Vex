// === Vex Password Vault (renderer) ===
//
// Companion to the main-process vault (safeStorage-encrypted at rest):
//  - capture: webviews send 'vex-cred-submit' on login-form submit (see
//    preload-webview.js) → a save/update prompt card appears
//  - autofill: on dom-ready the page is armed; the saved login is filled
//    only after a real click in a login field (preload-webview.js)
//  - manage: Settings → Passwords lists entries (copy / delete / add)
// Plaintext passwords only cross IPC when filling or when the user copies.

const PasswordVault = {
  NEVER_KEY: 'vex.pwNever',
  // How long a two-step login's username waits for its password step.
  LOGIN_STEP_MS: 10 * 60 * 1000,
  // How long a password shown in Settings › Passwords stays on screen.
  REVEAL_MS: 30 * 1000,

  async _copyPassword(password) {
    // One implementation for every secret Vex copies (js/vex-utils.js).
    return window.vexCopySecret(password, 'Password copied');
  },

  _never() { try { return JSON.parse(localStorage.getItem(this.NEVER_KEY) || '[]'); } catch { return []; } },
  _addNever(host) { const n = this._never(); if (!n.includes(host)) { n.push(host); try { localStorage.setItem(this.NEVER_KEY, JSON.stringify(n)); } catch {} } },

  // Remembered login emails (host -> email), for passwordless logins (magic
  // link / email code, e.g. Spotify) where there's no password to save. Lets us
  // pre-fill just the email so you only enter the emailed code. Stored locally.
  _emailsKey: 'vex.loginEmails',
  _loadEmails() { try { return JSON.parse(localStorage.getItem(this._emailsKey) || '{}') || {}; } catch { return {}; } },
  _rememberedEmail(host) { try { return this._loadEmails()[host] || ''; } catch { return ''; } },
  _rememberEmail(host, email) {
    try {
      if (!host || !email || String(email).indexOf('@') < 0) return;
      const m = this._loadEmails(); m[host] = String(email).slice(0, 200);
      localStorage.setItem(this._emailsKey, JSON.stringify(m));
    } catch {}
  },

  // One canonical host form everywhere. The webview preload reports the page's
  // host with "www." stripped and autofill looks credentials up the same way, so
  // comparing against a raw hostname here meant every www. site failed the
  // sender check: the save offer and the remembered login email simply never
  // appeared on them.
  _host(value) { return String(value || '').toLowerCase().replace(/^www\./, ''); },

  // Registered through the webview's lifecycle so destroyWebview can take it
  // off again. A handler left on the element captures `webview` in its closure,
  // and that keeps the whole element alive for the life of the window — one
  // leaked webview per closed tab.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', async (e) => {
      // A password field took focus (preload-webview.js): is this the site a login belongs to? Asked
      // before the fill policy below, because a Tor or private tab needs the warning just as much.
      if (e.channel === 'vex-cred-focus') {
        if (typeof CredentialInterlock !== 'undefined') CredentialInterlock.onFocus(webview, (e.args && e.args[0]) || {});
        return;
      }
      if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview)) return;
      let actualHost;
      try { const current = new URL(webview.getURL()); if (current.protocol !== 'https:') return; actualHost = this._host(current.hostname); } catch { return; }
      // Passwordless: remember the email the user typed on a login page.
      if (e.channel === 'vex-login-email') {
        const d = (e.args && e.args[0]) || {};
        if (this._host(d.host) === actualHost) this._rememberEmail(actualHost, d.email);
        return;
      }
      // A two-step login's first step: the username, held for this tab only
      // (never stored) so the password step can be offered for saving.
      if (e.channel === 'vex-login-user') {
        const d = (e.args && e.args[0]) || {};
        if (this._host(d.host) === actualHost && typeof d.username === 'string' && d.username && d.username.length <= 200) {
          webview._vexLoginUser = { host: actualHost, username: d.username, at: Date.now() };
        }
        return;
      }
      if (e.channel === 'vex-passkey-refused') {
        this._offerPasskey(webview, (e.args && e.args[0]) || {});
        return;
      }
      if (e.channel === 'vex-login-want') {
        await this._onLoginWant(webview, (e.args && e.args[0]) || {}, actualHost);
        return;
      }
      if (e.channel === 'vex-login-filled') {
        this._onLoginFilled(webview, (e.args && e.args[0]) || {});
        return;
      }
      if (e.channel === 'vex-pwgen-ask' || e.channel === 'vex-pwgen-used') {
        this._onSuggestMessage(webview, e.channel, (e.args && e.args[0]) || {}, actualHost);
        return;
      }
      if (e.channel !== 'vex-cred-submit') return;
      // A site routed through Tor by a site rule keeps its cookies
      // (persist:route-tor), but what is typed there never goes into the
      // vault, as in a Tor tab; sign-in popups refuse it too (main/vault.js).
      if (webview.getAttribute?.('partition') === 'persist:route-tor') return;
      const raw = (e.args && e.args[0]) || {};
      if (this._host(raw.host) !== actualHost) return;
      const data = { ...raw, host: actualHost };
      if (!data.username) {
        const step = webview._vexLoginUser;
        if (step && step.host === actualHost && Date.now() - step.at < this.LOGIN_STEP_MS) data.username = step.username;
      }
      if (!data.host || !data.username || !data.password) return;
      // The password Vex suggested and the person used: submitting the form is
      // the go-ahead to keep it, so it is saved now (and said so) instead of
      // asking a second time and losing it when the card times out.
      const suggested = webview._vexPwSuggestion;
      if (suggested && suggested.accepted && suggested.host === data.host && suggested.password === data.password) {
        webview._vexPwSuggestion = null;
        await this._saveSuggested(data);
        return;
      }
      if (this._never().includes(data.host)) return;
      try {
        const existing = await window.vex.vaultGet(data.host);
        const match = (existing || []).find(x => x.username === data.username);
        if (match && match.password === data.password) return; // already saved, unchanged
        this._offerSave(data, !!match);
      } catch (err) {
        console.error('[Vault] could not check for an existing credential:', err.message);
        window.showToast?.('Could not reach the password vault', 'error');
      }
    });
  },

  _offerSave(data, isUpdate) {
    document.getElementById('vex-pw-offer')?.remove();
    const esc = (s) => window.escapeHtml(s);
    const card = document.createElement('div');
    card.id = 'vex-pw-offer';
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:95000;width:320px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,0.5);font-family:\'Outfit\',sans-serif';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="display:inline-flex;color:var(--primary)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2"/><path d="m17 6 3 3"/></svg></span>
        <span style="font-size:13.5px;font-weight:700;color:var(--text)">${isUpdate ? 'Update password?' : 'Save password?'}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">${esc(data.username)} on <strong style="color:var(--text)">${esc(data.host)}</strong></div>
      <div style="display:flex;gap:6px">
        <button data-save style="flex:1;padding:8px 0;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600">${isUpdate ? 'Update' : 'Save'}</button>
        <button data-not style="padding:8px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px">Not now</button>
        <button data-never style="padding:8px 12px;background:var(--bg);color:var(--text-muted);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px">Never</button>
      </div>`;
    document.body.appendChild(card);
    const close = () => card.remove();
    card.querySelector('[data-save]').addEventListener('click', async () => {
      const r = await window.vex.vaultSave(data);
      window.showToast?.(r?.ok ? 'Password saved' : ('Save failed: ' + (r?.error || ''))); close();
    });
    card.querySelector('[data-not]').addEventListener('click', close);
    card.querySelector('[data-never]').addEventListener('click', () => { this._addNever(data.host); window.showToast?.('Never for ' + data.host); close(); });
    setTimeout(() => { if (document.body.contains(card)) close(); }, 20000);
  },

  // --- A site asked for a passkey or security key ---
  // Vex refuses those requests by default (site-tweaks.js, the setting
  // 'vex.passkeySuppressedHosts', "*" = every site) so Windows does not put its
  // passkey dialog over a password sign-in. A site that really signs in with a
  // passkey then just failed, silently. The page side says when it refused one
  // (once per page); this bar lets the person allow it on that site and retry.
  PASSKEY_ALLOWED_KEY: 'vex.passkeyAllowedHosts',
  passkeyAllowed() {
    try { const v = JSON.parse(localStorage.getItem(this.PASSKEY_ALLOWED_KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  },
  async setPasskeyAllowed(host, allowed) {
    const list = this.passkeyAllowed().filter(h => h !== host);
    if (allowed) list.push(host);
    localStorage.setItem(this.PASSKEY_ALLOWED_KEY, JSON.stringify(list));
    // Settings › Privacy lists them; it was drawn once at start, so a site
    // allowed from the bar was missing there until Vex restarted.
    this.renderPasskeyAllowed(document.getElementById('setting-passkey-allowed'));
    // Main reads the saved file when the page loads again: wait for the write.
    if (window.PersistentStorage && window.PersistentStorage._flush) await window.PersistentStorage._flush();
  },

  // Settings › Privacy: the sites allowed from the bar, each with Remove.
  renderPasskeyAllowed(box) {
    if (!box) return;
    const list = this.passkeyAllowed();
    box.textContent = '';
    if (!list.length) return;
    const head = document.createElement('div');
    head.className = 'setting-info muted';
    head.textContent = 'Passkeys allowed on:';
    box.appendChild(head);
    for (const host of list) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:var(--text)';
      const name = document.createElement('span');
      name.style.flex = '1';
      name.textContent = host;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.style.cssText = 'padding:3px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:11.5px;font-family:inherit';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Block passkeys on ' + host + ' again');
      remove.addEventListener('click', async () => {
        try { await this.setPasskeyAllowed(host, false); }
        catch (err) { window.showToast?.('Could not save that: ' + err.message, 'error'); return; }
        this.renderPasskeyAllowed(box);
      });
      row.append(name, remove);
      box.appendChild(row);
    }
  },

  _offerPasskey(webview, d) {
    const host = String(d.host || '').toLowerCase();
    if (!/^[a-z0-9.-]{1,253}$/.test(host) || this.passkeyAllowed().includes(host)) return;
    if (webview._vexPasskeyOffered === host) return;      // once per site per tab
    webview._vexPasskeyOffered = host;
    document.getElementById('vex-passkey-offer')?.remove();
    const esc = (s) => window.escapeHtml(s);
    const card = document.createElement('div');
    card.id = 'vex-passkey-offer';
    card.setAttribute('role', 'alert');
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:95000;width:340px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,0.5);font-family:\'Outfit\',sans-serif';
    const icon = typeof VexIcons !== 'undefined' ? VexIcons.svg('key', { size: 16 }) : '';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="display:inline-flex;color:var(--primary)">${icon}</span>
        <span style="font-size:13.5px;font-weight:700;color:var(--text)">This site asked for a passkey or security key</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px"><strong style="color:var(--text)">${esc(host)}</strong> wanted to sign you in with a passkey or security key. Vex blocks these prompts so the Windows dialog does not get in the way of a password sign-in.</div>
      <div style="display:flex;gap:6px">
        <button data-allow style="flex:1;padding:8px 0;background:var(--primary);color:var(--on-primary, #fff);border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600">Allow here</button>
        <button data-not style="padding:8px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px">Not now</button>
      </div>`;
    document.body.appendChild(card);
    const close = () => card.remove();
    card.querySelector('[data-not]').addEventListener('click', close);
    card.querySelector('[data-allow]').addEventListener('click', async () => {
      close();
      try { await this.setPasskeyAllowed(host, true); }
      catch (err) { window.showToast?.('Could not save that choice: ' + err.message, 'error'); return; }
      window.showToast?.(`Passkeys allowed on ${host} — trying again`);
      try { webview.reload(); }
      catch (err) { console.error('[Vault] could not reload after allowing passkeys:', err.message); window.showToast?.('Reload the page to try again', 'error'); }
    });
    setTimeout(() => { if (document.body.contains(card)) close(); }, 30000);
  },

  // --- "Use a strong password" on a site's sign-up form ---
  // preload-webview.js asks ('vex-pwgen-ask') when a new-password field gets
  // the focus. attach() has already refused private, off-the-record and Tor
  // tabs (VexTabPolicy) and anything not on https — the same rules as saving
  // and filling — and the host is checked against the page here. The password
  // is made by js/password-gen.js and kept on the webview until the form is
  // submitted; 'vex-pwgen-used' marks that the person really used it.
  _onSuggestMessage(webview, channel, d, actualHost) {
    if (this._host(d.host) !== actualHost || typeof d.id !== 'string' || !d.id || d.id.length > 64) return;
    if (channel === 'vex-pwgen-ask' && typeof VexScreenShareSafe !== 'undefined' && VexScreenShareSafe.vaultHeld()) { VexScreenShareSafe.noteHeld(); return; }
    if (channel === 'vex-pwgen-used') {
      const s = webview._vexPwSuggestion;
      if (!s || s.id !== d.id || s.host !== actualHost) return;
      s.accepted = true;
      window.showToast?.('Strong password filled — Vex saves it when you submit the form');
      return;
    }
    if (this._never().includes(actualHost)) return; // saving is off here, so a suggestion would be lost
    if (!window.VexPasswordGen) { console.error('[Vault] the password generator did not load'); return; }
    const made = window.VexPasswordGen.forField({ maxLength: d.maxLength, minLength: d.minLength });
    if (!made) return; // the field holds fewer than 8 characters
    webview._vexPwSuggestion = { id: d.id, host: actualHost, password: made.password, accepted: false };
    const icon = (typeof VexIcons !== 'undefined' ? VexIcons.svg('key', { size: 16 }) : '').replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    try {
      webview.send('vex-pwgen-offer', { id: d.id, password: made.password, label: window.VexPasswordGen.strength(made.bits).label, theme: this._suggestTheme(), icon });
    } catch (err) { console.error('[Vault] could not offer a password to the page:', err.message); }
  },

  // The card draws in the page, so it gets Vex's current colours as values.
  _suggestTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => String(cs.getPropertyValue(name) || '').trim().slice(0, 200);
    return { surface: v('--surface'), text: v('--text'), muted: v('--text-muted'), border: v('--border'), primary: v('--primary'), hover: v('--vex-hover-fill') };
  },

  async _saveSuggested(data) {
    let r;
    try { r = await window.vex.vaultSave(data); }
    catch (err) { r = { ok: false, error: err.message }; }
    if (r && r.ok) { window.showToast?.(`Password saved for ${data.host}`); return; }
    // Never lose it quietly: say so, and keep the usual offer up to try again.
    window.showToast?.('Could not save the new password: ' + ((r && r.error) || 'unknown error'), 'error');
    this._offerSave(data, false);
  },

  // A list of the saved usernames for this host. Returns the chosen entry, or
  // null if the user dismissed it.
  _pickCredential(creds, host) {
    return new Promise((resolve) => {
      document.getElementById('vex-pw-pick')?.remove();
      const esc = (s) => window.escapeHtml(s);
      const overlay = document.createElement('div');
      overlay.id = 'vex-pw-pick';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100052;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'Outfit\',sans-serif';
      overlay.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Choose a saved account" style="width:340px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="padding:16px 18px 8px;font-size:13.5px;font-weight:700;color:var(--text)">Choose a saved account</div>
        <div style="padding:0 18px 10px;font-size:11.5px;color:var(--text-muted)">for ${esc(host)}</div>
        <div id="pwpick-list" style="max-height:46vh;overflow-y:auto;padding:0 10px 10px"></div>
        <div style="padding:10px 18px 16px;display:flex;justify-content:flex-end"><button id="pwpick-cancel" style="padding:7px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px">Not now</button></div>
      </div>`;
      const listEl = overlay.querySelector('#pwpick-list');
      creds.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.style.cssText = 'display:block;width:100%;text-align:left;padding:9px 10px;margin:2px 0;background:none;border:1px solid transparent;border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        button.textContent = entry.username || '(no username)';
        button.addEventListener('mouseenter', () => { button.style.background = 'var(--bg)'; button.style.borderColor = 'var(--border)'; });
        button.addEventListener('mouseleave', () => { button.style.background = 'none'; button.style.borderColor = 'transparent'; });
        button.addEventListener('click', () => done(entry));
        listEl.appendChild(button);
      });
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(value);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
      overlay.querySelector('#pwpick-cancel').addEventListener('click', () => done(null));
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      listEl.querySelector('button')?.focus();
    });
  },

  // A saved login is never typed into a page as it loads: there any script on
  // the page could read it, out of a form the person never saw (audit S5).
  // This only arms the page side (preload-webview.js, "Saved-login fill") with
  // the page's origin. A real click in a login field asks for the login
  // ('vex-login-want', handled in attach()), the account chooser comes up if
  // the site has several, and the page side fills it in its isolated world.
  // opts.now: the AI agent's "sign in", which the person asked for, fills at
  // once (still from the isolated world).
  async autofill(webview, url, opts = {}) {
    if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview)) return;
    const generation = webview._navigationGeneration;
    let host = '', origin = '';
    try { const u = new URL(url); host = this._host(u.hostname); origin = u.origin; } catch { return; }
    if (!host || !/^https:/i.test(url)) return;
    let creds = [];
    try { creds = await window.vex.vaultGet(host); } catch (err) { console.error('[Vault] read failed for', host, '-', err.message); return; }
    if (generation !== webview._navigationGeneration || (webview.getURL && webview.getURL() !== url)) return;
    if (!creds || !creds.length) { this._autofillEmailOnly(webview, host, url); return; }
    webview._vexLoginArm = { host, origin };
    try { webview.send('vex-login-arm', { origin }); }
    catch (err) { console.error('[Vault] could not offer the saved login to the page:', err.message); return; }
    if (opts.now) await this._sendLogin(webview, { host, origin, id: vexId('now'), now: true });
  },

  // The page side asks after a real click in a login field.
  async _onLoginWant(webview, d, actualHost) {
    // While the screen is shared, a user name or an account list must not appear on it
    // (js/screen-share-safe.js). The click is not lost: the next one after the share works.
    if (typeof VexScreenShareSafe !== 'undefined' && VexScreenShareSafe.vaultHeld()) { VexScreenShareSafe.noteHeld(); return; }
    const arm = webview._vexLoginArm;
    if (!arm || arm.host !== actualHost || this._host(d.host) !== actualHost) return;
    if (typeof d.id !== 'string' || !d.id || d.id.length > 64) return;
    let origin = '';
    try { origin = new URL(webview.getURL()).origin; } catch { return; }
    if (d.origin !== origin || arm.origin !== origin) return;
    await this._sendLogin(webview, { host: actualHost, origin, id: d.id, now: false });
  },

  // Reads the login (through the chooser when there are several) and hands it
  // to the page side, as long as the page is still on the same origin.
  async _sendLogin(webview, { host, origin, id, now }) {
    const generation = webview._navigationGeneration;
    const still = () => {
      if (generation !== webview._navigationGeneration) return false;
      try { return new URL(webview.getURL()).origin === origin; } catch { return false; }
    };
    let creds = [];
    try { creds = await window.vex.vaultGet(host); }
    catch (err) {
      console.error('[Vault] read failed for', host, '-', err.message);
      window.showToast?.('Could not reach the password vault', 'error');
      return;
    }
    if (!creds || !creds.length || !still()) return;
    let c = creds[0];
    if (creds.length > 1) {
      const picked = await this._pickCredential(creds, host);
      if (!picked || !still()) return;
      c = picked;
    }
    let url = '';
    try { url = webview.getURL(); } catch { return; }
    webview._vexLoginSent = { id, username: c.username, url };
    try { webview.send('vex-login-fill', { id, origin, username: c.username, password: c.password, now }); }
    catch (err) { console.error('[Vault] could not hand the saved login to the page:', err.message); }
  },

  // Logged only when a field was really filled: it used to be recorded before
  // the fill, so every page of a site with a saved login counted as "password
  // filled" (found 2026-09-29).
  _onLoginFilled(webview, d) {
    const sent = webview._vexLoginSent;
    if (!sent || d.id !== sent.id) return;
    webview._vexLoginSent = null;
    if (Number(d.filled) > 0) window.AutofillLog?.record('password', sent.url, true, sent.username);
  },

  // No saved credential for this host, but we remembered the email used here
  // (passwordless login). Pre-fill ONLY a genuine login email/username field —
  // never a password, never a search box — on load and on click-to-fill.
  _autofillEmailOnly(webview, host, url) {
    if (typeof VexScreenShareSafe !== 'undefined' && VexScreenShareSafe.vaultHeld()) { VexScreenShareSafe.noteHeld(); return; }
    if (!url) { try { url = webview.getURL(); } catch { return; } }
    // `host` is the canonical (www-stripped) form; compare like for like or this
    // bails out on every www. site.
    try { if (!url || this._host(new URL(url).hostname) !== host) return; } catch { return; }
    const email = this._rememberedEmail(host);
    if (!email) return;
    const js = `(function(){try{
      var ORIGIN=${JSON.stringify(new URL(url).origin)};
      if(location.origin!==ORIGIN)return;
      var U=${JSON.stringify(email)};
      var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
      // No el.focus(), and nothing once the person has typed: as in autofill()
      // above (found 2026-09-29).
      var fire=function(el,val){try{if(location.origin!==ORIGIN||!visible(el)||el.disabled||el.readOnly)return;if(el.form&&new URL(el.form.action||location.href,location.href).origin!==location.origin)return;setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}};
      function visible(el){try{var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';}catch(e){return false;}}
      function meta(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}}
      function isSearchy(el){var t=(el.type||'').toLowerCase();if(t==='search')return true;var role=(el.getAttribute('role')||'').toLowerCase();if(role==='search'||role==='searchbox'||role==='combobox')return true;if(el.getAttribute('aria-autocomplete'))return true;return /search|find|filter|query|recipient|channel|message|mention|invite|\\brole\\b|emoji|gif|jump to/.test(meta(el));}
      function loginSignal(el){var t=(el.type||'').toLowerCase();if(t==='email')return true;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='username'||ac==='email')return true;return /e-?mail|user-?name|userid|user[_-]?login|sign-?in|(^| )login( |$)|phone number|account name/.test(meta(el));}
      function looksLikeUser(el){if(!visible(el))return false;var t=(el.type||'').toLowerCase();if(!(t===''||t==='text'||t==='email'||t==='tel'))return false;return !isSearchy(el);}
      // Only a field that BOTH looks like a user field AND carries a login signal.
      function userField(){var cands=document.querySelectorAll('input[type=text],input[type=email],input[type=tel],input:not([type])');for(var i=0;i<cands.length;i++){var el=cands[i];if(looksLikeUser(el)&&loginSignal(el))return el;}return null;}
      if(!window.__vexLoginTypedWired){window.__vexLoginTypedWired=true;
        document.addEventListener('input',function(e){try{var el=e.target;if(!e.isTrusted||!el||el.tagName!=='INPUT')return;var t=(el.type||'').toLowerCase();if(t==='password'||looksLikeUser(el))window.__vexLoginTyped=true;}catch(e){}},true);
      }
      function fill(){if(window.__vexLoginTyped)return;var u=userField();if(u&&!u.value)fire(u,U);}
      fill();
      if(!window.__vexEmailFocusWired){window.__vexEmailFocusWired=true;
        document.addEventListener('focusin',function(e){try{var el=e.target;if(el&&el.tagName==='INPUT'&&!el.value&&looksLikeUser(el)&&loginSignal(el)){setTimeout(fill,0);}}catch(e){}},true);
      }
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },

  // --- Settings → Passwords: the generator ---
  // Kept for this session only (not a saved setting), so the next visit to the
  // panel picks up where the last left off.
  _genOpts: { mode: 'characters', length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false, words: 8, separator: '-', capitalize: false, number: false },

  _generatorCard() {
    const o = this._genOpts;
    const card = document.createElement('div');
    card.id = 'vex-pwgen';
    card.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:12px;margin:0 0 12px;background:var(--bg)';
    const btn = 'padding:5px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:inherit;display:inline-flex;align-items:center;gap:5px';
    const check = (key, label) => `<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text);cursor:pointer"><input type="checkbox" data-opt="${key}" ${o[key] ? 'checked' : ''} style="accent-color:var(--primary)">${label}</label>`;
    const seg = (mode, label) => `<button type="button" data-mode="${mode}" aria-pressed="${o.mode === mode}" style="padding:4px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;${o.mode === mode ? 'background:var(--primary);color:var(--on-primary)' : 'background:transparent;color:var(--text-muted)'}">${label}</button>`;
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="display:inline-flex;color:var(--primary)">${VexIcons.svg('key', { size: 15 })}</span>
        <span style="font-size:13px;font-weight:700;color:var(--text);flex:1">Generate a password</span>
        <span role="group" aria-label="Kind of password" style="display:inline-flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:8px">${seg('characters', 'Characters')}${seg('words', 'Words')}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="pwgen-out" readonly spellcheck="false" aria-label="Generated password" style="flex:1;min-width:0;padding:7px 9px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;font:13px/1.3 Consolas,'Cascadia Mono',monospace">
        <button type="button" id="pwgen-again" style="${btn}" title="Make another" aria-label="Make another password">${VexIcons.svg('refresh', { size: 13 })}</button>
        <button type="button" id="pwgen-copy" style="${btn}">${VexIcons.svg('copy', { size: 13 })}Copy</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0 10px">
        <span id="pwgen-bar" aria-hidden="true" style="display:inline-flex;gap:3px">${'<span style="width:22px;height:5px;border-radius:3px;background:var(--border)"></span>'.repeat(4)}</span>
        <span id="pwgen-strength" style="font-size:11.5px;color:var(--text-muted)"></span>
      </div>
      <div data-for="characters" style="display:${o.mode === 'characters' ? 'block' : 'none'}">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);margin-bottom:8px">Length
          <input type="range" data-num="length" min="8" max="64" value="${o.length}" style="flex:1;accent-color:var(--primary)" aria-label="Password length">
          <span data-show="length" style="min-width:22px;text-align:right">${o.length}</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px">${check('upper', 'A–Z')}${check('lower', 'a–z')}${check('digits', '0–9')}${check('symbols', 'Symbols')}${check('avoidAmbiguous', 'Avoid lookalikes (0/O, 1/l)')}</div>
      </div>
      <div data-for="words" style="display:${o.mode === 'words' ? 'block' : 'none'}">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);margin-bottom:8px">Words
          <input type="range" data-num="words" min="4" max="12" value="${o.words}" style="flex:1;accent-color:var(--primary)" aria-label="Number of words">
          <span data-show="words" style="min-width:22px;text-align:right">${o.words}</span></label>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px">
          <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text)">Between words
            <select data-sep style="padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:12px">
              ${[['-', 'Dash'], [' ', 'Space'], ['.', 'Dot'], ['_', 'Underscore']].map(([v, l]) => `<option value="${v}" ${o.separator === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
          ${check('capitalize', 'Capitalise')}${check('number', 'Add a digit')}
        </div>
      </div>
      <div id="pwgen-error" role="alert" style="display:none;font-size:12px;color:var(--danger);margin-top:8px"></div>`;

    const out = card.querySelector('#pwgen-out');
    const err = card.querySelector('#pwgen-error');
    const paint = () => {
      const G = window.VexPasswordGen;
      err.style.display = 'none';
      let made;
      try {
        if (!G) throw new Error('The password generator did not load');
        made = o.mode === 'words'
          ? G.passphrase({ words: o.words, separator: o.separator, capitalize: o.capitalize, number: o.number })
          : G.generate({ length: o.length, lower: o.lower, upper: o.upper, digits: o.digits, symbols: o.symbols, avoidAmbiguous: o.avoidAmbiguous });
      } catch (e) {
        out.value = '';
        err.textContent = e.message;
        err.style.display = 'block';
        card.querySelector('#pwgen-strength').textContent = '';
        card.querySelectorAll('#pwgen-bar > span').forEach(s => { s.style.background = 'var(--border)'; });
        return;
      }
      out.value = made.password;
      const s = G.strength(made.bits);
      const colour = ['var(--danger)', 'var(--warning, #e0a400)', 'var(--success)', 'var(--success)'][s.level];
      card.querySelectorAll('#pwgen-bar > span').forEach((seg, i) => { seg.style.background = i <= s.level ? colour : 'var(--border)'; });
      card.querySelector('#pwgen-strength').textContent = `${s.label} · ${Math.round(s.bits)} bits · a stolen database: ${s.offline}`;
    };

    card.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      o.mode = b.dataset.mode;
      const fresh = this._generatorCard();
      card.replaceWith(fresh);
      fresh.querySelector(`[data-mode="${o.mode}"]`)?.focus();
    }));
    card.querySelectorAll('[data-opt]').forEach(c => c.addEventListener('change', () => { o[c.dataset.opt] = c.checked; paint(); }));
    card.querySelectorAll('[data-num]').forEach(r => r.addEventListener('input', () => {
      o[r.dataset.num] = parseInt(r.value, 10);
      card.querySelector(`[data-show="${r.dataset.num}"]`).textContent = r.value;
      paint();
    }));
    card.querySelector('[data-sep]').addEventListener('change', (e) => { o.separator = e.target.value; paint(); });
    card.querySelector('#pwgen-again').addEventListener('click', paint);
    card.querySelector('#pwgen-copy').addEventListener('click', async () => {
      try { await this._copyPassword(out.value); }
      catch (e) { window.showToast?.('Could not copy: ' + e.message, 'error'); }
    });
    paint();
    return card;
  },

  // --- Settings → Passwords ---
  // Add, edit (username, password, note), show and copy behind a re-check (the
  // Vex PIN if set, otherwise a confirmation; js/vex-lock.js), search, export
  // to Chrome's CSV, and undo the "Never save" and authenticator "don't fill
  // here" choices.
  _btn: "padding:5px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif;display:inline-flex;align-items:center;gap:5px",

  // One re-check covers the next two minutes in this window, so showing then
  // copying a password does not ask twice.
  RECHECK_MS: 2 * 60 * 1000,
  _recheckedUntil: 0,
  async _recheck(what) {
    if (Date.now() < this._recheckedUntil) return true;
    const lock = window.VexLock;
    if (!lock || typeof lock.recheck !== 'function') throw new Error('The PIN check did not load');
    const ok = await lock.recheck({ title: 'Saved passwords', message: `Vex asks again before it ${what}.`, okLabel: 'Continue' });
    if (ok) this._recheckedUntil = Date.now() + this.RECHECK_MS;
    return ok;
  },

  // The saved login as it is now (with its password and note), or null.
  async _fullEntry(host, username) {
    const full = await window.vex.vaultGet(host);
    return (full || []).find(x => x.username === username) || null;
  },

  // "https://www.Example.com/login" -> "example.com", as the vault keys logins.
  _hostFromInput(value) {
    let s = String(value || '').trim().toLowerCase();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
    let host = '';
    try { host = new URL(s).hostname; } catch { return ''; }
    host = this._host(host);
    return /^[a-z0-9.-]{1,253}$/.test(host) && host.includes('.') ? host : '';
  },

  // What the add / save dialog's generator last used (this session only).
  _dialogGen: { length: 20, letters: true, digits: true, symbols: true, avoidAmbiguous: false },

  // One password for a login, from the dialog's options: length clamped to
  // 12-64, "letters" being both cases. Throws (never falls back to something
  // weaker) when nothing is chosen or there is no secure random source.
  generateLogin(opts) {
    const o = opts || {};
    const G = window.VexPasswordGen;
    if (!G) throw new Error('The password generator did not load');
    const length = Math.max(12, Math.min(64, parseInt(o.length, 10) || 20));
    const letters = o.letters !== false;
    const made = G.generate({ length, lower: letters, upper: letters, digits: o.digits !== false, symbols: o.symbols !== false, avoidAmbiguous: !!o.avoidAmbiguous });
    return { password: made.password, bits: made.bits, strength: G.strength(made.bits) };
  },

  // The add / edit form. -> { host, username, password, note } or null.
  // usernameRequired: false for a saved login that has none (one kept from a
  // browser's CSV, for a site that asks only for a password or a PIN).
  // generator: true adds "Generate" with a length slider (12-64), letters /
  // digits / symbols / no-lookalikes, and the strength of what it made.
  // hint: one line of context under the title (why the dialog is open).
  _editDialog({ title, okLabel, host = '', username = '', password = '', note = '', hostEditable = false, passwordRequired = true, usernameRequired = true, generator = false, hint = '', passwordVisible = false }) {
    return new Promise((resolve) => {
      document.querySelectorAll('.vex-dialog-overlay').forEach(o => o._vexCancel?.());
      const prevFocus = document.activeElement;
      const esc = (s) => window.escapeHtml(s);
      const overlay = document.createElement('div');
      overlay.className = 'vex-dialog-overlay';
      overlay.innerHTML = `
        <div class="vex-dialog" role="dialog" aria-modal="true" aria-labelledby="vex-pwedit-title">
          <div class="vex-dialog-title" id="vex-pwedit-title">${esc(title)}</div>
          ${hint ? `<div class="vex-dialog-message" style="font-size:12px;color:var(--text-muted);margin:0 0 8px">${esc(hint)}</div>` : ''}
          <label class="vex-dialog-label" for="vex-pwedit-host">Site</label>
          <input class="vex-dialog-input" id="vex-pwedit-host" type="text" spellcheck="false" placeholder="example.com" ${hostEditable ? '' : 'readonly'}>
          <label class="vex-dialog-label" for="vex-pwedit-user">Username or email</label>
          <input class="vex-dialog-input" id="vex-pwedit-user" type="text" spellcheck="false" autocomplete="off">
          <label class="vex-dialog-label" for="vex-pwedit-pass">Password${passwordRequired ? '' : ' (leave empty to keep it)'}</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input class="vex-dialog-input" id="vex-pwedit-pass" type="password" spellcheck="false" autocomplete="new-password" style="flex:1">
            <button type="button" class="vex-dialog-btn" id="vex-pwedit-show" aria-pressed="false">Show</button>
          </div>
          ${generator ? `<div id="vex-pwedit-gen" style="margin-top:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <button type="button" class="vex-dialog-btn" id="vex-pwedit-generate">Generate</button>
              <span id="vex-pwedit-bar" aria-hidden="true" style="display:inline-flex;gap:3px">${'<span style="width:22px;height:5px;border-radius:3px;background:var(--border)"></span>'.repeat(4)}</span>
              <span id="vex-pwedit-strength" role="status" style="font-size:11.5px;color:var(--text-muted)"></span>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);margin:8px 0 6px">Length
              <input type="range" id="vex-pwedit-len" min="12" max="64" value="${this._dialogGen.length}" style="flex:1;accent-color:var(--primary)" aria-label="Password length">
              <span id="vex-pwedit-lenshow" style="min-width:22px;text-align:right">${this._dialogGen.length}</span></label>
            <div style="display:flex;flex-wrap:wrap;gap:6px 14px">${[['letters', 'Letters'], ['digits', 'Digits'], ['symbols', 'Symbols'], ['avoidAmbiguous', 'No lookalikes (0/O, 1/l)']].map(([key, label]) => `<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text);cursor:pointer"><input type="checkbox" data-gen="${key}" ${this._dialogGen[key] ? 'checked' : ''} style="accent-color:var(--primary)">${label}</label>`).join('')}</div>
          </div>` : ''}
          <label class="vex-dialog-label" for="vex-pwedit-note">Note</label>
          <textarea class="vex-dialog-input" id="vex-pwedit-note" rows="${generator ? 2 : 3}" spellcheck="false" placeholder="Optional, kept encrypted with the password"></textarea>
          <div id="vex-pwedit-error" role="alert" style="display:none;font-size:12px;color:var(--danger);margin-top:6px"></div>
          <div class="vex-dialog-actions">
            <button type="button" class="vex-dialog-btn" data-cancel>Cancel</button>
            <button type="button" class="vex-dialog-btn primary" data-ok>${esc(okLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const $ = (sel) => overlay.querySelector(sel);
      $('#vex-pwedit-host').value = host;
      $('#vex-pwedit-user').value = username;
      $('#vex-pwedit-pass').value = password;
      $('#vex-pwedit-note').value = note;
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        overlay.remove();
        try { if (prevFocus && document.contains(prevFocus)) prevFocus.focus(); } catch {}
        resolve(value);
      };
      overlay._vexCancel = () => done(null);
      const fail = (message) => { const box = $('#vex-pwedit-error'); box.textContent = message; box.style.display = 'block'; };
      const submit = () => {
        const siteHost = hostEditable ? this._hostFromInput($('#vex-pwedit-host').value) : host;
        const user = $('#vex-pwedit-user').value.trim();
        const pass = $('#vex-pwedit-pass').value;
        if (!siteHost) { fail('Enter the site, like example.com'); $('#vex-pwedit-host').focus(); return; }
        if (!user && usernameRequired) { fail('Enter the username or email'); $('#vex-pwedit-user').focus(); return; }
        if (passwordRequired && !pass) { fail('Enter the password'); $('#vex-pwedit-pass').focus(); return; }
        done({ host: siteHost, username: user, password: pass, note: $('#vex-pwedit-note').value.trim() });
      };
      $('[data-ok]').addEventListener('click', submit);
      $('[data-cancel]').addEventListener('click', () => done(null));
      const setShown = (show) => {
        const field = $('#vex-pwedit-pass');
        const button = $('#vex-pwedit-show');
        field.type = show ? 'text' : 'password';
        button.textContent = show ? 'Hide' : 'Show';
        button.setAttribute('aria-pressed', String(show));
      };
      $('#vex-pwedit-show').addEventListener('click', () => setShown($('#vex-pwedit-pass').type === 'password'));
      if (passwordVisible) setShown(true);
      if (generator) {
        // What was made, and not yet edited by hand: changing an option then
        // makes a fresh one in place.
        let made = false;
        const paintStrength = (info) => {
          const level = info ? info.level : -1;
          const colour = ['var(--danger)', 'var(--warning, #e0a400)', 'var(--success)', 'var(--success)'][level];
          overlay.querySelectorAll('#vex-pwedit-bar > span').forEach((seg, i) => { seg.style.background = i <= level ? colour : 'var(--border)'; });
          $('#vex-pwedit-strength').textContent = info ? `${info.label} · ${Math.round(info.bits)} bits` : '';
        };
        const options = () => {
          const o = this._dialogGen;
          o.length = parseInt($('#vex-pwedit-len').value, 10) || o.length;
          overlay.querySelectorAll('[data-gen]').forEach((c) => { o[c.dataset.gen] = c.checked; });
          return o;
        };
        const generate = () => {
          try {
            const r = this.generateLogin(options());
            $('#vex-pwedit-pass').value = r.password;
            made = true;
            setShown(true);
            paintStrength(r.strength);
            $('#vex-pwedit-error').style.display = 'none';
          } catch (err) {
            made = false;
            paintStrength(null);
            fail(err.message);
          }
        };
        $('#vex-pwedit-generate').addEventListener('click', generate);
        $('#vex-pwedit-len').addEventListener('input', () => { $('#vex-pwedit-lenshow').textContent = $('#vex-pwedit-len').value; options(); if (made) generate(); });
        overlay.querySelectorAll('[data-gen]').forEach((c) => c.addEventListener('change', () => { options(); if (made) generate(); }));
        $('#vex-pwedit-pass').addEventListener('input', () => { made = false; paintStrength(null); });
      }
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(null); });
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); return; }
        if (e.key === 'Tab') {
          const focusables = [...overlay.querySelectorAll('input:not([readonly]), textarea, button')];
          const first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
      (hostEditable ? $('#vex-pwedit-host') : $('#vex-pwedit-user')).focus();
    });
  },

  async _addLogin(container) {
    const got = await this._editDialog({ title: 'Add a password', okLabel: 'Save', hostEditable: true, generator: true });
    if (!got) return;
    try {
      if (await this._fullEntry(got.host, got.username)) {
        window.showToast?.(`There is already a saved login for ${got.username} on ${got.host}: edit that one`, 'error');
        return;
      }
      const r = await window.vex.vaultSave({ host: got.host, username: got.username, password: got.password, note: got.note });
      if (!r || !r.ok) throw new Error((r && r.error) || 'unknown error');
      window.showToast?.('Password saved');
    } catch (err) {
      window.showToast?.('Could not save it: ' + err.message, 'error');
      return;
    }
    await this.renderPanel(container);
  },

  async _editLogin(container, entry) {
    if (!await this._recheck('shows a saved password')) return;
    const m = await this._fullEntry(entry.host, entry.username);
    if (!m) { window.showToast?.('That saved login is no longer in the vault', 'error'); await this.renderPanel(container); return; }
    const got = await this._editDialog({ title: 'Edit saved password', okLabel: 'Save changes', host: m.host, username: m.username, password: m.password, note: m.note || '', passwordRequired: false, usernameRequired: !!m.username });
    if (!got) return;
    const r = await window.vex.vaultUpdate({ host: m.host, username: m.username, newUsername: got.username, password: got.password, note: got.note });
    if (!r || !r.ok) { window.showToast?.('Could not save the changes: ' + ((r && r.error) || 'unknown error'), 'error'); return; }
    window.showToast?.('Changes saved');
    await this.renderPanel(container);
  },

  // Settings → Passwords: CSV in Chrome's format, after a plain warning.
  async _exportCsv() {
    const go = await window.vexConfirm({
      title: 'Export passwords',
      message: 'The file holds every saved password in plain text. Anyone or any program that can open it can read them all. Keep it somewhere safe, import it where you need it, then delete it.',
      okLabel: 'Export', danger: true,
    });
    if (!go) return;
    // That warning is the confirmation; with a PIN set, the PIN as well.
    if (window.VexLock && window.VexLock.hasPin() && !await this._recheck('exports your passwords')) return;
    try {
      const r = await window.vex.vaultExportCsv();
      if (r && r.canceled) return;
      if (!r || !r.ok) throw new Error((r && r.error) || 'unknown error');
      window.showToast?.(`Exported ${r.count} password${r.count === 1 ? '' : 's'} — delete the file once you have used it`);
    } catch (err) {
      window.showToast?.('Could not export: ' + err.message, 'error');
    }
  },

  // The "Never" choices on the save card, and the authenticator's "don't fill
  // here" answers, each with Remove.
  _choicesSection(container) {
    const never = this._never();
    let totpNo = [];
    try {
      const all = JSON.parse(localStorage.getItem('vex.totpSites') || '{}') || {};
      totpNo = Object.keys(all).filter(k => all[k] === false);
    } catch (err) { console.error('[Vault] the authenticator site choices cannot be read:', err.message); }
    if (!never.length && !totpNo.length) return;
    const box = document.createElement('div');
    box.id = 'pw-choices';
    box.style.cssText = 'margin-top:14px;padding-top:10px;border-top:1px solid var(--border)';
    const section = (title, items, label, remove) => {
      if (!items.length) return;
      const head = document.createElement('div');
      head.style.cssText = 'font-size:12.5px;font-weight:600;color:var(--text);margin:6px 0 4px';
      head.textContent = title;
      box.appendChild(head);
      for (const item of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:var(--text)';
        const name = document.createElement('span');
        name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis';
        name.textContent = label(item);
        const b = document.createElement('button');
        b.type = 'button';
        b.style.cssText = this._btn;
        b.textContent = 'Remove';
        b.setAttribute('aria-label', 'Remove ' + label(item));
        b.addEventListener('click', () => { remove(item); this.renderPanel(container); });
        row.append(name, b);
        box.appendChild(row);
      }
    };
    section('Never offered to save on', never, h => h, (h) => {
      localStorage.setItem(this.NEVER_KEY, JSON.stringify(this._never().filter(x => x !== h)));
    });
    section('Authenticator codes not filled on', totpNo, (k) => { const at = k.lastIndexOf('@'); return `${k.slice(at + 1)} (${k.slice(0, at)})`; }, (k) => {
      const all = JSON.parse(localStorage.getItem('vex.totpSites') || '{}') || {};
      delete all[k];
      localStorage.setItem('vex.totpSites', JSON.stringify(all));
    });
    container.appendChild(box);
  },

  // "Saved 3 Mar 2024" under a login: when Vex saved or last changed it.
  _savedLabel(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    return 'saved ' + new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  },

  // What Password Health found, per login ("host\nusername" -> short notes),
  // so a reused, weak or year-old password is marked in the list itself.
  // Main works it out and sends findings only; a vault that cannot be
  // analysed leaves the list without marks and says why in the console.
  async _healthFlags() {
    const flags = new Map();
    const add = (host, username, note) => { const k = host + '\n' + username; if (!flags.has(k)) flags.set(k, []); if (!flags.get(k).includes(note)) flags.get(k).push(note); };
    try {
      const h = await window.vex.vaultHealth();
      if (!h || h.error) throw new Error((h && h.error) || 'no answer');
      for (const g of h.reused || []) for (const e of g.entries) add(e.host, e.username, 'reused password');
      for (const w of h.weak || []) add(w.host, w.username, 'weak password');
      for (const o of h.old || []) add(o.host, o.username, 'not changed in a year or more');
    } catch (err) {
      console.error('[Vault] could not mark weak or reused passwords:', err && err.message);
    }
    return flags;
  },

  async renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    let list = [];
    try { list = (await window.vex.vaultList()) || []; }
    catch (err) {
      console.error('[Vault] list failed:', err.message);
      container.innerHTML = `<div style="font-size:12.5px;color:var(--danger)">Could not read the password vault: ${window.escapeHtml(err.message)}</div>`;
      return;
    }
    container.innerHTML = `<p class="setting-info muted" style="margin-bottom:10px">Saved logins are encrypted with your OS keychain (Windows DPAPI) and filled in when you click a sign-in field on the matching site. Vex offers to save when you log in.</p>`;
    container.appendChild(this._generatorCard());
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin:0 0 6px';
    bar.innerHTML = `
      <input id="pw-search" type="search" aria-label="Search saved passwords" placeholder="Search sites and usernames" spellcheck="false" style="flex:1;min-width:0;padding:6px 9px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
      <button type="button" id="pw-add" style="${this._btn}">${VexIcons.svg('plus', { size: 13 })}Add</button>
      <button type="button" id="pw-export" style="${this._btn}" ${list.length ? '' : 'disabled'}>${VexIcons.svg('download', { size: 13 })}Export</button>`;
    container.appendChild(bar);
    bar.querySelector('#pw-add').addEventListener('click', () => this._addLogin(container));
    bar.querySelector('#pw-export').addEventListener('click', () => this._exportCsv());
    const rows = document.createElement('div');
    rows.id = 'pw-rows';
    container.appendChild(rows);
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12.5px;color:var(--text-muted);padding:8px 0';
    empty.textContent = list.length ? 'No saved password matches that.' : 'No saved passwords yet — log in somewhere and Vex will offer to save, or Add one.';
    empty.style.display = list.length ? 'none' : 'block';
    container.appendChild(empty);
    list.sort((a, b) => (a.host || '').localeCompare(b.host || '') || (a.username || '').localeCompare(b.username || ''));
    const flags = await this._healthFlags();
    list.forEach(entry => {
      const row = document.createElement('div');
      row.dataset.search = ((entry.host || '') + ' ' + (entry.username || '')).toLowerCase();
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--border);flex-wrap:wrap';
      row.innerHTML = `
        <img src="${typeof TabManager === 'undefined' || TabManager.mayAskSiteForIcon('https://' + entry.host + '/') ? `https://${encodeURIComponent(entry.host)}/favicon.ico` : ''}" style="width:18px;height:18px;border-radius:4px" alt="" data-image-fallback="hide">
        <div style="flex:1;min-width:120px">
          <div style="font-size:13.5px;font-weight:600;color:var(--text);overflow-wrap:anywhere">${esc(entry.host)}</div>
          <div style="font-size:11.5px;color:var(--text-muted);overflow-wrap:anywhere">${esc(entry.username)}${this._savedLabel(entry.updatedAt) ? ` · ${esc(this._savedLabel(entry.updatedAt))}` : ''}</div>
          ${(flags.get(entry.host + '\n' + entry.username) || []).length ? `<div data-flags style="font-size:11px;color:var(--warning,#f59e0b);margin-top:2px">${esc(flags.get(entry.host + '\n' + entry.username).join(' · '))}</div>` : ''}
          <div data-shown style="display:none;font:12.5px/1.4 Consolas,'Cascadia Mono',monospace;color:var(--text);overflow-wrap:anywhere;margin-top:3px"></div>
        </div>
        <button type="button" data-reveal style="${this._btn}" aria-pressed="false" aria-label="Show the password for ${esc(entry.username)} on ${esc(entry.host)}">${VexIcons.svg('eye', { size: 13 })}<span>Show</span></button>
        <button type="button" data-copy style="${this._btn}" aria-label="Copy the password for ${esc(entry.username)} on ${esc(entry.host)}">${VexIcons.svg('copy', { size: 13 })}Copy</button>
        ${entry.username ? `<button type="button" data-copyuser style="${this._btn};line-height:0" title="Copy the username" aria-label="Copy the username ${esc(entry.username)} for ${esc(entry.host)}">${VexIcons.svg('user', { size: 13 })}</button>` : ''}
        <button type="button" data-edit style="${this._btn}" aria-label="Edit the login for ${esc(entry.username)} on ${esc(entry.host)}">${VexIcons.svg('edit', { size: 13 })}Edit</button>
        <button type="button" data-del style="${this._btn};color:var(--danger);line-height:0" title="Delete" aria-label="Delete the password for ${esc(entry.username)} on ${esc(entry.host)}">${VexIcons.svg('x', { size: 13 })}</button>`;
      const shown = row.querySelector('[data-shown]');
      const reveal = row.querySelector('[data-reveal]');
      const hide = () => {
        clearTimeout(shown._hideTimer);
        shown.textContent = ''; shown.style.display = 'none';
        reveal.querySelector('span').textContent = 'Show'; reveal.setAttribute('aria-pressed', 'false');
      };
      reveal.addEventListener('click', async () => {
        if (shown.style.display !== 'none') { hide(); return; }
        try {
          if (!await this._recheck('shows a saved password')) return;
          const m = await this._fullEntry(entry.host, entry.username);
          if (!m) { window.showToast?.('That saved login is no longer in the vault', 'error'); this.renderPanel(container); return; }
          shown.textContent = m.password + (m.note ? '\n' + m.note : '');
          shown.style.whiteSpace = 'pre-wrap';
          shown.style.display = 'block';
          reveal.querySelector('span').textContent = 'Hide'; reveal.setAttribute('aria-pressed', 'true');
          // A password left showing on a screen someone walks past, or in a
          // screenshot, hides itself.
          shown._hideTimer = setTimeout(hide, this.REVEAL_MS);
        } catch (err) {
          console.error('[Vault] show failed:', err.message);
          window.showToast?.('Could not show that password: ' + err.message, 'error');
        }
      });
      // The username is not a secret: a plain copy, no re-check, no timer.
      row.querySelector('[data-copyuser]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(entry.username); window.showToast?.('Username copied'); }
        catch (err) {
          console.error('[Vault] could not copy the username:', err.message);
          window.showToast?.('Could not copy the username', 'error');
        }
      });
      row.querySelector('[data-copy]').addEventListener('click', async () => {
        try {
          if (!await this._recheck('copies a saved password')) return;
          const m = await this._fullEntry(entry.host, entry.username);
          // Never say "copied" when nothing was: the entry may have been deleted
          // in another window since this list was painted.
          if (!m) { window.showToast?.('That saved login is no longer in the vault', 'error'); this.renderPanel(container); return; }
          await this._copyPassword(m.password);
        } catch (err) {
          // Deliberately no password in this message.
          console.error('[Vault] copy failed:', err.message);
          window.showToast?.('Could not copy that password', 'error');
        }
      });
      row.querySelector('[data-edit]').addEventListener('click', () => {
        this._editLogin(container, entry).catch((err) => {
          console.error('[Vault] edit failed:', err.message);
          window.showToast?.('Could not edit that login: ' + err.message, 'error');
        });
      });
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!await vexConfirm({ title: 'Delete password', message: 'Delete the saved password for ' + entry.username + ' on ' + entry.host + '?', okLabel: 'Delete', danger: true })) return;
        const result = await window.vex.vaultDelete({ host: entry.host, username: entry.username });
        if (result && !result.ok) { window.showToast?.('Delete failed: ' + (result.error || 'unknown error'), 'error'); return; }
        this.renderPanel(container);
      });
      rows.appendChild(row);
    });
    bar.querySelector('#pw-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      let any = false;
      for (const row of rows.children) { const hit = !q || row.dataset.search.includes(q); row.style.display = hit ? '' : 'none'; any = any || hit; }
      empty.style.display = list.length && any ? 'none' : 'block';
    });
    this._choicesSection(container);
  },
};

if (typeof window !== 'undefined') window.PasswordVault = PasswordVault;
if (typeof module !== 'undefined' && module.exports) module.exports = { PasswordVault };
