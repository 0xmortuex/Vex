// === Save a password by hand, and generate one for a field ===
//
// The automatic "Save password?" card needs the page to submit a real form.
// Sites that sign in through a script (fetch, a button that is not in a form, a
// two-page flow Vex did not follow) never produce it, and there was then no way
// to put the login in the vault at all except Settings > Passwords > Add. This
// is the way: right-click the page (or a password field), Ctrl+K, or the same
// from the keyboard, and a dialog saves what you enter through the same vault
// path as the card. Next to it, "Generate a strong password" fills a focused
// password field (and its confirm box) with one made by js/password-gen.js.
//
// Policy, the same as the save card and the saved-login fill:
//  - saving: never from a private or Tor tab, never from a tab routed through
//    Tor or a proxy (what is typed there stays on that route), https pages only;
//    each refusal says why;
//  - generating fills the page and copies nothing; it works in any tab (a
//    private window is where many sign-ups happen) and offers to save only
//    where saving is allowed.
// The password is made here, in Vex's window, by crypto.getRandomValues; the
// page only ever receives the finished string, in the field it asked for.
const VexPasswordManual = {
  _t(key, fallback) { return (window.VexI18n && window.VexI18n.t(key, fallback)) || fallback; },
  _say(message, kind) { try { window.showToast?.(message, kind); } catch { /* no toast host */ } },

  // '' when this tab may save a password, else the reason in words.
  savingRefusal(webview) {
    if (!webview) return this._t('pwOpenPage', 'Open a web page first');
    const policy = window.VexTabPolicy;
    if (policy && !policy.canFillWebview(webview)) {
      return this._t('pwPrivate', 'Passwords are never saved from a private or Tor tab: nothing typed there is kept');
    }
    const partition = (() => { try { return webview.getAttribute?.('partition') || ''; } catch { return ''; } })();
    if (policy && partition && policy.isRouted(partition)) {
      return this._t('pwRouted', 'Passwords are never saved from a tab routed through Tor or a proxy: what is typed there stays on that route');
    }
    let url = '';
    try { url = webview.getURL(); } catch { return this._t('pwOpenPage', 'Open a web page first'); }
    if (!/^https:/i.test(url)) return this._t('pwHttps', 'Vex saves passwords for secure (https) pages only');
    return '';
  },

  // The username-like text the person typed or the page shows: the focused
  // field, else a filled field with a username signal, else the one just
  // before a password field. Only that one string is read - never a password.
  async _readUsername(webview) {
    const js = `(function(){try{
      function vis(el){try{var r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}catch(e){return false;}}
      function textual(el){var t=(el.type||'').toLowerCase();return t===''||t==='text'||t==='email'||t==='tel';}
      function meta(el){return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}
      function searchy(el){var t=(el.type||'').toLowerCase();var role=(el.getAttribute('role')||'').toLowerCase();return t==='search'||role==='searchbox'||role==='combobox'||/search|query|filter|coupon|promo|captcha|otp|code/.test(meta(el));}
      function signal(el){var ac=(el.getAttribute('autocomplete')||'').toLowerCase();return ac==='username'||ac==='email'||(el.type||'').toLowerCase()==='email'||/e-?mail|user-?name|user[_-]?id|login|account|phone/.test(meta(el));}
      var all=[].slice.call(document.querySelectorAll('input')).filter(function(el){return textual(el)&&vis(el)&&el.value&&!searchy(el);});
      var a=document.activeElement;
      var pick=null;
      if(a&&all.indexOf(a)>=0)pick=a;
      if(!pick)pick=all.filter(signal)[0]||null;
      if(!pick){var pw=document.querySelector('input[type=password]');if(pw){var before=all.filter(function(el){return el.compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING;});pick=before[before.length-1]||null;}}
      var v=pick?String(pick.value).trim():'';
      return v.length<=200?v:'';
    }catch(e){return '';}})();`;
    try { const v = await webview.executeJavaScript(js); return typeof v === 'string' ? v : ''; }
    catch { return ''; }
  },

  // Save (or update) one login through the vault: the same call as the card
  // and Settings > Passwords > Add. A login that already exists asks first.
  async commit(got) {
    const PV = window.PasswordVault;
    const existing = await PV._fullEntry(got.host, got.username);
    if (existing) {
      if (existing.password === got.password && !got.note) {
        this._say(this._t('pwAlready', 'Already saved: this login is in the vault as it is'));
        return { ok: true, unchanged: true };
      }
      const go = await window.vexConfirm({
        title: this._t('pwUpdateTitle', 'Update the saved password?'),
        message: this._t('pwUpdateMsg', '{user} on {host} already has a saved password. Replace it with this one?').replace('{user}', got.username || '(no username)').replace('{host}', got.host),
        okLabel: this._t('pwUpdate', 'Update'),
      });
      if (!go) return { ok: false, reason: 'declined' };
    }
    const r = await window.vex.vaultSave({ host: got.host, username: got.username, password: got.password, note: got.note });
    if (!r || !r.ok) throw new Error((r && r.error) || 'the vault gave no answer');
    this._say(existing ? this._t('pwUpdated', 'Password updated') : this._t('pwSaved', 'Password saved'));
    return { ok: true, updated: !!existing };
  },

  // The dialog. opts.password: one just generated, shown in the field.
  async saveForSite(webview, opts = {}) {
    const why = this.savingRefusal(webview);
    if (why) { this._say(why, 'error'); return { ok: false, reason: 'refused', message: why }; }
    const PV = window.PasswordVault;
    const host = PV._host(new URL(webview.getURL()).hostname);
    let username = await this._readUsername(webview);
    if (!username) {
      const step = webview._vexLoginUser;
      if (step && step.host === host) username = step.username;
    }
    if (!username) username = PV._rememberedEmail(host);
    const got = await PV._editDialog({
      title: this._t('pwDialogTitle', 'Save a password for this site'),
      okLabel: this._t('pwSave', 'Save'),
      host, username: username || '', password: opts.password || '',
      hostEditable: false, generator: true, passwordVisible: !!opts.password,
      hint: this._t('pwDialogHint', 'Enter the login yourself, or generate a strong password. It is kept encrypted with your Windows account, like every saved login.'),
    });
    if (!got) return { ok: false, reason: 'cancelled' };
    try { return await this.commit(got); }
    catch (err) {
      console.error('[Vault] could not save the login:', err && err.message);
      this._say(this._t('pwSaveFailed', 'Could not save it: ') + (err && err.message), 'error');
      return { ok: false, reason: 'failed', message: err && err.message };
    }
  },

  // --- Generate a strong password into the focused password field ---------
  // Step 1 finds and marks the field (and says how long it may be); step 2 fills
  // it - and the confirm box beside it - with the finished password.
  _findJs(token, point) {
    return `(function(){try{
      function vis(el){try{var r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.disabled&&!el.readOnly&&r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&(!el.form||new URL(el.form.action||location.href,location.href).origin===location.origin);}catch(e){return false;}}
      function isPw(el){return el&&el.tagName==='INPUT'&&(el.type||'').toLowerCase()==='password'&&vis(el);}
      var POINT=${JSON.stringify(point || null)};
      var t=null;
      if(POINT){try{var at=document.elementFromPoint(POINT.x,POINT.y);if(isPw(at))t=at;}catch(e){}}
      if(!t&&isPw(document.activeElement))t=document.activeElement;
      if(!t){var all=[].slice.call(document.querySelectorAll('input[type=password]')).filter(isPw);
        t=all.filter(function(e){return (e.getAttribute('autocomplete')||'').toLowerCase()==='new-password'&&!e.value;})[0]||all.filter(function(e){return !e.value;})[0]||null;}
      if(!t)return {found:false};
      [].slice.call(document.querySelectorAll('[data-vex-pwgen]')).forEach(function(e){e.removeAttribute('data-vex-pwgen');});
      t.setAttribute('data-vex-pwgen',${JSON.stringify(token)});
      return {found:true,maxLength:t.maxLength>0?t.maxLength:0,minLength:t.minLength>0?t.minLength:0,origin:location.origin};
    }catch(e){return {found:false};}})();`;
  },
  _fillJs(token, password, origin) {
    return `(function(){try{
      if(location.origin!==${JSON.stringify(origin)})return 0;
      var t=document.querySelector('[data-vex-pwgen='+${JSON.stringify(JSON.stringify(token))}+']');
      if(!t)return 0;
      var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      function put(el,val){try{el.focus();}catch(e){}setter.call(el,val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
      function confirmish(el){var m=((el.name||'')+' '+(el.id||'')+' '+(el.placeholder||'')+' '+(el.getAttribute('aria-label')||'')).toLowerCase();return /confirm|repeat|re-?type|again|verify|match/.test(m);}
      function vis(el){try{var r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.disabled&&!el.readOnly&&r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}catch(e){return false;}}
      var n=0;
      put(t,${JSON.stringify(password)});n++;
      var scope=t.form||document;
      [].slice.call(scope.querySelectorAll('input[type=password]')).forEach(function(el){
        if(el===t||el.value||!vis(el))return;
        var ac=(el.getAttribute('autocomplete')||'').toLowerCase();
        if(confirmish(el)||(ac==='new-password'&&(t.getAttribute('autocomplete')||'').toLowerCase()==='new-password')){put(el,${JSON.stringify(password)});n++;}
      });
      t.removeAttribute('data-vex-pwgen');
      return n;
    }catch(e){return 0;}})();`;
  },

  async generateInField(webview, opts = {}) {
    if (!webview) { this._say(this._t('pwOpenPage', 'Open a web page first'), 'error'); return { ok: false, reason: 'no-page' }; }
    if (!window.VexPasswordGen) throw new Error('The password generator did not load');
    const point = (Number.isFinite(opts.x) && Number.isFinite(opts.y)) ? { x: opts.x, y: opts.y } : null;
    const token = 'p' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    let found;
    try { found = await webview.executeJavaScript(this._findJs(token, point)); }
    catch (err) { this._say(this._t('pwNoPage', 'Could not reach the page: ') + (err && err.message), 'error'); return { ok: false, reason: 'unreachable' }; }
    if (!found || !found.found) {
      this._say(this._t('pwNoField', 'No password field found: click into the password field first'), 'info');
      return { ok: false, reason: 'no-field' };
    }
    const made = window.VexPasswordGen.forField({ maxLength: found.maxLength, minLength: found.minLength });
    if (!made) {
      this._say(this._t('pwTooShort', 'This field holds fewer than 8 characters: too short for a strong password'), 'error');
      return { ok: false, reason: 'too-short' };
    }
    let count = 0;
    try { count = await webview.executeJavaScript(this._fillJs(token, made.password, found.origin)); }
    catch (err) { this._say(this._t('pwNoPage', 'Could not reach the page: ') + (err && err.message), 'error'); return { ok: false, reason: 'unreachable' }; }
    if (!count) { this._say(this._t('pwNotFilled', 'The page changed before the password could be filled: try again'), 'error'); return { ok: false, reason: 'moved' }; }
    const strength = window.VexPasswordGen.strength(made.bits);
    this._say(this._t('pwFilled', 'Strong password filled') + (count > 1 ? ' (' + count + ')' : '') + ' · ' + strength.label);
    if (!this.savingRefusal(webview)) this._offerSave(webview, made.password);
    return { ok: true, count };
  },

  // "Save it" after a generated password was filled in, so it is not lost when
  // the form is submitted by script. A card like the automatic one.
  _offerSave(webview, password) {
    document.getElementById('vex-pw-offer')?.remove();
    const esc = (s) => window.escapeHtml(s);
    const card = document.createElement('div');
    card.id = 'vex-pw-offer';
    card.setAttribute('role', 'alert');
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:95000;width:320px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,0.5);font-family:\'Outfit\',sans-serif';
    const icon = typeof VexIcons !== 'undefined' ? VexIcons.svg('key', { size: 16 }) : '';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="display:inline-flex;color:var(--primary)">${icon}</span>
        <span style="font-size:13.5px;font-weight:700;color:var(--text)">${esc(this._t('pwFilled', 'Strong password filled'))}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">${esc(this._t('pwOfferMsg', 'Save it in the vault now, so it is not lost if the page does not ask.'))}</div>
      <div style="display:flex;gap:6px">
        <button type="button" data-save style="flex:1;padding:8px 0;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600">${esc(this._t('pwSaveIt', 'Save it'))}</button>
        <button type="button" data-not style="padding:8px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px">${esc(this._t('totpNotNow', 'Not now'))}</button>
      </div>`;
    document.body.appendChild(card);
    const close = () => card.remove();
    card.querySelector('[data-not]').addEventListener('click', close);
    card.querySelector('[data-save]').addEventListener('click', () => {
      close();
      this.saveForSite(webview, { password }).catch((err) => { console.error('[Vault] save after generate failed:', err); this._say('Could not save it: ' + ((err && err.message) || err), 'error'); });
    });
    setTimeout(() => { if (document.body.contains(card)) close(); }, 30000);
  },
};

if (typeof window !== 'undefined') window.VexPasswordManual = VexPasswordManual;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPasswordManual };
