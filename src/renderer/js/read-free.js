// === Vex Read Free — get past paywalls on the page you're reading ===
//
// Two legitimate, reader-side tactics (your browser, your reading):
//   1. Reset a METERED paywall — the "N free articles a month" kind that counts
//      via cookies / localStorage. We clear just this site's data (main-side
//      site:clear-data) and reload; the counter starts over. Best fidelity —
//      you stay on the real article.
//   2. Open a FREE archived copy on archive.today — for hard, subscriber-only
//      walls where the text never reaches the browser. archive.ph/newest/<url>
//      redirects to the most recent snapshot (full text) when one exists.
//
// Plus a one-click Reading Mode for soft walls where the article is already in
// the DOM behind an overlay. Triggered from Quick Tools or Ctrl+K → "Read Free".

const ReadFree = {
  _el: null,
  _onKey: null,
  _onDoc: null,

  run() {
    const tab = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
    const url = tab && tab.url;
    if (!url || !/^https?:/i.test(url)) { window.showToast?.('Open an article first'); return; }
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    this._open(tab, url, host);
  },

  _open(tab, url, host) {
    this.close();
    this._injectStyles();

    const el = document.createElement('div');
    el.className = 'readfree-pop';
    el.innerHTML = `
      <div class="readfree-head">📰 Read free <span class="readfree-host"></span></div>
      <button class="readfree-act" data-act="reset">
        <span class="readfree-ico">🔄</span>
        <span class="readfree-txt"><b>Reset paywall &amp; reload</b><small>Clear this site's cookies &amp; storage — resets metered "N free articles" walls</small></span>
      </button>
      <button class="readfree-act" data-act="archive">
        <span class="readfree-ico">🗄️</span>
        <span class="readfree-txt"><b>Open free copy (archive.today)</b><small>Best for hard, subscriber-only paywalls</small></span>
      </button>
      <button class="readfree-act" data-act="reader">
        <span class="readfree-ico">📖</span>
        <span class="readfree-txt"><b>Reading mode</b><small>Strip overlays when the article is already loaded</small></span>
      </button>`;
    el.querySelector('.readfree-host').textContent = '· ' + host;
    el.querySelectorAll('.readfree-act').forEach(b =>
      b.addEventListener('click', () => { const a = b.dataset.act; this.close(); this._do(a, tab, url); }));
    document.body.appendChild(el);
    this._el = el;

    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
    this._onDoc = (e) => { if (this._el && !this._el.contains(e.target)) this.close(); };
    setTimeout(() => {
      document.addEventListener('keydown', this._onKey, true);
      document.addEventListener('mousedown', this._onDoc, true);
    }, 0);
  },

  async _do(action, tab, url) {
    if (action === 'archive') {
      // archive.today wants the raw URL appended; /newest/ jumps to the latest snapshot.
      TabManager.createTab('https://archive.ph/newest/' + url, true);
      return;
    }
    if (action === 'reader') {
      try {
        if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
          const c = CommandBar.commands.find(x => x.id === 'read');
          if (c) { c.action(); return; }
        }
        if (typeof ReadingMode !== 'undefined' && ReadingMode.activate) {
          const wv = WebviewManager.getActiveWebview(); if (wv) ReadingMode.activate(wv);
        }
      } catch {}
      return;
    }
    // action === 'reset'
    const partition = (tab && tab.partition) || 'persist:main';
    window.showToast?.('Clearing site data…');
    let ok = false;
    try {
      if (window.vex?.clearSiteData) {
        const r = await window.vex.clearSiteData({ partition, url });
        ok = !!(r && r.ok);
      }
    } catch {}
    try {
      const wv = WebviewManager.getActiveWebview();
      if (wv) (wv.reloadIgnoringCache ? wv.reloadIgnoringCache() : wv.reload());
    } catch {}
    window.showToast?.(ok ? '🔄 Paywall reset — reloading' : 'Reloaded (clear may have partially failed)');
  },

  close() {
    if (this._el) { this._el.remove(); this._el = null; }
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    if (this._onDoc) document.removeEventListener('mousedown', this._onDoc, true);
    this._onKey = this._onDoc = null;
  },

  _injectStyles() {
    if (document.getElementById('readfree-styles')) return;
    const st = document.createElement('style');
    st.id = 'readfree-styles';
    st.textContent = `
      .readfree-pop{position:fixed;z-index:100001;top:64px;left:50%;transform:translateX(-50%);
        width:360px;max-width:calc(100vw - 24px);padding:8px;border-radius:14px;
        background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.10));
        box-shadow:0 18px 50px rgba(0,0,0,0.5);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
        font-family:inherit;animation:readfreeIn .13s ease;}
      @keyframes readfreeIn{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
      .readfree-head{font-size:12px;color:var(--text-muted,#9a9aa5);padding:6px 8px 8px;font-weight:600;}
      .readfree-host{font-weight:400;}
      .readfree-act{display:flex;align-items:flex-start;gap:11px;width:100%;padding:10px;border:none;border-radius:10px;
        background:transparent;color:var(--text,#e9e9ee);cursor:pointer;text-align:left;font-family:inherit;}
      .readfree-act:hover{background:color-mix(in srgb, var(--primary,#6366f1) 16%, transparent);}
      .readfree-ico{font-size:18px;width:24px;text-align:center;flex-shrink:0;line-height:1.2;}
      .readfree-txt{display:flex;flex-direction:column;gap:2px;min-width:0;}
      .readfree-txt b{font-size:13px;font-weight:600;}
      .readfree-txt small{font-size:11px;color:var(--text-muted,#9a9aa5);line-height:1.35;}
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.ReadFree = ReadFree;
if (typeof module !== 'undefined' && module.exports) module.exports = { ReadFree };
