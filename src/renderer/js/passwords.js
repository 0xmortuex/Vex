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
    await navigator.clipboard.writeText(password);
    window.showToast?.('Password copied — clears in 30s if unchanged');
    setTimeout(async () => {
      try {
        if (await navigator.clipboard.readText() === password) await navigator.clipboard.writeText('');
      } catch { /* Clipboard permission can expire after the user leaves Vex. */ }
    }, 30000);
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

  attach(webview) {
    webview.addEventListener('ipc-message', async (e) => {
      if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
      let actualHost;
      try { const current = new URL(webview.getURL()); if (current.protocol !== 'https:') return; actualHost = this._host(current.hostname); } catch { return; }
      // Passwordless: remember the email the user typed on a login page.
      if (e.channel === 'vex-login-email') {
        const d = (e.args && e.args[0]) || {};
        if (this._host(d.host) === actualHost) this._rememberEmail(actualHost, d.email);
        return;
      }
      if (e.channel !== 'vex-cred-submit') return;
      const raw = (e.args && e.args[0]) || {};
      if (this._host(raw.host) !== actualHost) return;
      const data = { ...raw, host: actualHost };
      if (!data.host || !data.username || !data.password) return;
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
    try { window.AutofillLog?.record('password', url, true, c.username); } catch {}
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
      var fire=function(el,val){try{if(!visible(el)||el.disabled||el.readOnly)return;if(el.form&&new URL(el.form.action||location.href,location.href).origin!==location.origin)return;el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}};
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
      function fill(force){if(location.origin!==ORIGIN)return;var pw=Array.from(document.querySelectorAll('input[type=password]')).find(visible);var user=userField(pw);if(user&&(pw||loginSignal(user))&&(force||!user.value))fire(user,U);if(pw&&(force||!pw.value))fire(pw,P);}
      fill(false);
      if(!window.__vexPwFocusWired){window.__vexPwFocusWired=true;
        document.addEventListener('focusin',function(e){try{var el=e.target;if(!el||el.tagName!=='INPUT'||el.value)return;var t=(el.type||'').toLowerCase();if(t==='password'||(looksLikeUser(el)&&(loginSignal(el)||document.querySelector('input[type=password]')))){setTimeout(function(){fill(false);},0);}}catch(e){}},true);
      }
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
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
      var fire=function(el,val){try{if(location.origin!==ORIGIN||!visible(el)||el.disabled||el.readOnly)return;if(el.form&&new URL(el.form.action||location.href,location.href).origin!==location.origin)return;el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}};
      function visible(el){try{var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';}catch(e){return false;}}
      function meta(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}}
      function isSearchy(el){var t=(el.type||'').toLowerCase();if(t==='search')return true;var role=(el.getAttribute('role')||'').toLowerCase();if(role==='search'||role==='searchbox'||role==='combobox')return true;if(el.getAttribute('aria-autocomplete'))return true;return /search|find|filter|query|recipient|channel|message|mention|invite|\\brole\\b|emoji|gif|jump to/.test(meta(el));}
      function loginSignal(el){var t=(el.type||'').toLowerCase();if(t==='email')return true;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='username'||ac==='email')return true;return /e-?mail|user-?name|userid|user[_-]?login|sign-?in|(^| )login( |$)|phone number|account name/.test(meta(el));}
      function looksLikeUser(el){if(!visible(el))return false;var t=(el.type||'').toLowerCase();if(!(t===''||t==='text'||t==='email'||t==='tel'))return false;return !isSearchy(el);}
      // Only a field that BOTH looks like a user field AND carries a login signal.
      function userField(){var cands=document.querySelectorAll('input[type=text],input[type=email],input[type=tel],input:not([type])');for(var i=0;i<cands.length;i++){var el=cands[i];if(looksLikeUser(el)&&loginSignal(el))return el;}return null;}
      function fill(){var u=userField();if(u&&!u.value)fire(u,U);}
      fill();
      if(!window.__vexEmailFocusWired){window.__vexEmailFocusWired=true;
        document.addEventListener('focusin',function(e){try{var el=e.target;if(el&&el.tagName==='INPUT'&&!el.value&&looksLikeUser(el)&&loginSignal(el)){setTimeout(fill,0);}}catch(e){}},true);
      }
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
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
    list.sort((a, b) => (a.host || '').localeCompare(b.host || ''));
    list.forEach(entry => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border)';
      row.innerHTML = `
        <img src="https://${encodeURIComponent(entry.host)}/favicon.ico" style="width:18px;height:18px;border-radius:4px" data-image-fallback="hide">
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600;color:var(--text)">${esc(entry.host)}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">${esc(entry.username)}</div>
        </div>
        <button data-copy style="padding:5px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Copy</button>
        <button data-del style="padding:5px 10px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>`;
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
