// === Vex Master Volume — one slider (0–500%) for all media across every tab ===
//
// Quick Tools → "Master Volume" opens a slider that sets the volume of every
// <video>/<audio> in every tab AND sidebar panel, in real time, up to 500%.
//
// Boost >100% (and reliable control even when a site manages its own volume)
// needs Web Audio: we tap each media element through a GainNode → destination
// and set gain.value. Routing a CROSS-ORIGIN element through Web Audio would
// silence it unless it's CORS-clean — so Vex adds Access-Control-Allow-Origin to
// media responses (main process) and this script flips such elements to
// crossOrigin="anonymous" and reloads them (preserving position) so they become
// tappable and boost too. DRM/EME media (Netflix/Disney+) still can't be tapped
// (protected audio) — those stay on element.volume (0–100%). Streaming players
// (YouTube/Spotify) use MSE/blob: sources, which are same-origin → boost directly.
// If the site already tapped the element (rare) the gain graph can't be created —
// falls back to element.volume.
//
// Level (a gain multiplier, 1 = 100%) persists in localStorage 'vex.masterVolume'
// and is re-applied to new pages on dom-ready (wired in webview.js).

const MasterVolume = {
  KEY: 'vex.masterVolume',
  MAX: 5, // 500%
  _el: null,
  _onKey: null,
  _onDoc: null,

  // Major DRM (Widevine/EME) video services whose audio can't be boosted past
  // 100% — Web Audio isn't allowed to touch protected media. Used to show a note
  // in the popup so the slider isn't a mystery on those sites.
  _DRM_HOSTS: /(^|\.)(netflix\.com|disneyplus\.com|hotstar\.com|primevideo\.com|max\.com|hbomax\.com|hulu\.com|peacocktv\.com|paramountplus\.com|tv\.apple\.com)$/i,
  _activeHostIsDrm() {
    try {
      const t = (typeof TabManager !== 'undefined') && TabManager.getActiveTab && TabManager.getActiveTab();
      if (!t || !t.url) return false;
      return this._DRM_HOSTS.test(new URL(t.url).hostname.replace(/^www\./, ''));
    } catch { return false; }
  },

  level() {
    try { const v = parseFloat(localStorage.getItem(this.KEY)); return (Number.isFinite(v) && v >= 0 && v <= this.MAX) ? v : 1; }
    catch { return 1; }
  },
  _setLevel(v) { try { localStorage.setItem(this.KEY, String(v)); } catch {} },

  // Idempotent per-page injector. Installs a Web-Audio gain tap per media element
  // (with a same-origin guard + element.volume fallback) and keeps enforcing on
  // play / newly-added media.
  _script(g) {
    return `(function(target){try{
      if(window.__vexMV){ window.__vexMV.set(target); return; }
      // One AudioContext and one MediaElementSource per element, shared with
      // Night mode (night-audio.js): an element can only be routed once, so a
      // second createMediaElementSource threw and the two features broke each
      // other (found 2026-09-29). Each element's route ends in a shared "out"
      // gain, which is the gain this slider sets.
      var A=window.__vexAudio||(window.__vexAudio={ctx:null,nodes:new WeakMap()});
      var ctx=null;
      function getCtx(){ if(!ctx){ try{ ctx=A.ctx||(A.ctx=new (window.AudioContext||window.webkitAudioContext)()); ctx.addEventListener('statechange',function(){ if(ctx.state==='running') applyAll(); }); }catch(e){ return null; } } return ctx; }
      function shared(m){ var n=A.nodes.get(m); if(n) return n; var source=A.ctx.createMediaElementSource(m); var out=A.ctx.createGain(); source.connect(out); out.connect(A.ctx.destination); n={source:source,out:out}; A.nodes.set(m,n); return n; }
      function resume(){ try{ var c=getCtx(); if(c&&c.state==='suspended'){ c.resume().then(applyAll).catch(function(){}); } }catch(e){} }
      function sameOrigin(m){ try{ var s=m.currentSrc||m.src||''; if(!s) return true; if(s.lastIndexOf('blob:',0)===0||s.lastIndexOf('data:',0)===0||s.lastIndexOf('mediastream:',0)===0) return true; var u=new URL(s, location.href); if(u.origin===location.origin) return true; return m.crossOrigin==='anonymous'||m.crossOrigin==='use-credentials'; }catch(e){ return false; } }
      // DRM/EME media (Netflix/Disney+/Prime) can't be routed through Web Audio —
      // tapping it silences the protected audio. Detect it and skip the tap, so
      // those fall back to element.volume (0–100% works, no boost, no silence).
      function canTap(m){ try{ if(m.mediaKeys) return false; }catch(e){} return sameOrigin(m); }
      // Per element: rec.gain is its Web-Audio "out" gain once tapped; rec.base
      // is the level the page itself wants (the per-site figure from
      // site-volume.js, else what the site set), rec.wrote what we last put on
      // the element. The element always plays min(1, g) x base, and a boost
      // above 100% is the gain alone. Tapping used to force element.volume to
      // 1 and never put it back, so a site kept at 40% came out of a boost at
      // 100%; and turning an element down to the master level alone made a
      // site kept at 40% louder at 50% (both found 2026-09-29).
      var map=new WeakMap();
      var st={g:target};
      function isDrm(m){ try{ return !!m.mediaKeys; }catch(e){ return false; } }
      function tap(m,rec){
        var c=getCtx();
        if(c && c.state!=='running'){ resume(); }
        if(c && c.state==='running'){
          try{ rec.gain=shared(m).out; return true; }catch(e){}
        }
        return false;
      }
      // Boost above 100% needs Web Audio, which SILENCES a cross-origin media
      // element unless it's CORS-clean. Vex adds Access-Control-Allow-Origin to
      // media responses (main process), so we can flip the element to
      // crossOrigin="anonymous" and reload it (preserving position) to make it
      // tappable. On CORS failure we revert to plain volume. DRM is never touched.
      function makeCors(m,rec){
        try{
          var srcUrl=m.currentSrc||m.src||'';
          if(!srcUrl || srcUrl.lastIndexOf('blob:',0)===0 || srcUrl.lastIndexOf('data:',0)===0) return false;
          var t=0; try{ t=m.currentTime; }catch(e){}
          var wasPlaying=!m.paused;
          rec.corsTried=true;
          m.crossOrigin='anonymous';
          var onErr=function(){ try{ m.removeEventListener('error',onErr); m.crossOrigin=null; m.load(); try{ m.currentTime=t; }catch(e){} if(wasPlaying) m.play().catch(function(){}); }catch(e){} };
          var onReady=function(){ try{ m.removeEventListener('canplay',onReady); m.currentTime=t; }catch(e){} if(wasPlaying) m.play().catch(function(){}); resume(); hook(m); };
          m.addEventListener('error',onErr,{once:true});
          m.addEventListener('canplay',onReady,{once:true});
          m.load();
          if(wasPlaying) m.play().catch(function(){});
          return true;
        }catch(e){ return false; }
      }
      // A volume on the element that is not the one we wrote was set by the
      // site (its own slider): that becomes the level it wants.
      function level(m,rec){
        var base=(typeof window.__vexVolume==='number') ? window.__vexVolume
          : (rec.wrote==null || Math.abs(m.volume-rec.wrote)>0.001) ? m.volume : rec.base;
        rec.base=base;
        var v=Math.min(1,st.g)*base;
        if(Math.abs(m.volume-v)>0.0001){ try{ m.volume=v; }catch(e){} }
        rec.wrote=v;
      }
      function hook(m){
        try{
          var rec=map.get(m);
          if(!rec){
            // At 100% an element Vex never touched is left alone, so the
            // site's own slider and the per-site volume keep working; this ran
            // on every DOM change and pinned every video at 1 (found 2026-09-29).
            if(st.g===1) return;
            rec={gain:null,corsTried:false,base:null,wrote:null};
            map.set(m,rec);
          }
          if(!rec.gain && st.g>1 && !isDrm(m)){
            if(canTap(m)) tap(m,rec);
            // Cross-origin, not yet tried: convert to CORS + reload, then re-hook.
            else if(!rec.corsTried){ if(makeCors(m,rec)) return; }
          }
          if(rec.gain) rec.gain.gain.value=Math.max(1,st.g);
          level(m,rec);
        }catch(e){}
      }
      function applyAll(){ try{ document.querySelectorAll('video,audio').forEach(hook); }catch(e){} }
      st.set=function(v){ st.g=v; resume(); applyAll(); };
      window.__vexMV=st;
      resume(); applyAll();
      try{ new MutationObserver(applyAll).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
      document.addEventListener('play',function(e){ resume(); var t=e.target; if(t&&(t.tagName==='VIDEO'||t.tagName==='AUDIO')) hook(t); },true);
      // Any page interaction → resume the context (gives boost a chance to engage).
      ['pointerdown','keydown','click'].forEach(function(ev){ document.addEventListener(ev, resume, true); });
    }catch(e){}})(${g});`;
  },

  // In every frame of the page (vexGuestEvalFrames, site-volume.js): a player
  // embedded in an iframe was never reached (found 2026-09-29).
  applyToWebview(wv) {
    if (!wv) return;
    // A page that could not take it is said in the console, not swallowed.
    try { window.vexGuestEvalFrames(wv, this._script(this.level())).catch(err => console.warn('[MasterVolume] could not apply to a page:', err && err.message)); }
    catch (err) { console.warn('[MasterVolume] could not apply to a page:', err && err.message); }
  },

  // A player frame the page adds after it loaded gets the level too
  // (site-volume.js); dom-ready covers only the page itself.
  init() {
    window.vexOnLateFrame((wv) => { if (this.level() !== 1) this.applyToWebview(wv); });
    return this;
  },

  _allWebviews() {
    const out = [];
    try { if (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) for (const w of WebviewManager.webviews.values()) out.push(w); } catch {}
    try { if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) for (const k in SidebarManager.panelWebviews) { const w = SidebarManager.panelWebviews[k]; if (w) out.push(w); } } catch {}
    return out;
  },

  apply(g) {
    this._setLevel(g);
    const script = this._script(g);
    for (const wv of this._allWebviews()) {
      try { window.vexGuestEvalFrames(wv, script).catch(err => console.warn('[MasterVolume] could not apply to a page:', err && err.message)); }
      catch (err) { console.warn('[MasterVolume] could not apply to a page:', err && err.message); }
    }
  },

  show() {
    this.close();
    this._injectStyles();
    const pct = Math.round(this.level() * 100);
    const el = document.createElement('div');
    el.className = 'mastervol-pop';
    el.innerHTML = `
      <div class="mastervol-head"><span class="mastervol-title">${VexIcons.svg('sliders', { size: 15 })}Master Volume</span> <span class="mastervol-pct">${pct}%</span></div>
      <div class="mastervol-row">
        <button class="mastervol-mute" title="Mute / unmute">${VexIcons.svg(pct === 0 ? 'mute' : 'volume', { size: 18 })}</button>
        <input class="mastervol-slider" type="range" min="0" max="500" step="5" value="${pct}">
      </div>
      <div class="mastervol-ticks"><span style="--at:0">0</span><span style="--at:0.2">100</span><span style="--at:0.5">250</span><span style="--at:1">500%</span></div>
      <div class="mastervol-sub">Applies to every tab &amp; panel · above 100% boosts louder than the source</div>
      <div class="mastervol-drm" hidden>${VexIcons.svg('lock', { size: 12 })} This site's audio is DRM‑protected (Netflix / Disney+ / Prime), so it can't be boosted past 100% here — that's a streaming restriction, not a Vex limit. To make those louder, use a Windows system booster like <b>Equalizer APO</b> (free).</div>`;
    document.body.appendChild(el);
    this._el = el;

    const slider = el.querySelector('.mastervol-slider');
    const pctEl = el.querySelector('.mastervol-pct');
    const mute = el.querySelector('.mastervol-mute');
    const drmNote = el.querySelector('.mastervol-drm');
    const isDrm = this._activeHostIsDrm();
    let lastNonZero = pct || 100;
    // Opening the panel only shows the level; nothing is applied to any page
    // until the slider or mute actually moves (found 2026-09-29: opening it at
    // 100% injected the script into every tab and pinned all media volume).
    const set = (p, apply = true) => {
      p = Math.max(0, Math.min(500, Math.round(p)));
      slider.value = p; pctEl.textContent = p + '%';
      pctEl.style.color = p > 100 ? 'var(--warning, #e8b84a)' : 'var(--primary, #6366f1)';
      mute.innerHTML = VexIcons.svg(p === 0 ? 'mute' : 'volume', { size: 18 });
      // On DRM streaming sites, explain why boost above 100% won't take effect.
      if (drmNote) drmNote.hidden = !(p > 100 && isDrm);
      if (p > 0) lastNonZero = p;
      if (apply) this.apply(p / 100);
    };
    slider.addEventListener('input', () => set(+slider.value));
    mute.addEventListener('click', () => set(+slider.value === 0 ? lastNonZero : 0));
    set(pct, false); // colourise the % label on open

    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
    this._onDoc = (e) => { if (this._el && !this._el.contains(e.target)) this.close(); };
    // Page <webview> clicks bypass the host document, so also close on window
    // blur (focus into the guest fires it) or the popup stays stuck open.
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

  _injectStyles() {
    if (document.getElementById('mastervol-styles')) return;
    const st = document.createElement('style');
    st.id = 'mastervol-styles';
    st.textContent = `
      .mastervol-pop{position:fixed;z-index:100001;top:64px;left:50%;transform:translateX(-50%);
        width:340px;max-width:calc(100vw - 24px);padding:14px 16px;border-radius:14px;
        background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.10));
        box-shadow:0 18px 50px rgba(0,0,0,0.5);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
        font-family:inherit;animation:mastervolIn .13s ease;}
      @keyframes mastervolIn{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
      .mastervol-head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;color:var(--text,#e9e9ee);margin-bottom:12px;}
      .mastervol-pct{font-variant-numeric:tabular-nums;font-weight:700;}
      .mastervol-row{display:flex;align-items:center;gap:10px;}
      .mastervol-mute{flex:0 0 auto;border:none;background:transparent;color:inherit;cursor:pointer;line-height:0;padding:2px;border-radius:6px;}
      .mastervol-title{display:inline-flex;align-items:center;gap:7px;}
      .mastervol-slider{flex:1;accent-color:var(--primary,#6366f1);height:4px;cursor:pointer;}
      /* Each label sits under its real slider position (value/500 of the track,
         inset by half the thumb); space-between put 100 and 250 at 27%/56%
         (found 2026-09-29). margin-left = mute button + gap. */
      .mastervol-ticks{position:relative;height:12px;font-size:9.5px;color:var(--text-muted,#9a9aa5);margin:4px 0 0 32px;}
      .mastervol-ticks span{position:absolute;top:0;left:calc(8px + (100% - 16px) * var(--at));transform:translateX(-50%);white-space:nowrap;}
      .mastervol-ticks span:last-child{left:auto;right:0;transform:none;}
      .mastervol-sub{margin-top:10px;font-size:11px;color:var(--text-muted,#9a9aa5);line-height:1.4;}
      .mastervol-drm{margin-top:8px;padding:8px 10px;font-size:11px;line-height:1.45;border-radius:8px;
        color:var(--text,#e9e9ee);background:rgba(232,184,74,0.12);border:1px solid rgba(232,184,74,0.4);}
      .mastervol-drm[hidden]{display:none;}
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.MasterVolume = MasterVolume;
// site-volume.js loads first (index.html); in a unit test on its own it is absent.
if (typeof window !== 'undefined' && typeof window.vexOnLateFrame === 'function') MasterVolume.init();
if (typeof module !== 'undefined' && module.exports) module.exports = { MasterVolume };
