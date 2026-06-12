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

  _never() { try { return JSON.parse(localStorage.getItem(this.NEVER_KEY) || '[]'); } catch { return []; } },
  _addNever(host) { const n = this._never(); if (!n.includes(host)) { n.push(host); try { localStorage.setItem(this.NEVER_KEY, JSON.stringify(n)); } catch {} } },

  attach(webview) {
    webview.addEventListener('ipc-message', async (e) => {
      if (e.channel !== 'vex-cred-submit') return;
      const data = (e.args && e.args[0]) || {};
      if (!data.host || !data.username || !data.password) return;
      if (this._never().includes(data.host)) return;
      try {
        const existing = await window.vex.vaultGet(data.host);
        const match = (existing || []).find(x => x.username === data.username);
        if (match && match.password === data.password) return; // already saved, unchanged
        this._offerSave(data, !!match);
      } catch {}
    });
  },

  _offerSave(data, isUpdate) {
    document.getElementById('vex-pw-offer')?.remove();
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    const card = document.createElement('div');
    card.id = 'vex-pw-offer';
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:95000;width:320px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,0.5);font-family:\'Outfit\',sans-serif';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:16px">🔑</span>
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

  async autofill(webview, url) {
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
    if (!host || !/^https:/i.test(url)) return;
    let creds = [];
    try { creds = await window.vex.vaultGet(host); } catch { return; }
    if (!creds || !creds.length) return;
    const c = creds[0];
    const js = `(function(){try{
      var pw=document.querySelector('input[type=password]');
      if(!pw||pw.value)return;
      var form=pw.form||document;
      var user=null;
      var cands=form.querySelectorAll('input[type=text],input[type=email],input:not([type])');
      for(var i=0;i<cands.length;i++){var c=cands[i];var r=c.getBoundingClientRect();if(r.width>0&&!c.value){user=c;break;}}
      var fire=function(el,val){el.focus();el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
      if(user)fire(user,${JSON.stringify(c.username)});
      fire(pw,${JSON.stringify(c.password)});
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },

  // --- Settings → Passwords ---
  async renderPanel(container) {
    if (!container) return;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    let list = [];
    try { list = await window.vex.vaultList(); } catch {}
    container.innerHTML = `<p class="setting-info muted" style="margin-bottom:10px">Saved logins are encrypted with your OS keychain (Windows DPAPI) and autofilled on matching sites. Vex offers to save when you log in.</p>`;
    if (!list.length) container.innerHTML += '<div style="font-size:12.5px;color:var(--text-muted)">No saved passwords yet — log in somewhere and Vex will offer to save.</div>';
    list.sort((a, b) => (a.host || '').localeCompare(b.host || ''));
    list.forEach(entry => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border)';
      row.innerHTML = `
        <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(entry.host)}&sz=32" style="width:18px;height:18px;border-radius:4px" onerror="this.style.visibility='hidden'">
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
          if (m) { await navigator.clipboard.writeText(m.password); window.showToast?.('Password copied — clipboard clears in 30s'); setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000); }
        } catch {}
      });
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Delete the saved password for ' + entry.username + ' on ' + entry.host + '?')) return;
        await window.vex.vaultDelete({ host: entry.host, username: entry.username });
        this.renderPanel(container);
      });
      container.appendChild(row);
    });
  },
};

if (typeof window !== 'undefined') window.PasswordVault = PasswordVault;
if (typeof module !== 'undefined' && module.exports) module.exports = { PasswordVault };
