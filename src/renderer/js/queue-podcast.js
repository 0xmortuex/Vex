// === Vex Queue → Podcast ===
// Turns your Read-Later queue into a hands-free, auto-advancing audio playlist:
// for each unread saved article, Vex speaks a short intro then reads the article
// aloud, then moves to the next one on its own. A floating player bar lets you
// pause/skip/stop. Uses SpeechSynthesis in the main renderer; article text is
// pulled from a hidden off-screen reader webview so your real tabs aren't touched.
// (Distinct from Read Aloud, which speaks the ONE current page.)
const QueuePodcast = {
  _items: [],
  _idx: 0,
  _token: 0,        // invalidates in-flight speech on skip/stop
  _paused: false,
  _bar: null,
  _reader: null,

  start() {
    if (this._bar) { this.stop(); }
    let all = [];
    try { all = (window.ReadLater && ReadLater.items) ? ReadLater.items.slice() : JSON.parse(localStorage.getItem('vex.readLater') || '[]'); } catch { all = []; }
    this._items = (all || []).filter(i => i && i.url && !i.read);
    if (!this._items.length) { window.showToast?.('Read Later is empty — save some articles first'); return; }
    if (!('speechSynthesis' in window)) { window.showToast?.('Text-to-speech isn\'t available'); return; }
    this._idx = 0; this._paused = false;
    this._buildBar();
    window.showToast?.('🎧 Playing ' + this._items.length + ' saved article' + (this._items.length === 1 ? '' : 's'));
    this._playCurrent();
  },

  _ensureReader() {
    if (this._reader && document.body.contains(this._reader)) return this._reader;
    const wv = document.createElement('webview');
    wv.id = 'vex-podcast-reader';
    wv.setAttribute('partition', 'persist:main');
    wv.setAttribute('webpreferences', 'contextIsolation=yes');
    wv.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:760px;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(wv);
    this._reader = wv;
    return wv;
  },

  // Load a URL in the hidden reader and return its readable text (best-effort).
  _fetchText(url) {
    return new Promise((resolve) => {
      const wv = this._ensureReader();
      let done = false, to = null;
      const finish = async () => {
        if (done) return; done = true;
        clearTimeout(to);
        try { wv.removeEventListener('did-finish-load', onLoad); } catch {}
        let text = '';
        try {
          text = await wv.executeJavaScript("(function(){try{var el=document.querySelector('article,main,[role=main]')||document.body;return (el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,7000);}catch(e){return '';}})()");
        } catch {}
        resolve(text || '');
      };
      const onLoad = () => finish();
      try { wv.addEventListener('did-finish-load', onLoad); } catch {}
      to = setTimeout(finish, 14000);   // some pages never fire finish-load
      try { (typeof wv.loadURL === 'function') ? wv.loadURL(url).catch(() => finish()) : (wv.src = url); } catch { finish(); }
    });
  },

  async _playCurrent() {
    if (this._idx >= this._items.length) { window.showToast?.('🎧 Playlist finished'); this.stop(); return; }
    const item = this._items[this._idx];
    this._renderBar();
    const intro = 'Next article: ' + (item.title || 'Untitled') + '. ';
    let body = await this._fetchText(item.url);
    // If we couldn't read it, say so and move on rather than stalling silently.
    if (!body || body.length < 40) body = 'Sorry, this article could not be read aloud. Skipping.';
    const chunks = [intro].concat(this._chunk(body));
    this._speakChunks(chunks, () => { this._markRead(item); this._idx++; this._playCurrent(); });
  },

  // Split into <=200-char sentence-ish chunks (long single utterances get cut off
  // by some TTS engines).
  _chunk(text) {
    const out = [];
    const sentences = String(text).match(/[^.!?]+[.!?]*\s*/g) || [text];
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length > 200) { if (buf) out.push(buf.trim()); buf = s; }
      else buf += s;
      while (buf.length > 240) { out.push(buf.slice(0, 240)); buf = buf.slice(240); }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.length ? out : [text.slice(0, 240)];
  },

  _speakChunks(chunks, onDone) {
    const token = ++this._token;
    let i = 0;
    const next = () => {
      if (token !== this._token) return;                 // skipped / stopped
      if (i >= chunks.length) { onDone && onDone(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.rate = 1; u.onend = () => { if (token === this._token) next(); };
      u.onerror = () => { if (token === this._token) next(); };
      try { window.speechSynthesis.speak(u); } catch { next(); }
    };
    try { window.speechSynthesis.cancel(); } catch {}
    next();
  },

  _markRead(item) {
    try {
      if (window.ReadLater && ReadLater.items) {
        const it = ReadLater.items.find(x => x.id === item.id || x.url === item.url);
        if (it) { it.read = true; ReadLater.save(); }
      }
    } catch {}
  },

  togglePause() {
    if (!this._bar) return;
    try {
      if (this._paused) { window.speechSynthesis.resume(); this._paused = false; }
      else { window.speechSynthesis.pause(); this._paused = true; }
    } catch {}
    this._renderBar();
  },
  skip() { if (!this._bar) return; this._token++; try { window.speechSynthesis.cancel(); } catch {} this._markRead(this._items[this._idx]); this._idx++; this._paused = false; this._playCurrent(); },
  stop() {
    this._token++;
    try { window.speechSynthesis.cancel(); } catch {}
    if (this._bar) { this._bar.remove(); this._bar = null; }
    try { if (this._reader) { this._reader.remove(); this._reader = null; } } catch {}
    this._paused = false; this._items = []; this._idx = 0;
  },

  _buildBar() {
    document.getElementById('vex-podcast-bar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'vex-podcast-bar';
    bar.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;display:flex;align-items:center;gap:12px;max-width:92vw;background:var(--surface,#1b1b24);color:var(--text,#e9e9ee);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:12px;padding:9px 14px;box-shadow:0 8px 30px rgba(0,0,0,.4);font-family:'Outfit',sans-serif";
    bar.innerHTML = `<span style="font-size:15px">🎧</span>
      <span id="qp-title" style="max-width:44vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px"></span>
      <span id="qp-prog" style="font-size:11px;color:var(--text-muted,#9a9aa5)"></span>
      <button id="qp-pause" style="${this._btn()}">⏸</button>
      <button id="qp-skip" title="Skip" style="${this._btn()}">⏭</button>
      <button id="qp-stop" title="Stop" style="${this._btn()}">⏹</button>`;
    document.body.appendChild(bar);
    this._bar = bar;
    bar.querySelector('#qp-pause').addEventListener('click', () => this.togglePause());
    bar.querySelector('#qp-skip').addEventListener('click', () => this.skip());
    bar.querySelector('#qp-stop').addEventListener('click', () => this.stop());
    this._renderBar();
  },
  _btn() { return "width:30px;height:28px;border-radius:7px;cursor:pointer;font-size:13px;border:1px solid var(--border,rgba(255,255,255,0.16));background:var(--bg,#0e0e16);color:var(--text,#e9e9ee);font-family:'Outfit',sans-serif"; },
  _renderBar() {
    if (!this._bar) return;
    const item = this._items[this._idx];
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const t = this._bar.querySelector('#qp-title'); if (t) t.textContent = item ? (item.title || item.url) : '';
    const p = this._bar.querySelector('#qp-prog'); if (p) p.textContent = (this._idx + 1) + '/' + this._items.length;
    const pb = this._bar.querySelector('#qp-pause'); if (pb) pb.textContent = this._paused ? '▶' : '⏸';
  },
};

if (typeof window !== 'undefined') window.QueuePodcast = QueuePodcast;
