// === Vex Leak Canary ===
// Warns when one of YOUR saved emails is already sitting in a form field on a
// site that ISN'T where you saved it — i.e. pre-filled by the page or a tracker
// before you typed anything. A quiet, local privacy tripwire. Runs on page load
// (webview.js calls check()); toggle with vex.leakCanary.
const LeakCanary = {
  _emails: null,

  async _saved() {
    if (this._emails) return this._emails;
    this._emails = {};
    try {
      const list = await window.vex.vaultList();
      (list || []).forEach((c) => { const u = (c.username || '').toLowerCase(); if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u)) this._emails[u] = (c.host || '').replace(/^www\./, ''); });
    } catch {}
    return this._emails;
  },
  refresh() { this._emails = null; },

  _host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _mask(e) { const [a, b] = e.split('@'); return (a || '').slice(0, 2) + '***@' + (b || ''); },
  _warned(k) { try { return !!(JSON.parse(sessionStorage.getItem('vex.leakWarned') || '{}'))[k]; } catch { return false; } },
  _mark(k) { try { const o = JSON.parse(sessionStorage.getItem('vex.leakWarned') || '{}'); o[k] = 1; sessionStorage.setItem('vex.leakWarned', JSON.stringify(o)); } catch {} },

  async check(webview, url) {
    try {
      if (localStorage.getItem('vex.leakCanary') === 'off') return;
      const host = this._host(url);
      if (!host || !/^https:/i.test(url || '')) return;
      const saved = await this._saved();
      if (!Object.keys(saved).length) return;

      // Pull ONLY the emails already present in input fields at load (pre-filled).
      // We never inject your emails into the page — we extract candidates and
      // compare in the trusted renderer.
      const found = await webview.executeJavaScript(`(function(){try{
        var re=/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/; var out=[];
        var ins=document.querySelectorAll('input');
        for(var i=0;i<ins.length&&out.length<20;i++){var v=(ins[i].value||'');if(v&&re.test(v)){var m=v.match(re);if(m)out.push(m[0].toLowerCase());}}
        return out;
      }catch(e){return [];}})()`);

      for (const email of (found || [])) {
        if (saved[email] !== undefined && saved[email] !== host) {
          const k = host + '|' + email;
          if (this._warned(k)) return;
          this._mark(k);
          window.showToast?.('⚠️ ' + host + ' already has your email (' + this._mask(email) + ') pre-filled — you saved it for ' + (saved[email] || 'another site') + '. Possibly a tracker.', 7000);
          return;
        }
      }
    } catch {}
  },
};

if (typeof window !== 'undefined') window.LeakCanary = LeakCanary;
