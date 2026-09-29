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
      let touched = 0;
      for (const media of document.querySelectorAll('video,audio')) {
        try { attach(media); route(media, state.on); touched++; } catch (e) { return { ok: false, name: e && e.name, error: String(e && e.message || e) }; }
      }
      if (state.ctx && state.ctx.state === 'suspended') state.ctx.resume();
      if (!state.wired) {
        state.wired = true;
        // Anything that starts playing later — the next track, the next video.
        document.addEventListener('play', (e) => {
          const media = e.target;
          if (!(media instanceof HTMLMediaElement) || !window.__vexNight.on) return;
          try { attach(media); route(media, true); } catch (err) {}
        }, true);
      }
      return { ok: true, touched };
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

  async apply(wv, on) {
    const res = await window.vexGuestEval(wv, this.script(on), true, 6000);
    // Say what actually went wrong: every failure used to be reported as
    // another site's audio (found 2026-09-29).
    if (!res || !res.ok) {
      const why = res && res.name === 'CrossOrigin' ? 'it comes from another site that does not allow it'
        : res && res.name === 'InvalidStateError' ? 'the page already sends it through its own audio processing'
        : 'the page refused (' + ((res && res.error) || 'no answer') + ')';
      throw new Error('This page’s sound cannot be evened out — ' + why);
    }
    return res.touched;
  },

  async toggle() {
    const t = this._tab();
    const on = !this.isOn(t.url);
    const touched = await this.apply(t.wv, on);
    this.remember(t.url, on);
    window.showToast?.(on
      ? (touched ? 'Night mode on for ' + this.host(t.url) + ' — quiet parts up, loud parts held down' : 'Night mode on for ' + this.host(t.url) + ' — it will apply when something plays')
      : 'Night mode off for ' + this.host(t.url));
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
