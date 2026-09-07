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
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
    const generation = webview._navigationGeneration;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
    if (!host || !/^https:/i.test(url)) return;

    let list = [];
    try { list = await window.vex.totpList(); } catch { return; }
    if (!list || !list.length) return;

    const matches = list.map((a) => ({ account: a, kind: this._matchKind(a, host) })).filter((m) => m.kind);
    if (!matches.length) return;
    let match = matches[0];
    if (matches.length > 1) {
      // Several saved accounts claim this site. Filling an arbitrary one silently
      // is worse than asking, so let the user pick (recommendation 31).
      if (!window.vexPrompt) return;
      const choice = await window.vexPrompt({
        title: 'Choose an authenticator account',
        message: matches.map((m, i) => `${i + 1}. ${m.account.issuer || ''} ${m.account.label || ''}`.trim()).join(String.fromCharCode(10)),
        label: 'Account number', value: '',
      });
      const index = Number(choice) - 1;
      if (choice === null || !Number.isInteger(index) || index < 0 || index >= matches.length) return;
      match = matches[index];
    }
    if (match.kind === 'label') {
      // Only ask about a site once it is actually showing a 2FA field. Prompting
      // on every page load of the site would be intolerable.
      if (!(await this._hasOtpField(webview, url))) return;
      // The issuer happens to equal this site's registrable label. That is a good
      // guess but an attacker can arrange it, so confirm once and remember.
      if (!window.vexConfirm) return;
      const name = String(match.account.issuer || match.account.label || '').trim();
      const ok = await window.vexConfirm({
        title: 'Fill your 2FA code here?',
        message: name ? `Use your "${name}" authenticator code on ${host}?` : `Use your saved authenticator code on ${host}?`,
        okLabel: 'Fill code',
      });
      this._bind(match.account, host, ok);
      if (!ok) return;
      if (generation !== webview._navigationGeneration || (webview.getURL && webview.getURL() !== url)) return;
    }
    const chosen = [match.account];

    let codes = [];
    try { codes = await window.vex.totpCodes(); } catch { return; }
    const entry = codes.find((x) => x.id === chosen[0].id);
    const code = entry && entry.code;
    if (!code || !/^\d{4,8}$/.test(code)) return;
    if (generation !== webview._navigationGeneration || (webview.getURL && webview.getURL() !== url)) return;
    this._inject(webview, code, url);
    try { window.AutofillLog?.record('totp', url, true, chosen[0].issuer || chosen[0].label); } catch {}
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
  _inject(webview, code, url) {
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
      // 2FA fields often render a beat after load — retry briefly, and re-fill on
      // focus (click-to-fill), always only into an empty field.
      var n=0;var iv=setInterval(function(){if(fill()||++n>8)clearInterval(iv);},400);
      if(!window.__vexTotpFocusWired){window.__vexTotpFocusWired=true;
        document.addEventListener('focusin',function(e){try{var el=e.target;if(el&&el.tagName==='INPUT'&&!el.value&&isOtp(el)){setTimeout(fill,0);}}catch(e){}},true);
      }
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },
};

if (typeof window !== 'undefined') window.TotpAutofill = TotpAutofill;
if (typeof module !== 'undefined' && module.exports) module.exports = { TotpAutofill };
