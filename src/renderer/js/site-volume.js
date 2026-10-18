// === The volume you keep a site at =========================================
//
// YouTube at 40%, Spotify at 80%, one noisy site at 10%: setting it per tab
// meant setting it again on every visit, because a page's volume belongs to
// its media elements and those are new each time. Vex remembers the figure
// per site and puts it back when the site opens, including on media the page
// adds later (a playlist's next track, a video that autoplays on scroll).

// Run a script in every frame of a guest page, when the main process offers
// it (page:eval-all-frames), else in the top frame only. A player embedded in
// an iframe was never reached by the page volume, Master Volume or Night mode,
// because webview.executeJavaScript runs in the top frame alone (found
// 2026-09-29). → { all, results: [{ ok, value } | { ok: false, error }] };
// `all` false means embedded frames were not reached, and callers must not
// claim they were. Shared by master-volume.js and night-audio.js.
async function vexGuestEvalFrames(wv, code, userGesture, timeoutMs) {
  if (window.vex && typeof window.vex.evalAllFrames === 'function') {
    // A tab closed in the meantime has no page left: getWebContentsId throws
    // "must be attached to the DOM" (found 2026-09-29).
    if (wv.isConnected === false) throw new Error('The tab was closed');
    const r = await window.vex.evalAllFrames(wv.getWebContentsId(), code, !!userGesture);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The page did not answer');
    return { all: true, results: r.results };
  }
  return { all: false, results: [{ ok: true, value: await window.vexGuestEval(wv, code, userGesture, timeoutMs) }] };
}

// Call fn(webview) when an embedded frame of a page finishes loading after
// the page itself. The page volume, Master Volume and Night mode were run
// once, at load, so a player iframe the page added later never got them
// (found 2026-09-29). <webview> events do not bubble, but they do pass
// through the document on the way down, so one capturing listener hears every
// tab and panel. A page's ad and tracker frames land in bursts, so each
// webview is answered once the burst has settled.
function vexOnLateFrame(fn, settleMs = 400) {
  const timers = new WeakMap();
  document.addEventListener('did-frame-finish-load', (e) => {
    const wv = e.target;
    if (e.isMainFrame || !wv || wv.tagName !== 'WEBVIEW') return;
    clearTimeout(timers.get(wv));
    timers.set(wv, setTimeout(() => { timers.delete(wv); if (wv.isConnected !== false) fn(wv); }, settleMs));
  }, true);
}

const SiteVolume = {
  KEY: 'vex.siteVolume',

  all() { try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } },
  host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  get(url) { const v = this.all()[this.host(url)]; return Number.isFinite(v) ? v : null; },

  set(url, percent) {
    const host = this.host(url);
    if (!host) throw new Error('That is not a web page');
    const v = Math.min(100, Math.max(0, Math.round(Number(percent))));
    if (!Number.isFinite(v)) throw new Error('Give a number from 0 to 100');
    const all = this.all();
    if (v === 100) delete all[host]; else all[host] = v;     // 100% is "nothing to remember"
    localStorage.setItem(this.KEY, JSON.stringify(all));
    return v;
  },

  forget(host) { const all = this.all(); delete all[host]; localStorage.setItem(this.KEY, JSON.stringify(all)); },

  // Runs in the page: sets what is there now, and anything that starts later.
  // Master Volume below 100% turns every page down by its share
  // (master-volume.js), so the figure kept here is scaled by it, never raised:
  // the two used to overwrite each other (found 2026-09-29).
  script(percent) {
    return `(() => {
      window.__vexVolume = ${Number(percent) / 100};
      const want = () => window.__vexVolume * (window.__vexMV && typeof window.__vexMV.g === 'number' ? Math.min(1, window.__vexMV.g) : 1);
      const set = (m) => { try { m.volume = want(); m.dataset.vexVolAt = String(Date.now()); } catch (e) {} };
      const media = document.querySelectorAll('video,audio');
      media.forEach(set);
      if (!window.__vexVolumeWired) {
        window.__vexVolumeWired = true;
        for (const type of ['play', 'loadedmetadata', 'volumechange']) {
          document.addEventListener(type, (e) => {
            const m = e.target;
            if (!(m instanceof HTMLMediaElement)) return;
            if (type === 'volumechange') {
              // The page putting its own figure back, in the first seconds of
              // a track, is corrected. Anything later is you moving the site's
              // own slider, and that wins.
              if (Math.abs(m.volume - want()) < 0.01) return;
              if (!m.dataset.vexVolAt || Date.now() - Number(m.dataset.vexVolAt) > 5000) return;
            }
            set(m);
          }, true);
        }
      }
      return { media: media.length, frames: document.querySelectorAll('iframe,frame').length };
    })()`;
  },

  // Set it on one open page now, in every frame the main process can reach.
  // → { media, unreachedFrames }: how many players took it, and how many
  // embedded frames were not reached, so a caller does not claim them.
  async applyTo(wv, percent) {
    const r = await vexGuestEvalFrames(wv, this.script(percent));
    let media = 0, frames = 0;
    for (const f of r.results) if (f.ok && f.value) { media += f.value.media || 0; frames += f.value.frames || 0; }
    return { media, unreachedFrames: r.all ? r.results.filter(f => !f.ok).length : frames };
  },

  async apply(tabId, url) {
    const v = this.get(url);
    if (v == null) return false;
    const wv = WebviewManager.webviews.get(tabId);
    if (!wv) return false;
    try { await this.applyTo(wv, v); return true; }
    catch (err) { window.VexProblems?.note('Site volume', 'Could not set the volume on ' + this.host(url), err); return false; }
  },

  init() {
    SitePlayback.init();
    document.addEventListener('vex:tab-navigated', (e) => this.apply(e.detail.tabId, e.detail.url));
    vexOnLateFrame((wv) => {
      let url = '';
      try { url = wv.getURL(); } catch { return; }       // closed while the frames settled
      const v = this.get(url);
      if (v == null) return;
      this.applyTo(wv, v).catch(err => window.VexProblems?.note('Site volume', 'Could not set the volume on ' + this.host(url), err));
    });
  },
};

// === Speed, captions, place and level, kept per site (T2-003) ==============
//
// The volume above was the only thing kept per site. The same sites also get a speed you
// always use (1.5x on a lecture site), captions you always turn on, and a video you were half
// way through. This keeps those too, on the same switch as the kept volume ("Volume kept per
// site": MasterVolume.siteMemoryEnabled), and puts them back when the site opens.
//
//   speed      a change of playbackRate on a page is kept for the site (1x forgets it)
//   captions   a subtitle or caption track the page's own <video> shows is kept as on for the
//              site and turned on again. A player that draws its own captions has no track to switch:
//              YouTube's has a small public player API (isSubtitlesOn, toggleSubtitlesOn), which is
//              the only thing called there (nothing in the page is clicked), once per video. Other
//              players that draw their own captions are not reached (CAPTION_PLAYERS lists the ones that are).
//   place      for a video of five minutes or more: where you stopped, per address, 100 kept;
//              within 30 s of the end it is forgotten
//   level      "Even out loudness on this site": a slow gain that pulls a quiet site up and a
//              loud one down to one level, remembered for the site. Only for sound Web Audio may
//              read: never a protected (DRM) player, never sound from another site, and the tap
//              only happens once the audio context is running, so nothing can go silent. A
//              player already tapped by Master Volume or Night mode shares its graph. With Night mode
//              on for the player the level is measured where Night mode leaves the sound (after its
//              compressor and make-up gain), so the two do not fight over the same loudness; it is
//              measured before the Master Volume gain, so that slider stays the person's: the leveller
//              sets how loud the sound is and Master Volume scales it.
//
// Nothing is kept for a private window, and nothing for a tab in a session of its own (container,
// Tor, proxy). The places are read from the page every 15 s while it is in front. Nothing leaves
// this computer.
const SitePlayback = {
  KEY: 'vex.sitePlayback',                 // { [host]: { rate?, captions?, level? } }
  RESUME_KEY: 'vex.sitePlayback.resume',   // { [address]: { t, d, at } }
  MIN_RESUME_S: 300,
  MIN_PLACE_S: 30,
  MAX_RESUME: 100,
  SAMPLE_MS: 15000,
  CAPTION_PLAYERS: ['YouTube'],

  enabled() {
    if (typeof VexTabPolicy !== 'undefined' && VexTabPolicy.isPrivateWindow) return false;
    return !(typeof MasterVolume !== 'undefined' && !MasterVolume.siteMemoryEnabled());
  },
  host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  // The address a place belongs to: no #fragment, and no t= (a link's own start time).
  addressKey(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      u.hash = ''; u.searchParams.delete('t');
      return u.host.toLowerCase().replace(/^www\./, '') + u.pathname + u.search;
    } catch { return ''; }
  },
  _read(key) {
    const raw = localStorage.getItem(key);
    if (raw == null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('"' + key + '" is not readable', { cause: err }); }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  sites() { return this._read(this.KEY); },
  forHost(url) { return this.sites()[this.host(url)] || null; },
  places() { return this._read(this.RESUME_KEY); },

  _saveHost(host, patch) {
    const all = this.sites();
    const cur = { ...(all[host] || {}), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] === undefined || cur[k] === false || cur[k] === null) delete cur[k];
    if (Object.keys(cur).length) all[host] = cur; else delete all[host];
    localStorage.setItem(this.KEY, JSON.stringify(all));
    return cur;
  },
  setLevel(url, on) {
    const host = this.host(url);
    if (!host) throw new Error('That is not a web page');
    return this._saveHost(host, { level: !!on });
  },
  // Everything kept for a site: its speed, captions and level, and the places of its videos.
  forget(url) {
    const host = this.host(url);
    if (!host) throw new Error('That is not a web page');
    const all = this.sites();
    const had = host in all;
    delete all[host];
    localStorage.setItem(this.KEY, JSON.stringify(all));
    const places = this.places();
    let n = 0;
    for (const k of Object.keys(places)) if (k.split('/')[0] === host) { delete places[k]; n++; }
    localStorage.setItem(this.RESUME_KEY, JSON.stringify(places));
    return { site: had, places: n };
  },

  // What a sample from a page says: { rate, captions, t, d, ended, href }. Keeps what changed.
  record(url, s, now = Date.now()) {
    const host = this.host(url);
    if (!host || !s || typeof s !== 'object') return false;
    let changed = false;
    if (Number.isFinite(s.rate) && s.rate >= 0.25 && s.rate <= 4) {
      const cur = (this.sites()[host] || {}).rate;
      const rate = Math.abs(s.rate - 1) < 0.01 ? undefined : Math.round(s.rate * 100) / 100;
      if (rate !== cur) { this._saveHost(host, { rate }); changed = true; }
    }
    if (typeof s.captions === 'boolean') {
      const cur = !!(this.sites()[host] || {}).captions;
      if (s.captions !== cur) { this._saveHost(host, { captions: s.captions }); changed = true; }
    }
    const key = this.addressKey(s.href || url);
    if (key && Number.isFinite(s.t) && Number.isFinite(s.d) && s.d >= this.MIN_RESUME_S) {
      const places = this.places();
      let moved = false;
      if (s.ended || s.t > s.d - this.MIN_PLACE_S || s.t < this.MIN_PLACE_S) {
        if (key in places) { delete places[key]; moved = true; }
      } else {
        places[key] = { t: Math.floor(s.t), d: Math.floor(s.d), at: now };
        const keys = Object.keys(places);
        if (keys.length > this.MAX_RESUME) keys.sort((a, b) => places[a].at - places[b].at).slice(0, keys.length - this.MAX_RESUME).forEach(k => { delete places[k]; });
        moved = true;
      }
      if (moved) { localStorage.setItem(this.RESUME_KEY, JSON.stringify(places)); changed = true; }
    }
    return changed;
  },

  // What to put back on a page: { rate, captions, level, resumeAt }.
  want(url) {
    const h = this.forHost(url) || {};
    const p = this.places()[this.addressKey(url)];
    return { rate: h.rate || null, captions: h.captions === true, level: h.level === true, resumeAt: p && p.t >= this.MIN_PLACE_S ? p.t : null };
  },

  // Runs in the page. Idempotent: a second run only changes what to put back.
  script(want) {
    const W = JSON.stringify({ rate: want.rate || null, captions: !!want.captions, level: !!want.level, resumeAt: want.resumeAt || null });
    return `(() => {
      const W = ${W};
      const P = window.__vexPlay || (window.__vexPlay = { state: {}, resumed: new WeakSet(), wired: new WeakSet(), leveled: new WeakMap(), setAt: 0 });
      P.want = W;
      const A = window.__vexAudio || (window.__vexAudio = { ctx: null, nodes: new WeakMap() });
      const media = () => Array.from(document.querySelectorAll('video,audio'));
      const main = () => media().reduce((b, m) => (!b || (m.duration || 0) > (b.duration || 0) ? m : b), null);
      const shared = (m) => {
        let n = A.nodes.get(m);
        if (n) return n;
        const source = A.ctx.createMediaElementSource(m);
        const out = A.ctx.createGain();
        source.connect(out); out.connect(A.ctx.destination);
        n = { source, out };
        A.nodes.set(m, n);
        return n;
      };
      const sameOrigin = (m) => {
        try {
          const s = m.currentSrc || m.src || '';
          if (!s) return true;
          if (/^(blob|data|mediastream):/.test(s)) return true;
          if (new URL(s, location.href).origin === location.origin) return true;
          return m.crossOrigin === 'anonymous' || m.crossOrigin === 'use-credentials';
        } catch (e) { return false; }
      };
      // A protected player is never touched: tapping it with Web Audio silences it.
      const protectedPlayer = (m) => { try { return !!m.mediaKeys; } catch (e) { return true; } };
      // YouTube draws its own captions. Its player object has a public switch for them; only that is called.
      const ytPlayer = () => {
        try {
          const h = location.hostname;
          if (h !== 'youtube.com' && !h.endsWith('.youtube.com')) return null;
          const p = document.getElementById('movie_player');
          return p && typeof p.isSubtitlesOn === 'function' && typeof p.toggleSubtitlesOn === 'function' ? p : null;
        } catch (e) { return null; }
      };
      const ytOn = () => { try { const p = ytPlayer(); return !!(p && p.isSubtitlesOn()); } catch (e) { return false; } };
      const levelUp = (m) => {
        if (P.leveled.has(m)) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (typeof Ctx !== 'function' || protectedPlayer(m) || !sameOrigin(m)) { P.leveled.set(m, { skipped: true }); return; }
        A.ctx = A.ctx || new Ctx();
        if (A.ctx.state !== 'running') {
          // Never tap a suspended context: the sound would stop. Try again once it runs.
          A.ctx.resume().then(() => { if (A.ctx.state === 'running' && P.want.level) levelUp(m); }).catch(() => {});
          return;
        }
        const n = shared(m);
        const an = A.ctx.createAnalyser(); an.fftSize = 2048;
        // Measured where Night mode leaves the sound when it is on for this player, else at the source; always
        // before the Master Volume gain (n.out), so that slider keeps scaling the leveled sound.
        const tapPoint = () => { const nt = window.__vexNight && window.__vexNight.on && window.__vexNight.nodes && window.__vexNight.nodes.get(m); return nt && nt.through && nt.makeup ? nt.makeup : n.source; };
        let from = tapPoint();
        from.connect(an);
        const lg = A.ctx.createGain();
        try { n.out.disconnect(A.ctx.destination); } catch (e) {}
        n.out.connect(lg); lg.connect(A.ctx.destination);
        const rec = { lg, rms: 0, pk: 0 };
        P.leveled.set(m, rec);
        const buf = new Float32Array(an.fftSize);
        rec.timer = setInterval(() => {
          if (!P.want.level) { lg.gain.setTargetAtTime(1, A.ctx.currentTime, 0.5); return; }
          if (m.paused || m.ended) return;
          const now = tapPoint();
          if (now !== from) { try { from.disconnect(an); } catch (e) {} now.connect(an); from = now; rec.rms = 0; rec.pk = 0; }
          an.getFloatTimeDomainData(buf);
          let s = 0, pk = 0;
          for (let i = 0; i < buf.length; i++) { const x = buf[i]; s += x * x; const a = x < 0 ? -x : x; if (a > pk) pk = a; }
          const rms = Math.sqrt(s / buf.length);
          if (rms < 0.003) return;
          rec.rms = rec.rms ? rec.rms * 0.9 + rms * 0.1 : rms;
          rec.pk = Math.max(pk, rec.pk * 0.995);
          let g = 0.1 / rec.rms;
          g = Math.min(g, 0.98 / Math.max(rec.pk, 0.05));
          g = Math.max(0.35, Math.min(2.5, g));
          lg.gain.setTargetAtTime(g, A.ctx.currentTime, 1.5);
        }, 500);
      };
      const put = (m) => {
        if (P.want.rate && Math.abs(m.playbackRate - P.want.rate) > 0.01) { P.setAt = Date.now(); m.playbackRate = P.want.rate; }
        if (P.want.captions) {
          const tracks = Array.from(m.textTracks || []).filter(t => t.kind === 'subtitles' || t.kind === 'captions');
          if (tracks.length && !tracks.some(t => t.mode === 'showing')) tracks[0].mode = 'showing';
          const yt = tracks.length ? null : ytPlayer();
          if (yt && P.ytKey !== location.href) { P.ytKey = location.href; try { if (!yt.isSubtitlesOn()) yt.toggleSubtitlesOn(); } catch (e) {} }
        }
        if (P.want.resumeAt && !P.resumed.has(m) && m.readyState >= 1 && m.duration > 300 && m.currentTime < 5) {
          P.resumed.add(m);
          m.currentTime = Math.min(P.want.resumeAt, m.duration - 30);
        }
        if (P.want.level) { try { levelUp(m); } catch (e) {} }
      };
      const sample = () => {
        const m = main();
        if (!m) return;
        const showing = Array.from(m.textTracks || []).some(t => (t.kind === 'subtitles' || t.kind === 'captions') && t.mode === 'showing') || ytOn();
        P.state = { rate: m.playbackRate, captions: showing };
      };
      const watch = (m) => {
        if (P.wired.has(m)) return;
        P.wired.add(m);
        m.addEventListener('ratechange', () => { if (Date.now() - P.setAt > 800) sample(); });
        try { m.textTracks.addEventListener('change', sample); } catch (e) {}
      };
      const all = media();
      all.forEach((m) => { put(m); watch(m); });
      if (!P.docWired) {
        P.docWired = true;
        for (const type of ['loadedmetadata', 'play', 'playing']) {
          document.addEventListener(type, (e) => { const m = e.target; if (m instanceof HTMLMediaElement) { put(m); watch(m); } }, true);
        }
      }
      return { media: all.length };
    })()`;
  },
  // Runs in the page: the biggest player's place now, and its speed and captions if the person changed them.
  readScript() {
    return `(() => {
      const m = Array.from(document.querySelectorAll('video,audio')).reduce((b, x) => (!b || (x.duration || 0) > (b.duration || 0) ? x : b), null);
      if (!m) return null;
      const P = window.__vexPlay;
      const own = P && P.state ? P.state : {};
      let showing = Array.from(m.textTracks || []).some(t => (t.kind === 'subtitles' || t.kind === 'captions') && t.mode === 'showing');
      try {
        const h = location.hostname, yt = (h === 'youtube.com' || h.endsWith('.youtube.com')) ? document.getElementById('movie_player') : null;
        if (!showing && yt && typeof yt.isSubtitlesOn === 'function') showing = !!yt.isSubtitlesOn();
      } catch (e) {}
      return { rate: typeof own.rate === 'number' ? own.rate : m.playbackRate, captions: typeof own.captions === 'boolean' ? own.captions : showing, t: m.currentTime, d: m.duration, ended: m.ended, href: location.href };
    })()`;
  },

  _mayKeep(tabId) {
    if (typeof TabManager === 'undefined') return true;
    const tab = TabManager.tabs.find(t => t.id === tabId);
    return !tab || typeof TabManager.windowMayAsk !== 'function' || TabManager.windowMayAsk(tab.partition);
  },
  async apply(wv, url) {
    if (!this.enabled()) return false;
    const want = this.want(url);
    if (!want.rate && !want.captions && !want.level && want.resumeAt == null) return false;
    await vexGuestEvalFrames(wv, this.script(want));
    return true;
  },
  // One look at the page in front: what it says is kept.
  async sampleActive() {
    if (!this.enabled() || typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return false;
    const id = TabManager.activeTabId;
    const wv = WebviewManager.webviews.get(id);
    const tab = TabManager.getActiveTab();
    if (!wv || !tab || !/^https?:\/\//i.test(tab.url || '') || !this._mayKeep(id)) return false;
    const r = await vexGuestEvalFrames(wv, this.readScript());
    for (const f of r.results) if (f.ok && f.value) return this.record(tab.url, f.value);
    return false;
  },

  async toggleLevel() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab || !/^https?:\/\//i.test(tab.url || '')) throw new Error('Open a page that plays something first');
    if (!this.enabled()) throw new Error('Turn on "Remember the volume for each site" in Settings > Volume first');
    const on = !((this.forHost(tab.url) || {}).level);
    this.setLevel(tab.url, on);
    const wv = WebviewManager.webviews.get(tab.id);
    if (wv) await vexGuestEvalFrames(wv, this.script(this.want(tab.url)));
    window.showToast?.(on ? 'Loudness on ' + this.host(tab.url) + ' is evened out from now on' : 'Loudness on ' + this.host(tab.url) + ' is left as the site sends it');
    return on;
  },

  init() {
    if (this._wired) return;
    this._wired = true;
    document.addEventListener('vex:tab-navigated', (e) => {
      const { tabId, url } = e.detail || {};
      const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tabId) : null;
      if (!wv || !/^https?:\/\//i.test(url || '') || !this._mayKeep(tabId)) return;
      this.apply(wv, url).catch(err => window.VexProblems?.note('Site playback', 'Could not put back the speed, captions or place on ' + this.host(url), err));
    });
    vexOnLateFrame((wv) => {
      let url = '';
      try { url = wv.getURL(); } catch { return; }
      this.apply(wv, url).catch(err => window.VexProblems?.note('Site playback', 'Could not put back the speed, captions or place on ' + this.host(url), err));
    });
    if (typeof VexJobs !== 'undefined') {
      VexJobs.every('Site playback memory', this.SAMPLE_MS, () => this.sampleActive().catch(err => window.VexProblems?.note('Site playback', 'Could not read the speed, captions or place', err)), { when: 'ui', feature: 'site-audio-memory' });
    }
    if (typeof VexModuleCommands !== 'undefined') {
      VexModuleCommands.set('siteplay:', [
        { id: 'siteplay:level', label: 'Even out loudness on this site (toggle)', hint: 'A slow level so quiet videos come up and loud ones come down; never for protected players', icon: 'volume',
          action: () => { this.toggleLevel().catch(err => window.showToast?.(err.message, 'error')); } },
        { id: 'siteplay:forget', label: 'Forget speed, captions and place for this site', hint: 'The kept volume is not touched', icon: 'trash',
          action: () => {
            try {
              const tab = TabManager.getActiveTab();
              if (!tab) throw new Error('Open a page first');
              const r = this.forget(tab.url);
              window.showToast?.(r.site || r.places ? 'Forgot what was kept for ' + this.host(tab.url) : 'Nothing was kept for ' + this.host(tab.url));
            } catch (err) { window.showToast?.(err.message, 'error'); }
          } },
      ]);
    }
  },
};

if (typeof window !== 'undefined') { window.SitePlayback = SitePlayback; window.SiteVolume = SiteVolume; window.vexGuestEvalFrames = vexGuestEvalFrames; window.vexOnLateFrame = vexOnLateFrame; }
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteVolume, SitePlayback, vexGuestEvalFrames, vexOnLateFrame };
