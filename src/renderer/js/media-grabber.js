// === Vex Media Grabber — find & save video/audio on the current page ===
//
// Main sniffs media responses per tab (see main.js wireMediaSnifferOnSession).
// This lists them for the active tab and offers:
//   • progressive files (mp4/webm/mp3/…) → one-click Download (real file)
//   • HLS/DASH streams (.m3u8/.mpd)       → Copy link / Open — these need an
//     external player (VLC) or yt-dlp to save, which we don't bundle.
// DRM/MSE video (e.g. YouTube/Netflix) can't be captured and won't appear.

const MediaGrabber = {
  _el: null,
  _onKey: null,
  _onDoc: null,
  _onBlur: null,

  async run() {
    const wv = (typeof WebviewManager !== 'undefined') && WebviewManager.getActiveWebview();
    let wcId = null;
    try { if (wv && wv.getWebContentsId) wcId = wv.getWebContentsId(); } catch {}
    if (wcId == null) { window.showToast?.('Open a page first'); return; }
    let items = [];
    try { if (window.vex?.mediaList) items = await window.vex.mediaList(wcId); }
    catch (err) { console.error('[MediaGrabber] could not list media:', err.message); window.showToast?.('Could not read the media on this page', 'error'); return; }
    this._open(wcId, items || []);
  },

  _fname(url) {
    try {
      const p = new URL(url).pathname;
      const last = p.split('/').filter(Boolean).pop() || 'media';
      return decodeURIComponent(last).slice(0, 48);
    } catch { return 'media'; }
  },
  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _size(kb) { if (!kb) return ''; return kb < 1024 ? kb + ' KB' : (kb / 1024).toFixed(1) + ' MB'; },
  // Inline SVG, currentColor so they follow the theme (no emoji in Vex UI).
  ICONS: {
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    stream: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m23 7-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>'
  },
  _ico(k) { return k === 'audio' ? this.ICONS.audio : (k === 'hls' || k === 'dash') ? this.ICONS.stream : this.ICONS.video; },

  _open(wcId, items) {
    this.close();
    this._injectStyles();
    const el = document.createElement('div');
    el.className = 'mediagrab-pop';

    const rows = items.length ? items.map((it, i) => {
      const stream = it.kind === 'hls' || it.kind === 'dash';
      const size = this._size(it.sizeKB);
      const meta = [stream ? it.kind.toUpperCase() + ' stream' : (it.mime || it.kind), size].filter(Boolean).join(' · ');
      const actions = stream
        ? `<button class="mediagrab-btn" data-copy="${i}">Copy link</button><button class="mediagrab-btn" data-open="${i}">Open</button>`
        : `<button class="mediagrab-btn primary" data-dl="${i}">${this.ICONS.download}<span>Download</span></button><button class="mediagrab-btn" data-copy="${i}">Copy</button>`;
      return `<div class="mediagrab-row">
        <span class="mediagrab-ico">${this._ico(it.kind)}</span>
        <span class="mediagrab-info"><b>${this._esc(this._fname(it.url))}</b><small>${this._esc(this._host(it.url))} · ${this._esc(meta)}</small></span>
        <span class="mediagrab-acts">${actions}</span>
      </div>`;
    }).join('') : `<div class="mediagrab-empty">No media detected yet.<br><small>Start playing the video/audio, then reopen. DRM video (YouTube, Netflix) can't be captured.</small></div>`;

    el.innerHTML = `
      <div class="mediagrab-head"><span>Media on this page</span> <button class="mediagrab-refresh" title="Refresh" aria-label="Refresh">${this.ICONS.refresh}</button></div>
      <div class="mediagrab-list">${rows}</div>
      ${items.some(i => i.kind === 'hls' || i.kind === 'dash') ? '<div class="mediagrab-hint">HLS/DASH streams: paste the link into VLC or yt-dlp to save.</div>' : ''}`;
    document.body.appendChild(el);
    this._el = el;

    el.querySelector('.mediagrab-refresh').addEventListener('click', () => { this.close(); this.run(); });
    el.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
      const it = items[+b.dataset.dl];
      try {
        const result = await window.vex.mediaDownload(wcId, it.url);
        if (result && result.ok === false) throw new Error(result.error || 'the tab could not start the download');
        window.showToast?.('Downloading ' + this._fname(it.url));
      } catch (err) {
        console.error('[MediaGrabber] download failed:', err.message);
        window.showToast?.('Download failed: ' + err.message, 'error');
      }
      this.close();
    }));
    el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      const it = items[+b.dataset.copy];
      navigator.clipboard.writeText(it.url)
        .then(() => window.showToast?.('Link copied'))
        .catch((err) => { console.error('[MediaGrabber] clipboard write failed:', err.message); window.showToast?.('Could not copy that link', 'error'); });
    }));
    el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      const it = items[+b.dataset.open];
      try { TabManager.createTab(it.url, true); }
      catch (err) { console.error('[MediaGrabber] could not open stream:', err.message); window.showToast?.('Could not open that stream', 'error'); }
      this.close();
    }));

    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
    this._onDoc = (e) => { if (this._el && !this._el.contains(e.target)) this.close(); };
    // Clicks inside the page's <webview> don't reach the host document, so also
    // close on window blur (focus entering the guest fires it) — otherwise the
    // popup stays stuck open when the user clicks the page/video.
    this._onBlur = () => this.close();
    setTimeout(() => {
      document.addEventListener('keydown', this._onKey, true);
      document.addEventListener('mousedown', this._onDoc, true);
      window.addEventListener('blur', this._onBlur);
    }, 0);
  },

  close() {
    if (this._el) { this._el.remove(); this._el = null; }
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    if (this._onDoc) document.removeEventListener('mousedown', this._onDoc, true);
    if (this._onBlur) window.removeEventListener('blur', this._onBlur);
    this._onKey = this._onDoc = this._onBlur = null;
  },

  _esc(s) { return window.escapeHtml(s); },

  _injectStyles() {
    if (document.getElementById('mediagrab-styles')) return;
    const st = document.createElement('style');
    st.id = 'mediagrab-styles';
    st.textContent = `
      .mediagrab-pop{position:fixed;z-index:100001;top:64px;left:50%;transform:translateX(-50%);
        width:420px;max-width:calc(100vw - 24px);padding:8px;border-radius:14px;
        background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.10));
        box-shadow:0 18px 50px rgba(0,0,0,0.5);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
        font-family:inherit;animation:mediagrabIn .13s ease;}
      @keyframes mediagrabIn{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
      .mediagrab-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;
        color:var(--text-muted,#9a9aa5);padding:6px 8px 8px;}
      .mediagrab-refresh{border:none;background:transparent;color:var(--text-muted,#9a9aa5);cursor:pointer;font-size:15px;border-radius:6px;padding:2px 6px;}
      .mediagrab-refresh:hover{background:color-mix(in srgb,var(--primary,#6366f1) 16%,transparent);color:var(--text,#fff);}
      .mediagrab-list{max-height:340px;overflow:auto;}
      .mediagrab-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;}
      .mediagrab-row:hover{background:color-mix(in srgb,var(--primary,#6366f1) 10%,transparent);}
      .mediagrab-ico{width:22px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted,#9a9aa5);}
      .mediagrab-ico svg{width:16px;height:16px;display:block;}
      .mediagrab-refresh svg{display:block;}
      .mediagrab-btn{display:inline-flex;align-items:center;gap:5px;}
      .mediagrab-btn svg{display:block;}
      .mediagrab-info{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;}
      .mediagrab-info b{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text,#e9e9ee);}
      .mediagrab-info small{font-size:10.5px;color:var(--text-muted,#9a9aa5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .mediagrab-acts{display:flex;gap:4px;flex-shrink:0;}
      .mediagrab-btn{border:1px solid var(--border,rgba(255,255,255,0.12));background:transparent;color:var(--text,#e9e9ee);
        border-radius:7px;padding:5px 9px;font-size:11.5px;cursor:pointer;font-family:inherit;white-space:nowrap;}
      .mediagrab-btn:hover{background:color-mix(in srgb,var(--primary,#6366f1) 18%,transparent);}
      .mediagrab-btn.primary{background:var(--primary,#6366f1);border-color:transparent;color:#fff;font-weight:600;}
      .mediagrab-empty{padding:26px 16px;text-align:center;color:var(--text-muted,#9a9aa5);font-size:13px;line-height:1.5;}
      .mediagrab-empty small{font-size:11px;opacity:.85;}
      .mediagrab-hint{font-size:10.5px;color:var(--text-muted,#9a9aa5);padding:6px 10px 2px;border-top:1px solid var(--border,rgba(255,255,255,0.07));margin-top:4px;}
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.MediaGrabber = MediaGrabber;
if (typeof module !== 'undefined' && module.exports) module.exports = { MediaGrabber };
