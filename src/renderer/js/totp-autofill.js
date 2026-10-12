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
//
// WHEN it looks: on a sign-in flow it polls for the field for a minute; on any
// other page of a site that has a saved account it WATCHES the page instead
// (one MutationObserver, no polling), because a 2FA modal opens on the same
// address in the middle of a logged-in session (Roblox's "2-Step Verification"
// when you change a group's owner) and neither dom-ready nor a navigation ever
// fires again. Found 2026-10-12: the old code looked once at page load, saw no
// password box or 2FA wording, and gave up for good.

// The page-side field detector, written as a real function so it is linted and
// unit-tested, then injected into the page as its source (fn.toString()). Every
// injected script - the "is there a code field" probe, the filler, the watcher
// and the manual "Fill code from authenticator" - uses this one copy, so they
// can never disagree about what a one-time-code field is.
//
// A field counts when it is a visible, enabled text / number / tel input AND
//   - it says autocomplete="one-time-code", or
//   - its name, id, aria-label, title, placeholder, its <label> text or the
//     words right around it carry clear one-time-code wording ("verification
//     code", "authenticator", "2-step", "6-digit", "OTP"...), or
//   - it is labelled with a bare "code"/"digits" and the dialog, form or page
//     it sits in is plainly a 2FA screen (so a promo box on a shop page is not).
// A search box, a combobox and a coupon/promo/gift box never count unless the
// page says autocomplete="one-time-code". Fields in open shadow roots count.
function vexTotpDetector() {
  var STRONG = /otp|2fa|two.?factor|two.?step|2.?step|totp|mfa|authenticator|one.?time|verification.?code|security.?code|passcode|auth.?code|\b(?:6|six|8|eight)[ -]?digits?\b|login.?code|confirmation.?code/;
  var STRONG_TEXT = /\botp\b|\b2fa\b|two.?factor|two.?step|\b2.?step\b|\btotp\b|\bmfa\b|authenticator|one.?time|verification.?code|security.?code|passcode|auth.?code|\b(?:6|six|8|eight)[ -]?digits?\b|login.?code|confirmation.?code/;
  var BARE = /\bcode\b|\bdigits?\b/;
  var SCREEN = /two.?factor|two.?step|2.?step|authenticat|verify your|verification code|one.?time|2fa|enter the (code|digits)|\b(?:6|six)[ -]?digit/i;
  var NOT_CODE = /search|coupon|promo|voucher|discount|gift|referral|invite|redeem|zip|postal|captcha/;
  // Fields that are plainly about something else, even inside a 2FA dialog.
  var OTHER = /e-?mail|user|name|phone|address|city|comment|message|device/;
  function text(value, max) { return String(value || '').toLowerCase().replace(/\s+/g, ' ').slice(0, max || 160); }
  function labelsOf(el) {
    var out = '';
    try {
      var list = el.labels ? Array.prototype.slice.call(el.labels) : [];
      for (var i = 0; i < list.length; i++) out += ' ' + (list[i].textContent || '');
      var by = el.getAttribute('aria-labelledby');
      if (by) by.split(/\s+/).forEach(function (id) { var n = el.ownerDocument.getElementById(id); if (n) out += ' ' + (n.textContent || ''); });
    } catch (e) { /* a label that cannot be read is no label */ }
    return text(out, 200);
  }
  function meta(el) {
    return text([el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('title'), el.placeholder].join(' '), 300);
  }
  // The words just around a field: the first ancestor (up to three up) that has
  // any text of its own besides the field.
  function near(el) {
    var p = el.parentElement;
    for (var i = 0; i < 3 && p && p !== el.ownerDocument.body; i++, p = p.parentElement) {
      var t = text(p.textContent, 300);
      if (t.length >= 3) return t;
    }
    return '';
  }
  function scopeText(el) {
    try {
      var scope = el.closest('[role=dialog],[aria-modal=true],dialog,form') || el.ownerDocument.body;
      return String(scope.innerText || scope.textContent || '');
    } catch (e) { return ''; }
  }
  function vis(el) {
    try {
      var r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (el.disabled || el.readOnly || el.closest('[inert]')) return false;
      if (el.form && new URL(el.form.action || location.href, location.href).origin !== location.origin) return false;
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    } catch (e) { return false; }
  }
  function textual(el) {
    var t = (el.type || '').toLowerCase();
    return t === '' || t === 'text' || t === 'tel' || t === 'number';
  }
  function isOtp(el) {
    if (!el || el.tagName !== 'INPUT' || !textual(el) || !vis(el)) return false;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac === 'one-time-code') return true;
    var role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'combobox' || role === 'searchbox' || el.getAttribute('aria-autocomplete')) return false;
    var m = meta(el), label = labelsOf(el), around = near(el);
    if (NOT_CODE.test(m) || NOT_CODE.test(label)) return false;
    // Attribute values are short identifiers (name="emailOtp"), so the loose
    // pattern is fine there; in running text it would match "footprint".
    if (STRONG.test(m) || STRONG_TEXT.test(label)) return true;
    if (STRONG_TEXT.test(around) && !NOT_CODE.test(around) && !OTHER.test(m + ' ' + label)) return true;
    return (BARE.test(m) || BARE.test(label)) && SCREEN.test(scopeText(el));
  }
  function inputs() {
    var out = [], seen = 0;
    (function walk(root) {
      var list = root.querySelectorAll('input');
      for (var i = 0; i < list.length; i++) out.push(list[i]);
      var all = root.querySelectorAll('*');
      for (var j = 0; j < all.length && seen < 6000; j++, seen++) { if (all[j].shadowRoot) walk(all[j].shadowRoot); }
    })(document);
    return out;
  }
  // A row of one-character boxes (a React OTP input) on a 2FA screen.
  function boxes(all) {
    var list = all.filter(function (el) {
      var im = (el.getAttribute('inputmode') || '').toLowerCase(), t = (el.type || '').toLowerCase();
      return textual(el) && vis(el) && el.maxLength === 1 && (t === 'tel' || t === 'number' || im === 'numeric' || /^\d?$/.test(el.value || ''));
    });
    return list.length >= 4 && SCREEN.test(String(document.body.innerText || document.body.textContent || '')) ? list : [];
  }
  function fields() {
    var all = inputs();
    return { single: all.filter(isOtp), boxes: boxes(all) };
  }
  function hasField() { var f = fields(); return f.single.length > 0 || f.boxes.length > 0; }
  return { vis: vis, isOtp: isOtp, fields: fields, hasField: hasField, textual: textual };
}

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

  // The page-side detector as source, for the injected scripts and the tests.
  _detectorSource() { return vexTotpDetector.toString(); },

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
    // A site the person set for this account (they confirmed it, or picked this
    // account for the site by hand) matches whatever the site's name is.
    const bound = this._bindingFor(account, host);
    if (bound === true) return 'bound';
    if (bound === false) return null;
    const site = this._label(host);
    if (!site || !this._names(account).has(site)) return null;
    return 'label';
  },

  // The accounts that claim this host: [{ account, kind }].
  _matchesFor(list, host) {
    return (list || []).map((a) => ({ account: a, kind: this._matchKind(a, host) })).filter((m) => m.kind);
  },

  async autofill(webview, url) {
    if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview)) return;
    const generation = webview._navigationGeneration;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
    if (!host || !/^https:/i.test(url)) return;

    let list = [];
    try { list = await window.vex.totpList(); } catch { return; }
    this._noteAccounts(list);
    if (!list || !list.length) return;

    const matches = this._matchesFor(list, host);
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
        // Only POLL on a page that plausibly leads to a 2FA step. Any other page
        // of the site is watched instead (below): a 2FA modal can open in the
        // middle of a logged-in session, on the same address, with no load.
        if (i === 0 && !(await this._looksLikeAuthFlow(webview, url))) break;
        await new Promise((resolve) => setTimeout(resolve, this.WAIT_INTERVAL_MS));
      }
      if (!here()) return;
      if (!ready) { this._watch(webview, url, host); return; }
      await this._fill(webview, url, host, matches);
    } finally {
      webview._vexTotpPolling = false;
    }
  },

  // Wait, without polling, for a code field to appear on this page (or for the
  // person to click into an empty one), then fill it and wait again. The page
  // side is one MutationObserver in the page's own world plus a trusted-focus
  // listener; it resolves 'present' or 'focus', or 'dup' when this document is
  // already being watched. It fires only on a field APPEARING (or a click), so
  // a field the person dismissed is not filled again in a loop, and a page's
  // own script cannot make Vex fill anything it could not already: the site
  // matched an account, the field is on that site's own origin, and a click
  // needs real user activation.
  _watch(webview, url, host) {
    let origin = '';
    try { origin = new URL(url).origin; } catch { return; }
    const js = `(function(){try{
      if(location.origin!==${JSON.stringify(origin)})return 'origin';
      var KEY=Symbol.for('vex.totp.watch');
      if(document[KEY])return 'dup';
      var TOKEN={};
      document[KEY]=TOKEN;
      var D=(${vexTotpDetector.toString()})();
      return new Promise(function(resolve){
        var had=false;try{had=D.hasField();}catch(e){}
        var timer=0,done=false;
        function finish(why){if(done)return;done=true;try{mo.disconnect();}catch(e){}document.removeEventListener('focusin',onFocus,true);try{if(document[KEY]===TOKEN)delete document[KEY];}catch(e){}resolve(why);}
        // The marker is what says "this document is watched": if it is gone
        // (the page cleared it) this watcher has been replaced, so it ends.
        function check(){if(done)return;if(document[KEY]!==TOKEN){finish('gone');return;}var now=false;try{now=D.hasField();}catch(e){}if(now&&!had){finish('present');return;}had=now;}
        function schedule(){clearTimeout(timer);timer=setTimeout(check,150);setTimeout(check,700);}
        function onFocus(e){try{
          if(!e.isTrusted||!(navigator.userActivation&&navigator.userActivation.isActive))return;
          var el=e.target;if(el&&el.tagName==='INPUT'&&!el.value&&D.isOtp(el))finish('focus');
        }catch(x){}}
        var mo=new MutationObserver(schedule);
        mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open','inert','type','placeholder','aria-label']});
        document.addEventListener('focusin',onFocus,true);
      });
    }catch(e){return 'error';}})();`;
    let pending;
    try { pending = webview.executeJavaScript(js); } catch { return; }
    Promise.resolve(pending).then(async (why) => {
      if (why !== 'present' && why !== 'focus') return;
      if (webview.isConnected === false) return;
      let current = url;
      try { current = webview.getURL() || url; } catch { return; }
      let list = [];
      try { list = await window.vex.totpList(); } catch { return; }   // locked: the lock screen is up
      const matches = this._matchesFor(list, host);
      if (matches.length && !webview._vexTotpFilling) {
        webview._vexTotpFilling = true;
        try { await this._fill(webview, current, host, matches); }
        finally { webview._vexTotpFilling = false; }
      }
      this._watch(webview, current, host);
    }).catch((err) => {
      // A page that navigated away takes its watcher with it: that is not a failure.
      let same = false;
      try { same = webview.isConnected !== false && new URL(webview.getURL()).origin === origin; } catch { same = false; }
      if (same) console.error('[TOTP] could not watch the page for a code field:', err && err.message);
    });
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
  _pickAccount(matches, host, opts = {}) {
    return new Promise((resolve) => {
      document.getElementById('vex-totp-pick')?.remove();
      const prevFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.id = 'vex-totp-pick';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100052;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'Outfit\',sans-serif';
      overlay.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="vex-totp-pick-title" style="width:340px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div id="vex-totp-pick-title" style="padding:16px 18px 8px;font-size:13.5px;font-weight:700;color:var(--text)"></div>
        <div data-host style="padding:0 18px 10px;font-size:11.5px;color:var(--text-muted)"></div>
        <div data-list style="max-height:46vh;overflow-y:auto;padding:0 10px 10px"></div>
        <div style="padding:10px 18px 16px;display:flex;justify-content:flex-end"><button type="button" data-cancel style="padding:7px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px"></button></div>
      </div>`;
      overlay.querySelector('#vex-totp-pick-title').textContent = opts.title || this._t('totpWhich', "Which account's code?");
      overlay.querySelector('[data-cancel]').textContent = this._t('totpNotNow', 'Not now');
      overlay.querySelector('[data-host]').textContent = opts.hint || (this._t('totpCodesFor', 'Authenticator codes for') + ' ' + host);
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
      return (${vexTotpDetector.toString()})().hasField();
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
      var D=(${vexTotpDetector.toString()})();
      function fire(el,val){try{if(location.origin!==ORIGIN||!D.vis(el))return;el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}
      // A genuine one-time-code field, by the shared detector (vexTotpDetector):
      // autocomplete one-time-code, clear 2FA wording on the field, its label or
      // the words around it, or a bare "code" on a plainly-2FA dialog or page.
      function isOtp(el){return D.isOtp(el);}
      function fill(){
        if(location.origin!==ORIGIN)return false;
        var f=D.fields();
        // Split-box case: a row of one-character boxes (React OTP). Only on a page
        // that clearly IS a 2FA screen, to avoid unrelated 1-char inputs.
        var boxes=f.boxes;
        if(boxes.length>=DIGITS.length&&boxes.length<=DIGITS.length+2){
          var empty=boxes.filter(function(b){return !b.value;});
          if(empty.length>=DIGITS.length){for(var i=0;i<DIGITS.length;i++){fire(boxes[i],DIGITS[i]);}return true;}
        }
        // Single-field case.
        for(var j=0;j<f.single.length;j++){if(!f.single[j].value){fire(f.single[j],CODE);return true;}}
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

  // --- "Fill code from authenticator", on request ---------------------------
  // The right-click row, Ctrl+K and the shortcut all land here. Unlike the
  // automatic fill this is the person asking, so it needs no second question:
  // it fills the field they right-clicked (or have focused, or the first code
  // field on the page) with the current code of the account that belongs to the
  // site, asks which one when several do, and when none does says so and lets
  // them pick ANY account (remembering that choice for the site, which is what
  // makes the automatic fill work there next time).

  // What the last look at the account list found: null until it was looked at.
  // Only for deciding whether a menu row is worth showing; the action itself
  // always reads the list afresh.
  _accounts: null,
  _noteAccounts(list) { this._accounts = Array.isArray(list) ? list.slice() : null; },
  forgetAccounts() { this._accounts = null; },
  // Ask for the list in the background so the next menu knows.
  refreshAccounts() {
    if (!window.vex || typeof window.vex.totpList !== 'function') return;
    Promise.resolve(window.vex.totpList()).then((l) => this._noteAccounts(l), () => { /* locked */ });
  },
  // Show the menu row? Yes unless the list is known to be empty; and on a
  // field that is not editable (the person right-clicked the dialog's text) only
  // when an account is known to belong to this site.
  shouldOfferMenuRow(webview, editable) {
    if (!webview || (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview))) return false;
    let url = '';
    try { url = webview.getURL(); } catch { return false; }
    if (!/^https:/i.test(url)) return false;
    if (this._accounts === null) return !!editable;
    if (!this._accounts.length) return false;
    if (editable) return true;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return false; }
    return this._matchesFor(this._accounts, host).length > 0;
  },

  _t(key, fallback) { return (window.VexI18n && window.VexI18n.t(key, fallback)) || fallback; },

  // -> { ok: true, account } or { ok: false, reason }. Says why in a toast.
  async fillFromAuthenticator(webview, opts = {}) {
    const say = (message, kind) => { try { window.showToast?.(message, kind); } catch { /* no toast host */ } };
    const refuse = (reason, message, kind = 'error') => { say(message, kind); return { ok: false, reason }; };
    if (!webview) return refuse('no-page', this._t('totpOpenPage', 'Open a web page first'));
    if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview)) {
      return refuse('private', this._t('totpPrivate', 'Authenticator codes are never filled in a private or Tor tab'));
    }
    let url = '', host = '';
    try { url = webview.getURL(); host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* handled below */ }
    if (!host || !/^https:/i.test(url)) {
      return refuse('not-https', this._t('totpHttps', 'Authenticator codes are only filled on secure (https) pages'));
    }
    let list = [];
    try { list = await window.vex.totpList(); }
    catch (err) {
      return refuse('locked', /locked/i.test(String(err && err.message))
        ? this._t('totpLocked', 'Vex is locked: unlock it, then try again')
        : this._t('totpListFailed', 'Could not read your authenticator accounts: ') + (err && err.message));
    }
    this._noteAccounts(list);
    if (!list || !list.length) {
      return refuse('no-accounts', this._t('totpNoAccounts', 'No authenticator accounts yet: add one in the Authenticator panel first'), 'info');
    }
    const origin = new URL(url).origin;
    const here = () => { try { return webview.isConnected !== false && new URL(webview.getURL()).origin === origin; } catch { return false; } };

    let matches = this._matchesFor(list, host);
    let account = null;
    let chosenByHand = false;
    if (matches.length === 1) account = matches[0].account;
    else if (matches.length > 1) {
      const picked = await this._pickAccount(matches, host);
      if (!picked) return { ok: false, reason: 'cancelled' };
      account = picked.account;
    } else {
      // None belongs to this site: say so, and let the person pick any account.
      const all = list.map((a) => ({ account: a, kind: 'manual' }));
      const picked = await this._pickAccount(all, host, {
        title: this._t('totpNoneHere', 'No authenticator account for this site'),
        hint: this._t('totpPickAny', 'Pick the account to use on {host}. It is remembered for this site.').replace('{host}', host),
      });
      if (!picked) return { ok: false, reason: 'cancelled' };
      account = picked.account;
      chosenByHand = true;
    }
    if (!here()) return { ok: false, reason: 'moved' };

    let codes = [];
    try { codes = await window.vex.totpCodes(); }
    catch (err) { return refuse('codes', this._t('totpCodesFailed', 'Could not read the code: ') + (err && err.message)); }
    const entry = (codes || []).find((x) => x.id === account.id);
    const code = entry && entry.code;
    if (!code || !/^\d{4,8}$/.test(code)) return refuse('no-code', this._t('totpNoCode', 'That account has no code right now'));
    if (!here()) return { ok: false, reason: 'moved' };

    const result = await this._injectNow(webview, code, url, opts);
    if (result !== 'filled') {
      return refuse('no-field', this._t('totpNoField', 'No code field found on this page: click into the field and try again'), 'info');
    }
    // The person asked for this account on this site, so it is theirs for the
    // site from now on (the automatic fill honours it).
    if (chosenByHand || matches.some((m) => m.account.id === account.id && m.kind === 'label')) this._bind(account, host, true);
    try { window.AutofillLog?.record('totp', url, true, account.issuer || account.label); } catch { /* the log is optional */ }
    const name = String(account.issuer || account.label || '').trim();
    say((this._t('totpFilled', 'Authenticator code filled') + (name ? ' (' + name + ')' : '')) + (chosenByHand ? '. ' + this._t('totpRemembered', 'Remembered for this site') : ''));
    return { ok: true, account };
  },

  // Fill NOW, once, the field the person means: the one under the cursor when
  // they right-clicked, else the focused one, else the first code field.
  // -> 'filled' | 'nofield'. No listeners are left behind.
  async _injectNow(webview, code, url, opts = {}) {
    let origin = '';
    try { origin = new URL(url).origin; } catch { return 'nofield'; }
    const point = (opts && Number.isFinite(opts.x) && Number.isFinite(opts.y)) ? { x: opts.x, y: opts.y } : null;
    const js = `(function(){try{
      var ORIGIN=${JSON.stringify(origin)};
      if(location.origin!==ORIGIN)return 'nofield';
      var CODE=${JSON.stringify(code)};
      var D=(${vexTotpDetector.toString()})();
      var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
      function put(el,val){el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
      var POINT=${JSON.stringify(point)};
      var target=null;
      function usable(el){return el&&el.tagName==='INPUT'&&D.textual(el)&&D.vis(el);}
      if(POINT){try{var at=document.elementFromPoint(POINT.x,POINT.y);if(usable(at))target=at;}catch(e){}}
      if(!target&&usable(document.activeElement))target=document.activeElement;
      if(target){put(target,CODE);return 'filled';}
      var f=D.fields();
      var digits=CODE.split('');
      if(f.boxes.length>=digits.length&&f.boxes.length<=digits.length+2){for(var i=0;i<digits.length;i++)put(f.boxes[i],digits[i]);return 'filled';}
      var first=null;for(var j=0;j<f.single.length;j++){if(!f.single[j].value){first=f.single[j];break;}}
      if(!first)first=f.single[0]||null;
      if(first){put(first,CODE);return 'filled';}
      return 'nofield';
    }catch(e){return 'nofield';}})();`;
    try { return await webview.executeJavaScript(js); } catch { return 'nofield'; }
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
