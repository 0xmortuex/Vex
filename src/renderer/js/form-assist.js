// === Form assistant with a confirm for every field (T3-109) =========================
//
// Form Fill (js/form-fill.js) fills a whole form from one saved profile in one go. This is
// the careful version for forms that matter: it READS the form in front of you (the kind
// of each box, never what is typed in it), PROPOSES a value for each box from your own Form
// Fill profile, shows the whole list, and puts a value into a box only when you press that
// box's own Fill button. One press, one box.
//
//   Fills:      name, email, phone, street, city, region, postcode, country, from your Form Fill
//               profile (stored on this computer, never sent anywhere).
//   Never fills: passwords, card numbers and codes, one-time codes, national ID or tax numbers,
//               IBANs. These are listed as "type it yourself" and no value is ever offered, because
//               Vex does not keep them here.
//   Never:      submits, clicks a button, presses Enter, solves anything, or sends the form or its
//               fields to an AI or any server. Only on https pages, only into an empty box, and only
//               a box that is still the same box you were shown.
//
// Off until you switch it on.
const VexFormAssist = {
  ENABLED_KEY: 'vex.formAssist.enabled',
  FEATURE: 'form-assist',
  MAX_FIELDS: 80,

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[FormAssist] the switch could not be read:', err); return false; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  // ---- pure: what kind of box is this? --------------------------------------------------------------
  // field: { type, name, id, ac, label, ph, aria }. -> { cls, fact } . cls starting with "sensitive:" is never filled.
  SENSITIVE: [
    ['sensitive:card', /card.?(number|no)|cc-?(num|number|csc|exp|name|type)|cvv|cvc|csc\b|security.?code|expir|kart.?(no|numar)|kredi/i],
    ['sensitive:otp', /one.?time|otp\b|2fa|two.?factor|verification.?code|sms.?code|auth(entication)?.?code|dogrulama|doğrulama|onay.?kodu/i],
    ['sensitive:national-id', /national.?id|identity.?(no|number)|\bssn\b|social.?security|tax.?(id|number)|tc.?kimlik|tckn|kimlik.?(no|numar)|vergi.?(no|numar)|passport.?(no|number)|pasaport.?(no|numar)|\biban\b|account.?number/i],
  ],
  RULES: [
    ['email', /e-?mail|e-?posta/i, 'email'],
    ['tel', /phone|\btel\b|mobile|telefon|gsm|cep/i, 'phone'],
    ['givenname', /given.?name|first.?name|fname|forename|\bad[ıi]\b|^name$/i, 'firstName'],
    ['familyname', /family.?name|last.?name|lname|surname|soyad/i, 'lastName'],
    ['notperson', /company|organi[sz]ation|business|employer|user.?name|nick.?name|display.?name|login|file.?name|domain|product|project|team|group|pet/i, null],
    ['name', /full.?name|your.?name|\bname\b|ad.?soyad/i, 'fullName'],
    ['street', /street|address.?line.?1|addr(ess)?1|address$|^address|adres/i, 'address'],
    ['city', /city|town|locality|\bil\b|\bsehir\b|şehir|ilce|ilçe/i, 'city'],
    ['region', /state|province|region|county/i, 'region'],
    ['zip', /zip|postal|post.?code|posta.?kodu/i, 'zip'],
    ['country', /country|\bulke\b|ülke/i, 'country'],
  ],
  classify(field) {
    const f = field || {};
    const type = String(f.type || '').toLowerCase();
    if (type === 'password') return { cls: 'sensitive:password', fact: null };
    const ac = String(f.ac || '').toLowerCase();
    if (/^cc-|one-time-code|new-password|current-password/.test(ac)) return { cls: ac === 'one-time-code' ? 'sensitive:otp' : (/password/.test(ac) ? 'sensitive:password' : 'sensitive:card'), fact: null };
    const hay = [f.name, f.id, f.ac, f.label, f.ph, f.aria].map(x => String(x || '')).join(' ');
    for (const [cls, re] of this.SENSITIVE) if (re.test(hay)) return { cls, fact: null };
    if (type === 'email') return { cls: 'email', fact: 'email' };
    if (type === 'tel') return { cls: 'tel', fact: 'phone' };
    // autocomplete tokens are the page's own statement of what the box is: trust them first.
    const token = { 'email': 'email', 'tel': 'phone', 'given-name': 'firstName', 'family-name': 'lastName', 'name': 'fullName', 'street-address': 'address', 'address-line1': 'address', 'address-level2': 'city', 'address-level1': 'region', 'postal-code': 'zip', 'country-name': 'country', 'country': 'country' }[ac.split(/\s+/).pop()];
    if (token) return { cls: ac, fact: token };
    for (const [cls, re, fact] of this.RULES) if (re.test(hay)) return { cls, fact };
    return { cls: 'unknown', fact: null };
  },
  // The profile with first/last filled in from the full name when they are not set. Nothing is invented.
  facts(profile) {
    const p = { ...(profile || {}) };
    if (p.fullName && (!p.firstName || !p.lastName)) {
      const parts = String(p.fullName).trim().split(/\s+/);
      p.firstName = p.firstName || parts[0];
      p.lastName = p.lastName || parts.slice(1).join(' ');
    }
    return p;
  },
  // fields: scan results. -> [{ idx, label, cls, state: 'propose'|'filled'|'sensitive'|'no-fact'|'unknown', value, source }]
  propose(fields, profile) {
    const facts = this.facts(profile);
    const rows = [];
    for (const f of fields.slice(0, this.MAX_FIELDS)) {
      const label = String(f.label || f.aria || f.ph || f.name || f.id || f.type || 'field').replace(/\s+/g, ' ').trim().slice(0, 80);
      const c = this.classify(f);
      let state, value = '';
      if (c.cls.startsWith('sensitive:')) state = 'sensitive';
      else if (f.hasValue || f.disabled || f.readOnly) state = 'filled';
      else if (!c.fact) state = 'unknown';
      else if (!facts[c.fact]) state = 'no-fact';
      else { state = 'propose'; value = String(facts[c.fact]); }
      rows.push({ idx: f.i, label, cls: c.cls, fact: c.fact, state, value, sig: [f.tag, f.type, f.name, f.id].join('|'), source: state === 'propose' ? 'Form Fill profile' : '' });
    }
    return rows;
  },
  // A page we may put a value into: https, or this computer.
  pageOk(url) {
    let u;
    try { u = new URL(String(url)); } catch { return false; }
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  },

  // ---- the page side: two fixed scripts -------------------------------------------------------------
  // Read-only. Describes the visible boxes; never reads a value (only whether one is there).
  SCAN_JS: `(function(){try{
    function vis(el){try{var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}catch(e){return false;}}
    var out=[];var list=document.querySelectorAll('input, textarea, select');
    for(var i=0;i<list.length;i++){var el=list[i];var t=(el.type||'').toLowerCase();
      if(t==='hidden'||t==='submit'||t==='button'||t==='reset'||t==='image'||t==='file'||t==='checkbox'||t==='radio'||t==='range'||t==='color')continue;
      if(!vis(el))continue;
      var lab='';try{if(el.labels&&el.labels[0])lab=el.labels[0].textContent||'';}catch(e){}
      out.push({i:i,tag:el.tagName.toLowerCase(),type:t,name:el.name||'',id:el.id||'',ac:el.getAttribute('autocomplete')||'',label:String(lab).slice(0,80),ph:el.placeholder||'',aria:el.getAttribute('aria-label')||'',hasValue:t==='password'?false:!!el.value,disabled:!!el.disabled,readOnly:!!el.readOnly});
      if(out.length>=200)break;}
    return JSON.stringify(out);
  }catch(e){return '[]';}})()`,
  // One box. Checks it is still the same box and still empty; sets the value; fires input and change. Never focuses
  // anything else, clicks, or submits. -> 'ok' | 'moved' | 'full' | 'blocked' | 'error'
  fillScript(row, value) {
    return `(function(){try{
      var list=document.querySelectorAll('input, textarea, select');var el=list[${Number(row.idx)}];
      if(!el)return 'moved';
      var sig=[el.tagName.toLowerCase(),(el.type||'').toLowerCase(),el.name||'',el.id||''].join('|');
      if(sig!==${JSON.stringify(row.sig)})return 'moved';
      var t=(el.type||'').toLowerCase();
      if(t==='password'||t==='hidden'||t==='file'||el.disabled||el.readOnly)return 'blocked';
      if(el.value)return 'full';
      var proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:(el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype);
      var setter=Object.getOwnPropertyDescriptor(proto,'value').set;
      setter.call(el,${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
      return el.value===${JSON.stringify(String(value))}?'ok':'error';
    }catch(e){return 'error';}})()`;
  },

  _webview() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return null;
    return WebviewManager.getActiveWebview ? WebviewManager.getActiveWebview() : WebviewManager.webviews.get(TabManager.activeTabId);
  },

  // ---- the screen ---------------------------------------------------------------------------------------------
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  async open() {
    if (!this.enabled()) throw new Error('The form assistant is switched off in Settings');
    const wv = this._webview();
    if (!wv) throw new Error('Open a page with a form first');
    const url = typeof wv.getURL === 'function' ? wv.getURL() : '';
    if (!this.pageOk(url)) throw new Error('The form assistant only works on secure (https) pages');
    if (typeof FormFill === 'undefined') throw new Error('The Form Fill profile is not loaded');
    const profile = FormFill._load();
    if (!Object.values(profile).some(Boolean)) throw new Error('Your Form Fill profile is empty. Fill it in first (Ctrl+K > Form Fill).');
    const raw = await wv.executeJavaScript(this.SCAN_JS);
    const fields = JSON.parse(raw);
    if (!fields.length) throw new Error('No form boxes found on this page');
    const rows = this.propose(fields, profile);
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const { body } = VexSettingsGroups.dialog({ id: 'form-assist', title: 'Form assistant', sub: 'Press Fill on a box to put the value in it. Nothing is filled or sent until you do, and the form is never submitted. ' + host });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const NOTE = { sensitive: 'Type this yourself. Vex never fills or stores it.', 'no-fact': 'Nothing saved for this in your profile.', filled: 'Already has something in it.', unknown: 'Vex does not know what this box is.' };
    for (const r of rows) {
      const card = this._el('div', 'ad-page');
      const head = this._el('div', 'ad-head');
      head.append(this._el('strong', '', r.label), this._el('span', 'ad-state', r.state === 'propose' ? r.cls : (NOTE[r.state] ? '' : r.state)));
      card.appendChild(head);
      if (r.state !== 'propose') { card.appendChild(this._el('div', 'ad-url', NOTE[r.state] || '')); body.appendChild(card); continue; }
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'set-input'; input.value = r.value; input.autocomplete = 'off';
      input.setAttribute('aria-label', 'Value for ' + r.label);
      const status = this._el('span', 'ad-state', 'from ' + r.source);
      const btn = this._el('button', 'btn-secondary', 'Fill'); btn.type = 'button';
      btn.setAttribute('aria-label', 'Fill ' + r.label);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const v = input.value;
          if (!v) throw new Error('There is nothing to fill');
          const res = await wv.executeJavaScript(this.fillScript(r, v));
          const msg = { ok: 'Filled', moved: 'The form changed, so this box was left alone. Reopen the assistant.', full: 'The box already has something in it, so it was left alone.', blocked: 'That box cannot be filled.', error: 'The box did not take the value.' }[res] || 'Not filled';
          status.textContent = msg;
          if (res === 'ok') { input.disabled = true; } else btn.disabled = false;
        } catch (err) { fail(err); btn.disabled = false; }
      });
      const row = this._el('div', 'ad-actions');
      row.append(input, btn, status);
      card.appendChild(row);
      body.appendChild(card);
    }
    body.appendChild(this._el('p', 'setting-info', 'Values come from Ctrl+K > Form Fill (your profile on this computer). Passwords, cards, codes and ID numbers are never filled. Nothing is sent to an AI or a server.'));
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('formassist:', this.enabled() ? [
      { id: 'formassist:open', label: 'Form assistant (confirm each field)', icon: 'file', hint: 'Propose values from your profile for this form, one box at a time', action: () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); } },
    ] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Looks at the form in front of you and proposes a value for each box from your Form Fill profile. A value goes in only when you press Fill on that box. Passwords, cards, one-time codes and ID numbers are never filled, the form is never submitted, and nothing is sent to an AI or a server.'));
    body.appendChild(S.toggle('Form assistant', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); }, 'Ctrl+K > Form assistant'));
  },
};

if (typeof window !== 'undefined') {
  window.VexFormAssist = VexFormAssist;
  VexFormAssist.registerCommands();
  document.addEventListener('DOMContentLoaded', () => VexFormAssist.registerCommands());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'form-assist', title: 'Form assistant', keywords: 'form autofill address checkout confirm field profile', before: 'about', render: (body) => VexFormAssist.settingsRows(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFormAssist };
