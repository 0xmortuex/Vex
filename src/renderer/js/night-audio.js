// === Night mode for sound =================================================
//
// A film at eleven at night is the same problem every time: the dialogue is
// too quiet to hear and the next explosion wakes the house, so you sit with a
// hand on the volume. This evens the two out — quiet parts up, loud parts held
// down — per site, and remembers which sites you want it on.
//
// It works by putting the page's own audio through a compressor (the Web
// Audio API's, which every Chromium has), so it applies to whatever the page
// plays, including tracks that start later.
//
// One thing it cannot do: audio a site serves from another host without
// permission to read it. The browser hands back silence for those rather than
// samples (it does not throw), so such media is checked before it is touched
// and left alone, and the page says so instead of leaving you with a muted film.
const NightAudio = {
  KEY: 'vex.nightAudio',

  hosts() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  isOn(url) { const h = this.host(url); return !!h && this.hosts().includes(h); },

  remember(url, on) {
    const h = this.host(url);
    if (!h) throw new Error('That is not a web page');
    const list = new Set(this.hosts());
    if (on) list.add(h); else list.delete(h);
    try { localStorage.setItem(this.KEY, JSON.stringify([...list].slice(-200))); } catch {}
    return on;
  },

  // Runs in the page. Everything hangs off window.__vexNight so turning it on
  // twice does not stack two compressors on the same sound.
  script(on) {
    return `(() => {
      const state = window.__vexNight || (window.__vexNight = { nodes: new WeakMap(), on: false, ctx: null });
      // A media element can only ever be routed once; a second call throws,
      // and the element would go silent. Master Volume (master-volume.js)
      // routes elements too, so both share one context and one source per
      // element in window.__vexAudio, each route ending in its "out" gain
      // (found 2026-09-29: the second feature threw InvalidStateError).
      const A = window.__vexAudio || (window.__vexAudio = { ctx: null, nodes: new WeakMap() });
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
      // Media from another host without CORS plays as silence through Web
      // Audio rather than throwing, so it is checked first and left alone
      // (the same test Master Volume uses).
      const sameOrigin = (m) => {
        try {
          const s = m.currentSrc || m.src || '';
          if (!s) return true;
          if (/^(blob|data|mediastream):/.test(s)) return true;
          if (new URL(s, location.href).origin === location.origin) return true;
          return m.crossOrigin === 'anonymous' || m.crossOrigin === 'use-credentials';
        } catch (e) { return false; }
      };
      const attach = (media) => {
        if (state.nodes.has(media)) return true;
        if (!sameOrigin(media)) { const err = new Error('the sound comes from another site'); err.name = 'CrossOrigin'; throw err; }
        state.ctx = A.ctx = A.ctx || new (window.AudioContext || window.webkitAudioContext)();
        const { source, out } = shared(media);
        const comp = state.ctx.createDynamicsCompressor();
        comp.threshold.value = -34;    // where holding down starts
        comp.knee.value = 28;
        comp.ratio.value = 10;
        comp.attack.value = 0.004;
        comp.release.value = 0.26;
        const makeup = state.ctx.createGain();
        makeup.gain.value = 1.9;       // put back what the squeeze took off
        const direct = state.ctx.createGain();
        source.disconnect();
        source.connect(comp); comp.connect(makeup); makeup.connect(out);
        state.nodes.set(media, { source, comp, makeup, direct, out });
        return true;
      };
      const route = (media, through) => {
        const n = state.nodes.get(media);
        if (!n) return;
        try { n.source.disconnect(); } catch (e) {}
        try { n.makeup.disconnect(); } catch (e) {}
        if (through) { n.source.connect(n.comp); n.comp.connect(n.makeup); n.makeup.connect(n.out); }
        else { n.source.connect(n.out); }
      };

      state.on = ${on ? 'true' : 'false'};
      // Off only puts back what was routed: attaching on the way off threw for
      // another site's audio, so Night mode could not be switched off. On
      // skips such media and carries on; one of them used to stop it for the
      // whole page (both found 2026-09-29).
      let touched = 0, skipped = 0, failed = null;
      for (const media of document.querySelectorAll('video,audio')) {
        if (!state.on) { if (state.nodes.has(media)) { route(media, false); touched++; } continue; }
        try { attach(media); route(media, true); touched++; }
        catch (e) {
          if (e && e.name === 'CrossOrigin') skipped++;
          else if (!failed) failed = { name: e && e.name, error: String(e && e.message || e) };
        }
      }
      if (state.ctx && state.ctx.state === 'suspended') state.ctx.resume();
      const frames = document.querySelectorAll('iframe,frame').length;
      if (!touched && (skipped || failed)) return { ok: false, skipped, frames, name: failed ? failed.name : 'CrossOrigin', error: failed ? failed.error : 'the sound comes from another site' };
      if (!state.wired) {
        state.wired = true;
        // Anything that starts playing later — the next track, the next video.
        document.addEventListener('play', (e) => {
          const media = e.target;
          if (!(media instanceof HTMLMediaElement) || !window.__vexNight.on) return;
          try { attach(media); route(media, true); } catch (err) {}
        }, true);
      }
      return { ok: true, touched, skipped, frames };
    })()`;
  },

  _tab() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || (tab && tab.url) || ''; } catch { url = (tab && tab.url) || ''; }
    if (!wv || !/^https?:/i.test(url)) throw new Error('Open a page that plays something first');
    return { url, wv };
  },

  // Runs in every frame the main process can reach (vexGuestEvalFrames in
  // site-volume.js): a player embedded in an iframe was never evened out,
  // and the toast said it would be (found 2026-09-29).
  // → { touched, skipped, unreached }.
  async apply(wv, on) {
    const r = await window.vexGuestEvalFrames(wv, this.script(on), true, 6000);
    let touched = 0, skipped = 0, frames = 0, unreached = 0, refused = null;
    for (const f of r.results) {
      if (!f.ok) { unreached++; continue; }          // a frame that did not answer
      const res = f.value;
      if (!res) { refused = refused || { error: 'no answer' }; continue; }
      touched += res.touched || 0; skipped += res.skipped || 0; frames += res.frames || 0;
      if (!res.ok) refused = refused || res;
    }
    if (!r.all) unreached = frames;
    // It fails only when nothing at all could be evened out. Say what actually
    // went wrong: every failure used to be reported as another site's audio
    // (found 2026-09-29).
    if (!touched && refused) {
      const why = refused.name === 'CrossOrigin' ? 'it comes from another site that does not allow it'
        : refused.name === 'InvalidStateError' ? 'the page already sends it through its own audio processing'
        : 'the page refused (' + (refused.error || 'no answer') + ')';
      throw new Error('This page’s sound cannot be evened out — ' + why
        + (skipped ? ' (' + skipped + (skipped === 1 ? ' player' : ' players') + ' from another site skipped)' : ''));
    }
    return { touched, skipped, unreached };
  },

  async toggle() {
    const t = this._tab();
    const on = !this.isOn(t.url);
    const r = await this.apply(t.wv, on);
    this.remember(t.url, on);
    const host = this.host(t.url);
    const skippedNote = r.skipped ? ' (' + r.skipped + (r.skipped === 1 ? ' player' : ' players') + ' from another site left as ' + (r.skipped === 1 ? 'it was)' : 'they were)') : '';
    const framesNote = r.unreached ? ' — not inside the ' + (r.unreached === 1 ? 'embedded frame' : r.unreached + ' embedded frames') + ' on this page, which Vex cannot reach' : '';
    if (!on) window.showToast?.('Night mode off for ' + host);
    else if (r.touched) window.showToast?.('Night mode on for ' + host + ' — quiet parts up, loud parts held down' + skippedNote + framesNote);
    // Nothing reached, but there are frames it could not look into: the
    // player is probably in one, so "it will apply" would not be true.
    else if (r.unreached) window.showToast?.('Night mode on for ' + host + framesNote, 'warn');
    else window.showToast?.('Night mode on for ' + host + ' — it will apply when something plays');
    return on;
  },

  // A site you switched it on for gets it back on the next visit, once there
  // is something to apply it to.
  init() {
    document.addEventListener('vex:tab-navigated', (e) => {
      const { tabId, url } = e.detail || {};
      if (!this.isOn(url || '')) return;
      const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tabId) : null;
      if (!wv) return;
      this.apply(wv, true).catch(err => window.VexProblems?.note('Night mode', 'Could not even out the sound on ' + this.host(url), err));
    });
    return this;
  },
};

if (typeof window !== 'undefined') window.NightAudio = NightAudio;
if (typeof module !== 'undefined' && module.exports) module.exports = { NightAudio };
