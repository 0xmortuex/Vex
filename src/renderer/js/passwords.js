// === Vex Password Vault (renderer) ===
//
// Companion to the main-process vault (safeStorage-encrypted at rest):
//  - capture: webviews send 'vex-cred-submit' on login-form submit (see
//    preload-webview.js) → a save/update prompt card appears
//  - autofill: on dom-ready, saved credentials for the host are filled in
//  - manage: Settings → Passwords lists entries (copy / delete / add)
// Plaintext passwords only cross IPC when filling or when the user copies.

const PasswordVault = {
  NEVER_KEY: 'vex.pwNever',

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
      if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
      let actualHost;
      try { const current = new URL(webview.getURL()); if (current.protocol !== 'https:') return; actualHost = this._host(current.hostname); } catch { return; }
      // Passwordless: remember the email the user typed on a login page.
      if (e.channel === 'vex-login-email') {
        const d = (e.args && e.args[0]) || {};
        if (this._host(d.host) === actualHost) this._rememberEmail(actualHost, d.email);
        return;
      }
      if (e.channel === 'vex-pwgen-ask' || e.channel === 'vex-pwgen-used') {
        this._onSuggestMessage(webview, e.channel, (e.args && e.args[0]) || {}, actualHost);
        return;
      }
      if (e.channel !== 'vex-cred-submit') return;
      const raw = (e.args && e.args[0]) || {};
      if (this._host(raw.host) !== actualHost) return;
      const data = { ...raw, host: actualHost };
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
        <button data-save style="flex:1;padding:8px 0;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600">${isUpdate ? 'Update' : 'Save'}</button>
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

  // --- "Use a strong password" on a site's sign-up form ---
  // preload-webview.js asks ('vex-pwgen-ask') when a new-password field gets
  // the focus. attach() has already refused private, off-the-record and Tor
  // tabs (VexTabPolicy) and anything not on https — the same rules as saving
  // and filling — and the host is checked against the page here. The password
  // is made by js/password-gen.js and kept on the webview until the form is
  // submitted; 'vex-pwgen-used' marks that the person really used it.
  _onSuggestMessage(webview, channel, d, actualHost) {
    if (this._host(d.host) !== actualHost || typeof d.id !== 'string' || !d.id || d.id.length > 64) return;
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

  // Is a real login form on screen right now? Mirrors the field rules the
  // injected filler uses, so we never ask the user to choose an account for a
  // page that has nowhere to put it.
  async _hasLoginForm(webview, url) {
    let origin = '';
    try { origin = new URL(url).origin; } catch { return false; }
    const js = `(function(){try{
      if(location.origin!==${JSON.stringify(origin)})return false;
      function visible(el){try{var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';}catch(e){return false;}}
      function meta(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}}
      function isSearchy(el){var t=(el.type||'').toLowerCase();if(t==='search')return true;var role=(el.getAttribute('role')||'').toLowerCase();if(role==='search'||role==='searchbox'||role==='combobox')return true;if(el.getAttribute('aria-autocomplete'))return true;return /search|find|filter|query/.test(meta(el));}
      function loginSignal(el){var t=(el.type||'').toLowerCase();if(t==='email')return true;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='username'||ac==='email')return true;return /e-?mail|user-?name|userid|user[_-]?login|sign-?in|(^| )login( |$)|account name/.test(meta(el));}
      if(Array.prototype.slice.call(document.querySelectorAll('input[type=password]')).some(visible))return true;
      var cands=document.querySelectorAll('input[type=text],input[type=email],input[type=tel],input:not([type])');
      for(var i=0;i<cands.length;i++){var el=cands[i];if(visible(el)&&!isSearchy(el)&&loginSignal(el))return true;}
      return false;
    }catch(e){return false;}})();`;
    try { return !!(await webview.executeJavaScript(js)); }
    catch (err) { console.warn('[Vault] login-form probe failed:', err.message); return false; }
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

  async autofill(webview, url) {
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
    const generation = webview._navigationGeneration;
    let host = '';
    try { host = this._host(new URL(url).hostname); } catch { return; }
    if (!host || !/^https:/i.test(url)) return;
    let creds = [];
    try { creds = await window.vex.vaultGet(host); } catch (err) { console.error('[Vault] read failed for', host, '-', err.message); return; }
    if (generation !== webview._navigationGeneration || (webview.getURL && webview.getURL() !== url)) return;
    if (!creds || !creds.length) { this._autofillEmailOnly(webview, host, url); return; }
    let c = creds[0];
    if (creds.length > 1) {
      // Several logins for this host. The old code opened a "type the account
      // number" prompt from dom-ready — on EVERY page of the site, login page or
      // not — so browsing a site with two saved accounts meant a modal on every
      // single navigation. Only ask once a real login form is actually on screen,
      // and ask with a proper list instead of a number to type.
      if (!(await this._hasLoginForm(webview, url))) return;
      if (generation !== webview._navigationGeneration) return;
      const picked = await this._pickCredential(creds, host);
      if (!picked) return;
      if (generation !== webview._navigationGeneration || (webview.getURL && webview.getURL() !== url)) return;
      c = picked;
    }
    // Fills on load AND on focus (click-to-fill): clicking an empty email or
    // password field re-fills the saved login, which also covers multi-step
    // logins (email view → password view) that never reload the page, so the
    // one-shot dom-ready fill would otherwise miss the password step. Uses the
    // native value setter so React/Vue controlled inputs actually register the
    // change (plain el.value is ignored by their synthetic event system).
    const js = `(function(){try{
      if(location.origin!==${JSON.stringify(new URL(url).origin)})return;
      var ORIGIN=${JSON.stringify(new URL(url).origin)};
      var U=${JSON.stringify(c.username)},P=${JSON.stringify(c.password)};
      var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
      // No el.focus(): a fill set off by focusing the password field moved the
      // cursor back to the address field mid-sign-in (found 2026-09-29).
      var fire=function(el,val){try{if(!visible(el)||el.disabled||el.readOnly)return false;if(el.form&&new URL(el.form.action||location.href,location.href).origin!==location.origin)return false;setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;}catch(e){}return false;};
      function visible(el){try{var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';}catch(e){return false;}}
      function meta(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}}
      // Search / combobox / chat inputs are NOT login fields. This is what caused
      // the bug: the email got typed into Discord's "Find or start a conversation",
      // the role picker, etc. Exclude them explicitly.
      function isSearchy(el){var t=(el.type||'').toLowerCase();if(t==='search')return true;var role=(el.getAttribute('role')||'').toLowerCase();if(role==='search'||role==='searchbox'||role==='combobox')return true;if(el.getAttribute('aria-autocomplete'))return true;return /search|find|filter|query|recipient|channel|message|mention|invite|\\brole\\b|emoji|gif|jump to/.test(meta(el));}
      // Strong "this is a login username/email field" signal.
      function loginSignal(el){var t=(el.type||'').toLowerCase();if(t==='email')return true;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='username'||ac==='email')return true;return /e-?mail|user-?name|userid|user[_-]?login|sign-?in|(^| )login( |$)|phone number|account name/.test(meta(el));}
      function looksLikeUser(el){if(!visible(el))return false;var t=(el.type||'').toLowerCase();if(!(t===''||t==='text'||t==='email'||t==='tel'))return false;return !isSearchy(el);}
      function userField(pw){var scope=(pw&&pw.form)||document;var cands=scope.querySelectorAll('input[type=text],input[type=email],input[type=tel],input:not([type])');var signal=null,plain=null;for(var i=0;i<cands.length;i++){var el=cands[i];if(!looksLikeUser(el))continue;if(loginSignal(el)){signal=el;break;}if(!plain)plain=el;}return signal||(pw?plain:null);}
      // Only fill the username when this is really a login: a password field is
      // present, OR the field itself carries a strong login signal (covers
      // email-first 2-step logins). Never fill a lone search box.
      // Once the person has typed into a login field themselves, the page is
      // theirs: clearing the saved address to sign in with another account
      // had it filled straight back on the next focus (found 2026-09-29).
      // Only real key presses count — the fill's own events are not trusted.
      if(!window.__vexLoginTypedWired){window.__vexLoginTypedWired=true;
        document.addEventListener('input',function(e){try{var el=e.target;if(!e.isTrusted||!el||el.tagName!=='INPUT')return;var t=(el.type||'').toLowerCase();if(t==='password'||looksLikeUser(el))window.__vexLoginTyped=true;}catch(e){}},true);
      }
      // A field asking for a NEW password (a sign-up or change-password form)
      // never gets the saved one: it went into a sign-up form's first field
      // and hid "Use a strong password" there (found 2026-10-08).
      function isNewPw(el){return /new-password/i.test(el.getAttribute('autocomplete')||'');}
      function fill(force){if(location.origin!==ORIGIN||window.__vexLoginTyped)return 0;var n=0;var pw=Array.from(document.querySelectorAll('input[type=password]')).find(function(el){return visible(el)&&!isNewPw(el);});var user=userField(pw);if(user&&(pw||loginSignal(user))&&(force||!user.value)&&fire(user,U))n++;if(pw&&(force||!pw.value)&&fire(pw,P))n++;return n;}
      var filled=fill(false);
      if(!window.__vexPwFocusWired){window.__vexPwFocusWired=true;
        document.addEventListener('focusin',function(e){try{var el=e.target;if(!el||el.tagName!=='INPUT'||el.value)return;var t=(el.type||'').toLowerCase();if(t==='password'||(looksLikeUser(el)&&(loginSignal(el)||document.querySelector('input[type=password]')))){setTimeout(function(){fill(false);},0);}}catch(e){}},true);
      }
      return filled;
    }catch(e){return 0;}})();`;
    // Logged only when a field was really filled: it used to be recorded
    // before the fill, so every page of a site with a saved login counted as
    // "password filled" (found 2026-09-29).
    try {
      webview.executeJavaScript(js)
        .then((filled) => { if (filled > 0) window.AutofillLog?.record('password', url, true, c.username); })
        .catch(() => {});
    } catch {}
  },

  // No saved credential for this host, but we remembered the email used here
  // (passwordless login). Pre-fill ONLY a genuine login email/username field —
  // never a password, never a search box — on load and on click-to-fill.
  _autofillEmailOnly(webview, host, url) {
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
    container.innerHTML = `<p class="setting-info muted" style="margin-bottom:10px">Saved logins are encrypted with your OS keychain (Windows DPAPI) and autofilled on matching sites. Vex offers to save when you log in.</p>`;
    if (!list.length) container.innerHTML += '<div style="font-size:12.5px;color:var(--text-muted)">No saved passwords yet — log in somewhere and Vex will offer to save.</div>';
    container.insertBefore(this._generatorCard(), container.children[1] || null);
    list.sort((a, b) => (a.host || '').localeCompare(b.host || ''));
    list.forEach(entry => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border)';
      row.innerHTML = `
        <img src="${typeof TabManager === 'undefined' || TabManager.mayAskSiteForIcon('https://' + entry.host + '/') ? `https://${encodeURIComponent(entry.host)}/favicon.ico` : ''}" style="width:18px;height:18px;border-radius:4px" data-image-fallback="hide">
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600;color:var(--text)">${esc(entry.host)}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">${esc(entry.username)}</div>
        </div>
        <button data-copy style="padding:5px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Copy</button>
        <button data-del style="padding:5px 10px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif;line-height:0" title="Delete" aria-label="Delete this password">${VexIcons.svg('x', { size: 13 })}</button>`;
      row.querySelector('[data-copy]').addEventListener('click', async () => {
        try {
          const full = await window.vex.vaultGet(entry.host);
          const m = (full || []).find(x => x.username === entry.username);
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
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!await vexConfirm({ title: 'Delete password', message: 'Delete the saved password for ' + entry.username + ' on ' + entry.host + '?', okLabel: 'Delete', danger: true })) return;
        const result = await window.vex.vaultDelete({ host: entry.host, username: entry.username });
        if (result && !result.ok) { window.showToast?.('Delete failed: ' + (result.error || 'unknown error'), 'error'); return; }
        this.renderPanel(container);
      });
      container.appendChild(row);
    });
  },
};

if (typeof window !== 'undefined') window.PasswordVault = PasswordVault;
if (typeof module !== 'undefined' && module.exports) module.exports = { PasswordVault };
