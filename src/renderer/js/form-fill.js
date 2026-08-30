// === Vex Universal Form Fill ===
// Password autofill handles logins; this fills the OTHER fields every signup and
// checkout asks for — name, email, phone, address — from one saved profile,
// matched to fields by autocomplete/name/label. Deliberately does NOT store card
// numbers. Profile lives in localStorage 'vex.fillProfile' (local only).
const FormFill = {
  KEY: 'vex.fillProfile',
  FIELDS: [
    ['fullName', 'Full name'], ['firstName', 'First name'], ['lastName', 'Last name'],
    ['email', 'Email'], ['phone', 'Phone'], ['address', 'Street address'],
    ['city', 'City'], ['region', 'State / region'], ['zip', 'ZIP / postcode'], ['country', 'Country'],
  ],
  _load() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { return {}; } },
  _save(p) { try { localStorage.setItem(this.KEY, JSON.stringify(p)); } catch {} },

  open() {
    document.getElementById('vex-formfill')?.remove();
    const p = this._load();
    const has = Object.values(p).some(Boolean);
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const m = document.createElement('div');
    m.id = 'vex-formfill';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:460px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 18px 8px"><span style="font-size:14px;font-weight:700;color:var(--text);flex:1">🧾 Form Fill profile</span><button id="ff-close" style="${this._chip()}">✕</button></div>
      <div style="padding:0 18px 6px;font-size:11.5px;color:var(--text-muted)">Saved locally. Used to fill signup/checkout forms — never card numbers, never sent anywhere.</div>
      <div style="overflow-y:auto;padding:10px 18px">${this.FIELDS.map(([k, label]) => `
        <label style="display:block;margin-bottom:8px">
          <span style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px">${esc(label)}</span>
          <input data-k="${k}" value="${esc(p[k] || '')}" style="width:100%;box-sizing:border-box;padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12.5px;font-family:'Outfit',sans-serif">
        </label>`).join('')}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border)">
        <button id="ff-save" style="${this._chip()}">Save profile</button>
        <button id="ff-fill" ${has ? '' : 'disabled'} style="${this._primary()};${has ? '' : 'opacity:.5;cursor:default'}">Fill this form</button>
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#ff-close').addEventListener('click', () => m.remove());
    const collect = () => { const o = {}; m.querySelectorAll('input[data-k]').forEach(i => { const v = i.value.trim(); if (v) o[i.dataset.k] = v; }); return o; };
    m.querySelector('#ff-save').addEventListener('click', () => { this._save(collect()); window.showToast?.('Profile saved'); m.remove(); });
    m.querySelector('#ff-fill').addEventListener('click', () => { this._save(collect()); this.fill(collect()); m.remove(); });
  },

  // Fill the active page's form from the profile. Called by "Fill this form".
  fill(profile) {
    const p = profile || this._load();
    if (!Object.values(p).some(Boolean)) { this.open(); return; }
    const wv = (typeof WebviewManager !== 'undefined') && (WebviewManager.getActiveWebview ? WebviewManager.getActiveWebview() : WebviewManager.webviews.get(TabManager.activeTabId));
    if (!wv) { window.showToast?.('Open a page with a form first'); return; }
    // Derive first/last from fullName if not set separately.
    if (p.fullName && (!p.firstName || !p.lastName)) { const parts = p.fullName.trim().split(/\s+/); p.firstName = p.firstName || parts[0]; p.lastName = p.lastName || parts.slice(1).join(' '); }
    const js = `(function(){try{
      var P=${JSON.stringify(p)};
      var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
      function fire(el,val){try{el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}
      function vis(el){try{var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}catch(e){return false;}}
      function meta(el){try{var lab='';if(el.labels&&el.labels[0])lab=el.labels[0].textContent||'';return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')+' '+lab).toLowerCase();}catch(e){return '';}}
      var RULES=[
        ['email', /email|e-mail/, P.email],
        ['tel', /phone|tel|mobile/, P.phone],
        ['givenname', /given.?name|first.?name|fname|forename/, P.firstName],
        ['familyname', /family.?name|last.?name|lname|surname/, P.lastName],
        ['name', /full.?name|your.?name|(^|\\b)name\\b|cardholder|account.?name/, P.fullName],
        ['street', /street|address.?line.?1|addr(ess)?1|address$|shipping.?address/, P.address],
        ['city', /city|town|locality|address.?level.?2/, P.city],
        ['region', /state|province|region|county|address.?level.?1/, P.region],
        ['zip', /zip|postal|postcode|post.?code/, P.zip],
        ['country', /country/, P.country]
      ];
      var filled=0;
      var inputs=Array.prototype.slice.call(document.querySelectorAll('input, textarea, select'));
      inputs.forEach(function(el){
        var t=(el.type||'').toLowerCase(); if(t==='password'||t==='hidden'||t==='checkbox'||t==='radio'||t==='file'||t==='submit'||t==='button')return;
        if(!vis(el)||el.value)return;
        var m=meta(el);
        for(var i=0;i<RULES.length;i++){ var val=RULES[i][2]; if(!val)continue; if(RULES[i][1].test(m)){
          if(el.tagName==='SELECT'){ var opt=Array.prototype.slice.call(el.options).find(function(o){return (o.textContent||'').toLowerCase().indexOf(String(val).toLowerCase())>=0;}); if(opt){el.value=opt.value;el.dispatchEvent(new Event('change',{bubbles:true}));filled++;} }
          else { fire(el,val); filled++; }
          break;
        }}
      });
      return filled;
    }catch(e){return 0;}})()`;
    try { wv.executeJavaScript(js).then((n) => { window.showToast?.(n ? ('🧾 Filled ' + n + ' field' + (n === 1 ? '' : 's')) : 'No matching form fields found'); }).catch(() => {}); } catch {}
  },

  _chip() { return "padding:7px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12.5px;font-family:'Outfit',sans-serif"; },
  _primary() { return "padding:7px 14px;background:var(--primary,var(--accent,#d4a574));color:#111;border:1px solid transparent;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:'Outfit',sans-serif"; },
};

if (typeof window !== 'undefined') window.FormFill = FormFill;
