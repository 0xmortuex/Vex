// === Vex TOTP 2FA autofill ===
// On a site's 2FA screen, auto-fill the 6-digit authenticator code from Vex's
// built-in Authenticator — so you never open the panel, read, and type it.
//
// SAFETY: a TOTP code is only injected when the PAGE'S SITE matches a saved
// account. Three ways a site can match, in order:
//   1. A curated map, for brands whose issuer name is not their domain
//      (Microsoft -> live.com, AWS -> amazon.com).
//   2. A binding the user has already confirmed for this account + site.
//   3. The site's registrable label matches one of the names the account is
//      known by (issuer, label, or the issuer prefix of an "Issuer:account"
//      label) AND the user confirms it once.
// Substring matching is deliberately gone: it let issuer "git" match "github".
// Bare label equality is not trusted on its own either, because an attacker can
// own a label match outright - github.io would otherwise match a GitHub account -
// so an unbound label match asks the user first, showing the host. Because that
// confirmation is the real boundary, candidate names can be generous: an account
// added from a raw secret has no issuer at all and would otherwise never match.
// Only fills a genuine one-time-code field (never a search/promo box), and only
// when it's empty.
const TotpAutofill = {
  _domains: { github: ['github.com'], google: ['google.com'], microsoft: ['live.com', 'microsoft.com', 'microsoftonline.com'], discord: ['discord.com'], gitlab: ['gitlab.com'], cloudflare: ['cloudflare.com'], amazon: ['amazon.com'], aws: ['amazon.com', 'aws.amazon.com'] },
  _norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); },
  BIND_KEY: 'vex.totpSites',

  // Registrable label: roblox.com -> roblox, accounts.roblox.com -> roblox,
  // example.co.uk -> example. A look-alike like github.com.evil.com resolves to
  // "evil" and can never match an account issued by GitHub.
  _SECOND_LEVEL: ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go'],
  _label(host) {
    const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
    if (parts.length < 2) return '';
    let index = parts.length - 2;
    if (parts.length >= 3 && this._SECOND_LEVEL.indexOf(parts[index]) !== -1) index = parts.length - 3;
    return this._norm(parts[index]);
  },

  _bindings() { try { const v = JSON.parse(localStorage.getItem(this.BIND_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } },
  _bindKey(account, host) { return this._norm(account.issuer || account.label) + '@' + host; },
  _bindingFor(account, host) { return this._bindings()[this._bindKey(account, host)]; },
  _bind(account, host, allowed) {
    const all = this._bindings();
    all[this._bindKey(account, host)] = !!allowed;
    try { localStorage.setItem(this.BIND_KEY, JSON.stringify(all)); } catch {}
  },

  // Every name this account could reasonably be known by. The issuer is the
  // reliable one, but a secret typed in by hand has no issuer at all (main.js
  // stores issuer:'' for a raw secret) and some issuers carry a suffix, like
  // "Roblox Corporation". Requiring an exact issuer match meant those accounts
  // could never autofill anywhere.
  //
  // Being generous here is safe: these names only decide what to OFFER. Anything
  // outside the curated map is confirmed by the user, showing the host, so the
  // confirmation is the security boundary rather than the string comparison.
  _names(account) {
    const names = new Set();
    const add = (value) => { const n = this._norm(value); if (n.length >= 3) names.add(n); };
    const label = String(account.label || '');
    const issuer = String(account.issuer || '');
    add(issuer);
    add(label);
    if (label.includes(':')) add(label.split(':')[0]);
    add(issuer.split(/[\s._-]+/)[0]);
    add(label.split(/[\s._-]+/)[0]);
    return names;
  },

  // 'curated' and 'bound' fill silently; 'label' needs a one-time confirmation.
  _matchKind(account, host) {
    const issuer = this._norm(account.issuer);
    if (issuer.length >= 3) {
      const domains = this._domains[issuer] || [];
      if (domains.some(domain => host === domain || host.endsWith('.' + domain))) return 'curated';
    }
    const site = this._label(host);
    if (!site || !this._names(account).has(site)) return null;
    const bound = this._bindingFor(account, host);
    if (bound === false) return null;
    return bound === true ? 'bound' : 'label';
  },

  async autofill(webview, url) {
    if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview)) return;
    const generation = webview._navigationGeneration;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
    if (!host || !/^https:/i.test(url)) return;

    let list = [];
    try { list = await window.vex.totpList(); } catch { return; }
    if (!list || !list.length) return;

    const matches = list.map((a) => ({ account: a, kind: this._matchKind(a, host) })).filter((m) => m.kind);
    if (!matches.length) return;

    // A 2FA screen appears AFTER the password step, and sites like Roblox show it
    // as a modal on the same URL — so dom-ready has already fired and will never
    // fire again. Running once and giving up meant the field never existed yet at
    // the only moment we looked. Wait for it, for as long as the user stays on
    // this site. (_inject's own retry is ~3s, far too short to cover typing a
    // password and submitting.)
    if (webview._vexTotpPolling) return;
    webview._vexTotpPolling = true;
    try {
      const origin = new URL(url).origin;
      const here = () => { try { return webview.isConnected !== false && new URL(webview.getURL()).origin === origin; } catch { return false; } };
      let ready = false;
      for (let i = 0; i < this.WAIT_TICKS; i++) {
        if (!here()) return;
        if (await this._hasOtpField(webview, url)) { ready = true; break; }
        // Only wait on a page that plausibly leads to a 2FA step. Otherwise every
        // visit to a site with a saved code would probe the DOM for a minute.
        if (i === 0 && !(await this._looksLikeAuthFlow(webview, url))) return;
        await new Promise((resolve) => setTimeout(resolve, this.WAIT_INTERVAL_MS));
      }
      if (!ready || !here()) return;
      await this._fill(webview, url, host, matches);
    } finally {
      webview._vexTotpPolling = false;
    }
  },

  WAIT_TICKS: 40,            // ~60s, enough to type a password and submit
  WAIT_INTERVAL_MS: 1500,

  async _fill(webview, url, host, matches) {
    const origin = new URL(url).origin;
    const here = () => { try { return new URL(webview.getURL()).origin === origin; } catch { return false; } };
    let match = matches[0];
    if (matches.length > 1) {
      // Several saved accounts claim this site. Filling an arbitrary one silently
      // is worse than asking, so let the user pick from a list (it was "type a
      // number" in a text box).
      match = await this._pickAccount(matches, host);
      if (!match || !here()) return;
    }
    if (match.kind === 'label') {
      // The site's name matches this account, which is a good guess but one an
      // attacker can arrange, so confirm once and remember. The caller has already
      // waited for a real 2FA field, so this never fires on ordinary browsing.
      if (!window.vexConfirm) return;
      const name = String(match.account.issuer || match.account.label || '').trim();
      const ok = await window.vexConfirm({
        title: 'Fill your 2FA code here?',
        message: name ? `Use your "${name}" authenticator code on ${host}?` : `Use your saved authenticator code on ${host}?`,
        okLabel: 'Fill code',
      });
      this._bind(match.account, host, ok);
      if (!ok || !here()) return;
    }
    const chosen = [match.account];

    let codes = [];
    try { codes = await window.vex.totpCodes(); } catch { return; }
    const entry = codes.find((x) => x.id === chosen[0].id);
    const code = entry && entry.code;
    if (!code || !/^\d{4,8}$/.test(code)) return;
    if (!here()) return;   // origin, not exact URL: the 2FA step is a navigation
    this._inject(webview, code, url, chosen[0]);
    try { window.AutofillLog?.record('totp', url, true, chosen[0].issuer || chosen[0].label); } catch {}
  },


  // A list of the accounts that match this site, like the saved-password
  // chooser. -> the chosen match, or null when dismissed.
  _pickAccount(matches, host) {
    return new Promise((resolve) => {
      document.getElementById('vex-totp-pick')?.remove();
      const prevFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.id = 'vex-totp-pick';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100052;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'Outfit\',sans-serif';
      overlay.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="vex-totp-pick-title" style="width:340px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div id="vex-totp-pick-title" style="padding:16px 18px 8px;font-size:13.5px;font-weight:700;color:var(--text)">Which account's code?</div>
        <div data-host style="padding:0 18px 10px;font-size:11.5px;color:var(--text-muted)"></div>
        <div data-list style="max-height:46vh;overflow-y:auto;padding:0 10px 10px"></div>
        <div style="padding:10px 18px 16px;display:flex;justify-content:flex-end"><button type="button" data-cancel style="padding:7px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px">Not now</button></div>
      </div>`;
      overlay.querySelector('[data-host]').textContent = 'Authenticator codes for ' + host;
      const list = overlay.querySelector('[data-list]');
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        try { if (prevFocus && document.contains(prevFocus)) prevFocus.focus(); } catch {}
        resolve(value);
      };
      for (const m of matches) {
        const issuer = String(m.account.issuer || '').trim();
        const label = String(m.account.label || '').trim();
        const button = document.createElement('button');
        button.type = 'button';
        button.style.cssText = 'display:block;width:100%;text-align:left;padding:9px 10px;margin:2px 0;background:none;border:1px solid transparent;border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        button.textContent = issuer && label && issuer.toLowerCase() !== label.toLowerCase() ? `${issuer} · ${label}` : (issuer || label || 'Account');
        button.addEventListener('mouseenter', () => { button.style.background = 'var(--bg)'; button.style.borderColor = 'var(--border)'; });
        button.addEventListener('mouseleave', () => { button.style.background = 'none'; button.style.borderColor = 'transparent'; });
        button.addEventListener('click', () => done(m));
        list.appendChild(button);
      }
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); return; }
        if (e.key === 'Tab') {
          const all = [...overlay.querySelectorAll('button')];
          const first = all[0], last = all[all.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
      overlay.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      list.querySelector('button')?.focus();
    });
  },

  // Is this page plausibly part of a sign-in that could reach a 2FA step? Used
  // only to decide whether waiting for the field is worth it.
  async _looksLikeAuthFlow(webview, url) {
    let origin = '';
    try { origin = new URL(url).origin; } catch { return false; }
    const js = `(function(){try{
      if(location.origin!==${JSON.stringify(origin)})return false;
      if(document.querySelector('input[type=password]'))return true;
      if(/login|sign-?in|signin|auth|verify|challenge|2fa|two-?step|security/i.test(location.pathname))return true;
      return /two.?factor|authenticat|verification code|one.?time|2-?step|enter the (code|digits)/i.test(document.body.innerText||document.body.textContent||'');
    }catch(e){return false;}})();`;
    try { return !!(await webview.executeJavaScript(js)); } catch { return false; }
  },

  // Cheap page probe: is there a visible, empty one-time-code field right now?
  // Mirrors the isOtp rules used by the injected filler.
  async _hasOtpField(webview, url) {
    const js = `(function(){try{
      if(location.origin!==${JSON.stringify(new URL(url).origin)})return false;
      function vis(el){try{var r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.disabled&&!el.readOnly&&r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}catch(e){return false;}}
      function meta(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}}
      function pageIs2fa(){try{return /two.?factor|authenticat|verify your|verification code|one.?time|2fa|enter the (code|digits)/i.test(document.body.innerText||document.body.textContent||'');}catch(e){return false;}}
      var all=Array.prototype.slice.call(document.querySelectorAll('input'));
      for(var i=0;i<all.length;i++){var el=all[i];var t=(el.type||'').toLowerCase();
        if(t==='password')continue;
        if(!(t===''||t==='text'||t==='tel'||t==='number'))continue;
        if(!vis(el))continue;
        var ac=(el.getAttribute('autocomplete')||'').toLowerCase();
        if(ac==='one-time-code')return true;
        if(/otp|2fa|two.?factor|totp|mfa|authenticator|one.?time|verification.?code|security.?code|passcode|auth.?code/.test(meta(el)))return true;
        // Must mirror isOtp below, or we would prompt and then fill nothing.
        if(/\\bcode\\b|\\bdigits?\\b/.test(meta(el))&&pageIs2fa())return true;
        if(el.maxLength===1)return true;
      }
      return false;
    }catch(e){return false;}})();`;
    try { return !!(await webview.executeJavaScript(js)); } catch { return false; }
  },
  _inject(webview, code, url, account = null) {
    if (!url) return;
    const js = `(function(){try{
      var ORIGIN=${JSON.stringify(new URL(url).origin)};
      if(location.origin!==ORIGIN)return;
      var CODE=${JSON.stringify(code)};
      var DIGITS=CODE.split('');
      var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
      function fire(el,val){try{if(location.origin!==ORIGIN||!vis(el))return;el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}
      function vis(el){try{var r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.disabled&&!el.readOnly&&(!el.form||new URL(el.form.action||location.href,location.href).origin===location.origin)&&r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';}catch(e){return false;}}
      function meta(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}}
      // A genuine one-time-code field: autocomplete one-time-code, or clear 2FA
      // wording. A BARE "code" is only accepted when the surrounding page is
      // plainly a 2FA screen — sites like Roblox label the input just "Code",
      // and refusing those meant 2FA autofill never fired there at all, while
      // accepting them anywhere would grab promo/coupon boxes.
      function isOtp(el){var t=(el.type||'').toLowerCase();if(t==='password')return false;if(!(t===''||t==='text'||t==='tel'||t==='number'))return false;if(!vis(el))return false;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='one-time-code')return true;if(/otp|2fa|two.?factor|totp|mfa|authenticator|one.?time|verification.?code|security.?code|passcode|auth.?code/.test(meta(el)))return true;return /\\bcode\\b|\\bdigits?\\b/.test(meta(el))&&pageIs2fa();}
      function pageIs2fa(){try{return /two.?factor|authenticat|verify your|verification code|one.?time|2fa|enter the (code|digits)/i.test(document.body.innerText||document.body.textContent||'');}catch(e){return false;}}
      function fill(){
        if(location.origin!==ORIGIN)return false;
        var all=Array.prototype.slice.call(document.querySelectorAll('input'));
        // Split-box case: a row of maxlength-1 numeric inputs (React OTP). Only on
        // a page that clearly IS a 2FA screen, to avoid unrelated 1-char inputs.
        var boxes=all.filter(function(el){var t=(el.type||'').toLowerCase();var im=(el.getAttribute('inputmode')||'').toLowerCase();return vis(el)&&el.maxLength===1&&(t==='tel'||t==='number'||im==='numeric'||/^\\d?$/.test(el.value||''))&&(t===''||t==='text'||t==='tel'||t==='number');});
        if(boxes.length>=DIGITS.length&&boxes.length<=DIGITS.length+2&&pageIs2fa()){
          var empty=boxes.filter(function(b){return !b.value;});
          if(empty.length>=DIGITS.length){for(var i=0;i<DIGITS.length;i++){fire(boxes[i],DIGITS[i]);}return true;}
        }
        // Single-field case.
        for(var j=0;j<all.length;j++){if(isOtp(all[j])&&!all[j].value){fire(all[j],CODE);return true;}}
        return false;
      }
      fill();
      // 2FA fields often render a beat after load — retry briefly.
      var n=0;var iv=setInterval(function(){if(fill()||++n>8)clearInterval(iv);},400);
      // Click-to-fill: a real click into an emptied 2FA field asks Vex for the
      // code of THAT moment (the promise below resolves, _inject's caller fetches
      // a fresh code and injects again). One listener per injection, kept in
      // this closure: nothing on window, so the page's own script cannot call
      // it (it could, through window.__vexTotpWant, found 2026-10-11). A focus
      // the page's script makes with el.focus() also arrives trusted, so the
      // person must just have clicked or pressed a key.
      return new Promise(function(resolve){
        function onFocus(e){try{
          if(!e.isTrusted||!(navigator.userActivation&&navigator.userActivation.isActive))return;
          var el=e.target;if(!el||el.tagName!=='INPUT'||el.value||!isOtp(el))return;
          document.removeEventListener('focusin',onFocus,true);resolve('focus');
        }catch(x){}}
        document.addEventListener('focusin',onFocus,true);
      });
    }catch(e){}})();`;
    let pending;
    try { pending = webview.executeJavaScript(js); } catch { return; }
    Promise.resolve(pending).then((asked) => {
      if (asked !== 'focus' || !account) return;
      // A page filled twice (a route change) has two listeners; one click
      // answers both. One refill, and only that one wires a new listener.
      if (webview._vexTotpRefilling) return;
      webview._vexTotpRefilling = true;
      return this._refill(webview, url, account).finally(() => { webview._vexTotpRefilling = false; });
    }).catch(() => {});
  },

  // The emptied field was clicked: the current code, never the one from before.
  async _refill(webview, url, account) {
    if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview)) return;
    let origin = '';
    try { origin = new URL(url).origin; } catch { return; }
    const here = () => { try { return webview.isConnected !== false && new URL(webview.getURL()).origin === origin; } catch { return false; } };
    if (!here()) return;
    let codes = [];
    try { codes = await window.vex.totpCodes(); }
    catch (err) { console.error('[TOTP] could not read the current code:', err.message); return; }
    const entry = (codes || []).find((x) => x.id === account.id);
    const code = entry && entry.code;
    if (!code || !/^\d{4,8}$/.test(code) || !here()) return;
    this._inject(webview, code, url, account);
  },
};

if (typeof window !== 'undefined') window.TotpAutofill = TotpAutofill;
if (typeof module !== 'undefined' && module.exports) module.exports = { TotpAutofill };
