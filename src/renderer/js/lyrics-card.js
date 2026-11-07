// === Lyrics for the song that is playing =========================================
//
// OFF until the person turns it on (the card itself asks, and says what is sent). Then Ctrl+K "Show Lyrics for What Is
// Playing", or the Lyrics button on a Now Playing row, opens a card with the song's lyrics: synced lyrics follow the song's
// position with the current line highlighted, plain lyrics just scroll. Nothing is looked up until the card is open and a
// song is playing, nothing runs after it is closed.
//
// What the page tells us: the title, artist and album the player published through the media session (the same thing the
// lock screen shows) and the length and position of its <audio>/<video>, read with one fixed script every half second while
// the card is open. A private, Tor or routed tab or panel is never read (VexTabPolicy.canReadWebview) and never looked up.
//
// What is sent, to whom: main/lyrics.js asks lrclib.net for that one song: artist, title, album and length in seconds,
// from the main process, without cookies, listed in "What left this computer" as "Lyrics". Answers are kept in a
// small cache in the profile folder (500 songs). Nothing about the page, tab or listening history is sent or kept.
const VexLyrics = {
  PREF: 'vex.lyrics.prefs',            // { enabled }
  FEATURE: 'lyrics',
  POLL_MS: 1000,                       // the page is read once a second (one shared job, held while Vex is hidden or a game runs);
  LEAD_S: 0.25,                        // between reads the position is worked out from the clock, and the line is shown a moment early
  READ_MS: 2000,

  NOW_SCRIPT: '(() => { const s = navigator.mediaSession; const m = s && s.metadata; const els = Array.from(document.querySelectorAll("audio,video")).filter(e => e.duration || e.currentTime); const el = els.find(e => !e.paused) || els[0];' +
    ' return { title: m ? String(m.title || "").slice(0, 200) : "", artist: m ? String(m.artist || "").slice(0, 200) : "", album: m ? String(m.album || "").slice(0, 200) : "",' +
    ' duration: el && isFinite(el.duration) ? el.duration : 0, position: el ? el.currentTime : 0, paused: el ? el.paused : true }; })()',

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !!raw && raw.enabled === true; }
    catch (err) { console.error('[Lyrics] the setting could not be read, so lyrics stay off:', err.message); return false; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return !!on;
  },

  // ---- pure --------------------------------------------------------------------------------
  // The index of the line being sung at `seconds` in lines = [[seconds, text], ...] sorted by time; -1 before the first line.
  indexAt(lines, seconds) {
    if (!Array.isArray(lines) || !lines.length || !Number.isFinite(seconds)) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid][0] <= seconds) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  },

  // How long to wait before asking again for an answer that was not one (0: do not ask again).
  retryDelay(result) {
    if (!result) return 30000;
    if (result.status === 'busy') return Math.max(1, Number(result.retryAfterSec) || 5) * 1000;
    if (result.status === 'offline') return 10000;
    if (result.status === 'error') return 30000;
    return 0;
  },

  songKey(now) { return now && now.title ? [now.artist, now.title, now.album].join('\u0001').toLowerCase() : ''; },

  // What the card says for each answer of main. kind: lines | plain | note.
  viewFor(result) {
    if (!result) return { kind: 'note', text: this._t('The lyrics lookup did not answer') };
    switch (result.status) {
      case 'ok':
        if (Array.isArray(result.synced) && result.synced.length) return { kind: 'lines', lines: result.synced };
        return { kind: 'plain', text: result.plain || '' };
      case 'instrumental': return { kind: 'note', text: this._t('This one is an instrumental: it has no lyrics.') };
      case 'not-found': return { kind: 'note', text: this._t('lrclib.net has no lyrics for this song yet.') };
      case 'offline': return { kind: 'note', text: this._t('You are offline, so the lyrics cannot be looked up. Songs seen before are kept on this computer.') };
      case 'busy': return { kind: 'note', text: this._t('lrclib.net asked Vex to slow down. Try again in {1} seconds.').replace('{1}', String(result.retryAfterSec || 5)) };
      default: return { kind: 'note', text: this._t('The lyrics could not be looked up: {1}').replace('{1}', result.message || this._t('unknown error')) };
    }
  },

  // ---- the sources ---------------------------------------------------------------------------
  // Everything that could be the song: the music panels that are open and the tabs that are making sound, never one that
  // Vex may not read (private, Tor, routed).
  sources() {
    const out = [];
    const policy = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    const canRead = (wv) => !!wv && (!policy || policy.canReadWebview(wv));
    if (typeof PanelMedia !== 'undefined') {
      for (const name of PanelMedia.PANELS) {
        const wv = PanelMedia.webview(name);
        if (canRead(wv)) out.push({ kind: 'panel', id: name, wv });
      }
    }
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined') {
      for (const t of TabManager.tabs || []) {
        if (!t || !t.audible) continue;
        const wv = WebviewManager.webviews.get(t.id);
        if (canRead(wv)) out.push({ kind: 'tab', id: t.id, wv });
      }
    }
    return out;
  },

  async readNow(source) {
    return window.vexGuestEval(source.wv, this.NOW_SCRIPT, false, this.READ_MS);
  },

  // The source that is playing a song right now (a panel before a tab, a tab the person asked for first).
  async pick(preferTabId) {
    const all = this.sources();
    all.sort((a, b) => (b.kind === 'tab' && b.id === preferTabId ? 1 : 0) - (a.kind === 'tab' && a.id === preferTabId ? 1 : 0));
    let fallback = null;
    for (const s of all) {
      let now;
      try { now = await this.readNow(s); } catch (err) { window.VexProblems?.note('Lyrics', 'Could not read what a ' + s.kind + ' is playing', err); continue; }
      if (!now || !now.title || !now.artist) continue;
      if (!now.paused) return { source: s, now };
      if (!fallback) fallback = { source: s, now };
    }
    return fallback;
  },

  // ---- the card -----------------------------------------------------------------------------
  _card: null,

  close() {
    const c = this._card;
    if (!c) return;
    c.job?.stop();
    clearTimeout(c.hl);
    c.token = -1;
    c.el.remove();
    this._card = null;
  },

  async open({ tabId } = {}) {
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    if (this._card) this.close();
    const el = document.createElement('div');
    el.id = 'vex-lyrics-card';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Lyrics');
    const np = document.getElementById('vex-nowplaying');
    const lift = np ? Math.round(np.getBoundingClientRect().height) + 24 : 14;
    el.style.cssText = 'position:fixed;left:14px;bottom:' + lift + 'px;z-index:9001;width:min(340px,92vw);max-height:min(60vh,520px);display:flex;flex-direction:column;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.4);overflow:hidden';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border)';
    const title = document.createElement('div');
    title.style.cssText = 'flex:1;min-width:0;font-size:12.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    title.textContent = this._t('Lyrics');
    const x = document.createElement('button');
    x.type = 'button';
    x.innerHTML = typeof VexIcons !== 'undefined' ? VexIcons.svg('x', { size: 13 }) : '';
    x.setAttribute('aria-label', 'Close');
    x.title = 'Close';
    x.style.cssText = 'border:none;background:none;color:var(--text-muted);font-size:16px;cursor:pointer;line-height:1';
    x.addEventListener('click', () => this.close());
    head.append(title, x);
    const body = document.createElement('div');
    body.style.cssText = 'padding:10px 12px;overflow-y:auto;font-size:13px;line-height:1.55;flex:1';
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:7px 12px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)';
    el.append(head, body, foot);
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'panel', id: 'lyrics-card' });

    const card = { el, body, title, foot, job: null, hl: null, anchor: null, token: 0, key: '', lines: null, rows: [], idx: -2, busy: false, preferTabId: tabId, source: null, scrolledAt: 0 };
    this._card = card;
    body.addEventListener('wheel', () => { card.scrolledAt = Date.now(); }, { passive: true });
    this._drawFoot(card);
    if (!this.enabled()) { this._drawOptIn(card); return card; }
    this._start(card);
    return card;
  },

  _button(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-secondary';
    b.textContent = this._t(text);
    b.style.cssText = 'font-size:11px;padding:2px 8px';
    b.addEventListener('click', onClick);
    return b;
  },

  _drawFoot(card) {
    card.foot.textContent = '';
    const src = document.createElement('span');
    src.style.flex = '1';
    src.textContent = this._t('Lyrics from lrclib.net');
    card.foot.appendChild(src);
    if (this.enabled()) {
      card.foot.appendChild(this._button('Turn off', () => { this.setEnabled(false); this.close(); window.showToast?.(this._t('Lyrics are off. Nothing will be looked up.')); }));
      card.foot.appendChild(this._button('Clear saved lyrics', async () => {
        try { await window.vex.lyricsClear(); window.showToast?.(this._t('Saved lyrics cleared')); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      }));
    }
  },

  _drawOptIn(card) {
    card.body.textContent = '';
    const p = document.createElement('div');
    p.textContent = this._t('Show lyrics for the song that is playing? Vex asks lrclib.net, a free lyrics database, for that one song. It is sent the artist, title, album and length of the song, and nothing else: no cookies, no account, nothing about the page. Not for private or Tor tabs. Answers are kept on this computer (500 songs). Off until you turn it on.');
    p.style.cssText = 'color:var(--text-muted);margin-bottom:10px';
    const on = document.createElement('button');
    on.type = 'button';
    on.className = 'btn-primary';
    on.textContent = this._t('Turn on lyrics');
    on.addEventListener('click', () => {
      try { this.setEnabled(true); } catch (err) { window.showToast?.(err.message, 'error'); return; }
      this._drawFoot(card);
      this._start(card);
    });
    card.body.append(p, on);
  },

  _note(card, text) {
    card.body.textContent = '';
    card.rows = [];
    card.lines = null;
    const d = document.createElement('div');
    d.style.color = 'var(--text-muted)';
    d.textContent = text;
    card.body.appendChild(d);
  },

  _show(card, view) {
    card.body.textContent = '';
    card.rows = [];
    card.lines = null;
    card.idx = -2;
    if (view.kind === 'lines') {
      card.lines = view.lines;
      for (const [, words] of view.lines) {
        const row = document.createElement('div');
        row.textContent = words || ' ';
        row.style.cssText = 'opacity:0.5;transition:opacity .2s,color .2s';
        card.body.appendChild(row);
        card.rows.push(row);
      }
    } else if (view.kind === 'plain') {
      const pre = document.createElement('div');
      pre.style.whiteSpace = 'pre-wrap';
      pre.textContent = view.text;
      card.body.appendChild(pre);
    } else {
      this._note(card, view.text);
    }
  },

  _highlight(card, idx) {
    if (idx === card.idx) return;
    const old = card.rows[card.idx];
    if (old) { old.style.opacity = '0.5'; old.style.fontWeight = ''; old.style.color = ''; old.removeAttribute('aria-current'); }
    card.idx = idx;
    const row = card.rows[idx];
    if (!row) return;
    row.style.opacity = '1';
    row.style.fontWeight = '650';
    row.style.color = 'var(--accent, var(--text))';
    row.setAttribute('aria-current', 'true');
    // The person scrolling by hand keeps the place they scrolled to for a few seconds.
    if (Date.now() - card.scrolledAt > 4000) row.scrollIntoView({ block: 'center', behavior: VexMotion.scroll() });
  },

  _start(card) {
    this._note(card, this._t('Looking for the song that is playing…'));
    const tick = async () => {
      if (this._card !== card || card.busy || document.hidden) return;
      card.busy = true;
      try { await this._tick(card); }
      catch (err) { window.VexProblems?.note('Lyrics', 'The lyrics card could not update', err); }
      finally { card.busy = false; }
    };
    if (!window.VexJobs) throw new Error('Periodic jobs are not available in this window');
    card.job = window.VexJobs.every('Lyrics card', this.POLL_MS, tick, { feature: this.FEATURE });
    tick();
  },

  async _tick(card) {
    let now = null;
    if (card.source) {
      try { now = await this.readNow(card.source); } catch { card.source = null; /* the page went: look for the song again below */ }
    }
    if (!now || !now.title || !now.artist) {
      const found = await this.pick(card.preferTabId);
      if (this._card !== card) return;
      if (!found) {
        card.source = null;
        if (card.key) { card.key = ''; card.title.textContent = this._t('Lyrics'); }
        if (!card.lines && !card.rows.length) this._note(card, this._t('Nothing with a song title is playing. Start a song in Spotify, YouTube Music or a tab, and the lyrics will follow. Private and Tor tabs are never looked up.'));
        return;
      }
      card.source = found.source;
      now = found.now;
    }
    if (this._card !== card) return;
    const key = this.songKey(now);
    // A lookup that could not be answered is tried again later (offline, busy, an error); a found or missing song is not.
    if (card.retryAt && Date.now() >= card.retryAt) { card.key = ''; card.retryAt = 0; }
    if (key !== card.key) {
      card.key = key;
      card.title.textContent = now.artist + ' - ' + now.title;
      this._note(card, this._t('Looking up the lyrics…'));
      const token = ++card.token;
      let result;
      try { result = await window.vex.lyricsGet({ artist: now.artist, track: now.title, album: now.album, duration: now.duration }); }
      catch (err) { result = { status: 'error', message: err.message }; }
      if (this._card !== card || card.token !== token) return;
      this._show(card, this.viewFor(result));
      card.retryAt = this.retryDelay(result) ? Date.now() + this.retryDelay(result) : 0;
    }
    card.anchor = { position: now.position, at: Date.now(), paused: now.paused !== false };
    this._follow(card);
  },

  // Highlights the line for the position now (read position plus the time since it was read, while playing), and wakes up
  // again exactly when the next line starts if that is before the next read, so a line never lags a whole second.
  _follow(card) {
    clearTimeout(card.hl);
    if (this._card !== card || !card.lines || !card.anchor) return;
    const a = card.anchor;
    const at = a.position + (a.paused ? 0 : (Date.now() - a.at) / 1000) + this.LEAD_S;
    const idx = this.indexAt(card.lines, at);
    this._highlight(card, idx);
    const next = card.lines[idx + 1];
    if (a.paused || !next) return;
    const wait = (next[0] - at) * 1000;
    if (wait < this.POLL_MS + 100) card.hl = setTimeout(() => this._follow(card), Math.max(20, wait));
  },
};

if (typeof window !== 'undefined') window.VexLyrics = VexLyrics;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLyrics };
