// === Vex Master Volume — one slider (0–500%) for all media across every tab ===
//
// Quick Tools → "Master Volume" (and Ctrl+K) opens a slider that sets the volume
// of every <video>/<audio> in every tab AND sidebar panel, in real time, up to 500%.
//
// Boost >100% (and reliable control even when a site manages its own volume)
// needs Web Audio: we tap each media element through a GainNode → destination
// and set gain.value. Routing a CROSS-ORIGIN element through Web Audio would
// silence it unless it's CORS-clean — so Vex adds Access-Control-Allow-Origin to
// media responses (main process) and this script flips such elements to
// crossOrigin="anonymous" and reloads them (preserving position) so they become
// tappable and boost too. Streaming players (YouTube/Spotify) use MSE/blob:
// sources, which are same-origin → boost directly.
//
// What reaches a player (found 2026-10-12, measured in the running app):
//   * players inside open shadow roots (custom player elements) and in shadow
//     roots made after this script ran (Element.attachShadow is watched);
//   * players that are never in the document (new Audio().play()): the first
//     play() call hooks them;
//   * a page's own Web Audio graph (games, web synths, sites that route their
//     own media): what it sends to its destination goes through one gain that
//     this slider sets, for audio contexts the page makes after this script ran.
//   * DRM/EME players (Netflix, Prime Video, Disney+): Vex's Widevine is a
//     software CDM and the decrypted sound is routable, so they boost too. A
//     tapped element cannot be un-tapped, so a protected player whose sound
//     stays digitally silent for 10 s after the tap is put back by reloading
//     the page once with boosting off for that tab (sessionStorage), and the
//     slider says the page is capped at 100%.
//
// The page script also answers report() for the slider's status line, so the
// slider says what it did on the page in front instead of doing nothing quietly.
//
// Level (a gain multiplier, 1 = 100%) persists in localStorage 'vex.masterVolume'
// and is re-applied to new pages on dom-ready (wired in webview.js).

const MasterVolume = {
  KEY: 'vex.masterVolume',
  MAX: 5, // 500%
  _el: null,
  _onKey: null,
  _onDoc: null,

  level() {
    try { const v = parseFloat(localStorage.getItem(this.KEY)); return (Number.isFinite(v) && v >= 0 && v <= this.MAX) ? v : 1; }
    catch { return 1; }
  },
  _setLevel(v) { try { localStorage.setItem(this.KEY, String(v)); } catch {} },

  // ---- A level kept for one site (T2-003) -------------------------------------------
  // The level above is for every tab and panel. A site that needs a boost (a quiet
  // video site) can keep its own, so the rest are not blasted by it: the person
  // chooses "Keep this level for <site>" in the slider's box. A kept level is
  // used for that site's pages instead of the level above. Off: every site uses
  // the level above, and what was kept stays saved.
  SITES_KEY: 'vex.masterVolume.sites',        // { [host]: gain }  (1 = 100%)
  MEMORY_KEY: 'vex.masterVolume.siteMemory',  // 'off' turns the kept levels off
  WARN_KEY: 'vex.masterVolume.warned',        // when the loud-level reminder was last shown
  WARN_EVERY_MS: 7 * 24 * 3600 * 1000,

  siteMemoryEnabled() { try { return localStorage.getItem(this.MEMORY_KEY) !== 'off'; } catch { return true; } },
  setSiteMemoryEnabled(on) { localStorage.setItem(this.MEMORY_KEY, on ? 'on' : 'off'); },
  hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  sites() {
    const raw = localStorage.getItem(this.SITES_KEY);
    if (raw === null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The levels kept per site could not be read', { cause: err }); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const [h, g] of Object.entries(o)) if (Number.isFinite(g) && g >= 0 && g <= this.MAX) out[h] = g;
    return out;
  },
  siteLevel(url) {
    if (!this.siteMemoryEnabled()) return null;
    const host = this.hostOf(url);
    if (!host) return null;
    const all = this.sites();
    // A level kept for example.com covers www.example.com and its subdomains.
    const key = Object.keys(all).find(h => host === h || host.endsWith('.' + h));
    return key === undefined ? null : all[key];
  },
  setSiteLevel(url, g) {
    const host = this.hostOf(url);
    if (!host) throw new Error('That is not a web page');
    if (!(Number.isFinite(g) && g >= 0 && g <= this.MAX)) throw new Error('A level is between 0% and ' + this.MAX * 100 + '%');
    const all = this.sites();
    all[host] = g;
    localStorage.setItem(this.SITES_KEY, JSON.stringify(all));
    return host;
  },
  forgetSite(host) {
    const all = this.sites();
    if (!(host in all)) return false;
    delete all[host];
    localStorage.setItem(this.SITES_KEY, JSON.stringify(all));
    return true;
  },
  // The level a page should have: the one kept for its site, else the level for every site.
  levelFor(url) {
    const kept = this.siteLevel(url);
    return kept === null ? this.level() : kept;
  },
  _urlOf(wv) { try { return typeof window.vexGuestUrl === 'function' ? window.vexGuestUrl(wv) : wv.getURL(); } catch { return ''; } },
  // Does this page need the script at all? (100% and nothing kept: no.)
  needsApply(wv) { return this.levelFor(this._urlOf(wv)) !== 1; },

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
      // Per element: rec.gain is its Web-Audio "out" gain once tapped; rec.base
      // is the level the page itself wants (the per-site figure from
      // site-volume.js, else what the site set), rec.wrote what we last put on
      // the element, rec.why the reason it could not be boosted. The element
      // always plays min(1, g) x base, and a boost above 100% is the gain
      // alone. Tapping used to force element.volume to 1 and never put it back,
      // so a site kept at 40% came out of a boost at 100%; and turning an
      // element down to the master level alone made a site kept at 40% louder
      // at 50% (both found 2026-09-29).
      var map=new WeakMap();
      var st={g:target};
      var noTap=false; try{ noTap=window.sessionStorage.getItem('__vexMVOff')==='1'; }catch(e){}
      function isDrm(m){ try{ return !!m.mediaKeys; }catch(e){ return false; } }
      function tap(m,rec){
        var c=getCtx();
        if(c && c.state!=='running'){ resume(); }
        if(c && c.state==='running'){
          try{ rec.gain=shared(m).out; return true; }
          catch(e){ rec.why=(e&&e.name==='InvalidStateError')?'routed':'tapfail'; }
        }
        return false;
      }
      // Protected (EME) sound that stays digitally silent after the tap: a
      // tap cannot be undone, so the page is reloaded once with boosting off.
      function silent(m,rec){
        rec.why='silent';
        var saved=false;
        try{ window.sessionStorage.setItem('__vexMVOff','1'); saved=true; }catch(e){}
        noTap=true;
        if(saved){ try{ location.reload(); }catch(e){} }
      }
      function watch(m,rec){
        if(rec.watching||rec.audible) return;
        var c=A.ctx, n=A.nodes.get(m);
        if(!c||!n||typeof c.createAnalyser!=='function') return;
        rec.watching=true;
        var an=c.createAnalyser(); an.fftSize=1024; n.out.connect(an);
        var buf=new Float32Array(an.fftSize), zero=0;
        var iv=setInterval(function(){
          try{
            if(m.paused||m.ended||m.muted||m.volume===0||m.readyState<3){ zero=0; return; }
            an.getFloatTimeDomainData(buf);
            var mx=0; for(var i=0;i<buf.length;i++){ var x=buf[i]<0?-buf[i]:buf[i]; if(x>mx) mx=x; }
            if(mx>0){ rec.audible=true; rec.watching=false; clearInterval(iv); try{ n.out.disconnect(an); }catch(e){} return; }
            if(++zero>=20){ clearInterval(iv); rec.watching=false; silent(m,rec); }
          }catch(e){ clearInterval(iv); rec.watching=false; }
        },500);
      }
      // Boost above 100% needs Web Audio, which SILENCES a cross-origin media
      // element unless it's CORS-clean. Vex adds Access-Control-Allow-Origin to
      // media responses (main process), so we can flip the element to
      // crossOrigin="anonymous" and reload it (preserving position) to make it
      // tappable. On CORS failure we revert to plain volume.
      function makeCors(m,rec){
        try{
          var srcUrl=m.currentSrc||m.src||'';
          if(!srcUrl || srcUrl.lastIndexOf('blob:',0)===0 || srcUrl.lastIndexOf('data:',0)===0) return false;
          var t=0; try{ t=m.currentTime; }catch(e){}
          var wasPlaying=!m.paused;
          rec.corsTried=true;
          // Until the reload answers, crossOrigin says "anonymous" but nothing
          // is known: a second slider move tapped it then, and a server that
          // refused (one on this computer or the local network gets no
          // header from Vex) left it tapped and silent.
          rec.corsPending=true;
          m.crossOrigin='anonymous';
          var onErr=function(){ try{ m.removeEventListener('error',onErr); m.removeEventListener('canplay',onReady); m.crossOrigin=null; m.load(); try{ m.currentTime=t; }catch(e){} if(wasPlaying) m.play().catch(function(){}); }catch(e){} rec.corsPending=false; rec.why='cors'; };
          var onReady=function(){ try{ m.removeEventListener('canplay',onReady); m.removeEventListener('error',onErr); m.currentTime=t; }catch(e){} rec.corsPending=false; if(wasPlaying) m.play().catch(function(){}); resume(); hook(m); };
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
            rec={gain:null,corsTried:false,base:null,wrote:null,why:null};
            map.set(m,rec);
          }
          if(!rec.gain && st.g>1 && !rec.corsPending && !rec.why){
            if(noTap && isDrm(m)) rec.why='silent';
            else if(sameOrigin(m)) tap(m,rec);
            // Cross-origin, not yet tried: convert to CORS + reload, then re-hook.
            else if(!rec.corsTried){ if(makeCors(m,rec)) return; }
            else rec.why='cors';
          }
          if(rec.gain){ rec.gain.gain.value=Math.max(1,st.g); if(isDrm(m)) watch(m,rec); }
          level(m,rec);
        }catch(e){}
      }
      // Every media element: the document, open shadow roots, and the roots
      // made after this script ran (closed ones too, through attachShadow).
      var roots=[], watched=(typeof WeakSet==='function')?new WeakSet():null;
      function eachMedia(fn){
        var n=0, seen=[];
        function walk(root,d){
          if(seen.indexOf(root)>=0) return; seen.push(root);
          try{ var list=root.querySelectorAll('video,audio'); for(var i=0;i<list.length;i++) fn(list[i]); }catch(e){}
          if(d>8) return;
          var w=null; try{ w=document.createTreeWalker(root,1); }catch(e){}
          var el; while(w && (el=w.nextNode()) && n++<60000){ var s=el.shadowRoot; if(s){ watchRoot(s); walk(s,d+1); } }
        }
        walk(document,0);
        var live=[];
        for(var j=0;j<roots.length;j++){
          var r=roots[j].deref?roots[j].deref():roots[j];
          if(r){ live.push(roots[j]); try{ if(r.host && r.host.isConnected) walk(r,1); }catch(e){} }
        }
        if(live.length!==roots.length) roots=live;
      }
      function watchRoot(r){
        try{
          if(watched){ if(watched.has(r)) return; watched.add(r); }
          new MutationObserver(function(){ try{ r.querySelectorAll('video,audio').forEach(hook); }catch(e){} }).observe(r,{childList:true,subtree:true});
          r.addEventListener('play',onPlay,true);
        }catch(e){}
      }
      function onPlay(e){ resume(); var t=e.target; if(t&&(t.tagName==='VIDEO'||t.tagName==='AUDIO')) hook(t); }
      function applyAll(){ try{ document.querySelectorAll('video,audio').forEach(hook); }catch(e){} }
      var lastDeep=0;
      function deep(force){ var now=Date.now(); if(!force && now-lastDeep<1500) return; lastDeep=now; try{ eachMedia(hook); }catch(e){} }

      // A player that is never in the page (new Audio().play()) and one made in
      // a closed shadow root are found by their first play(); Web Audio from
      // the page itself goes through one gain per context. Installed when the
      // level first leaves 100%, so a page at 100% is never touched.
      // The wrappers look the live instance up at call time and are marked, so
      // they are put on a prototype once however often this script runs.
      var patched=false, wa=[], masters=new WeakMap(), OC=null, OD=null;
      function masterFor(dest){
        var OFF=window.OfflineAudioContext, c=dest.context; if(!c||c===A.ctx||(OFF&&c instanceof OFF)) return null;
        var m=masters.get(c);
        if(!m){ m=c.createGain(); m.gain.value=st.g; OC.call(m,c.destination); masters.set(c,m); wa.push(typeof WeakRef==='function'?new WeakRef(m):m); }
        return m;
      }
      function patch(){
        if(patched) return; patched=true;
        try{
          var op=HTMLMediaElement.prototype.play;
          if(!op.__vexMV){
            var np=function(){ var r=op.apply(this,arguments); try{ var s=window.__vexMV; if(s&&s.hook) s.hook(this); }catch(e){} return r; };
            np.__vexMV=true; HTMLMediaElement.prototype.play=np;
          }
        }catch(e){}
        try{
          var oa=Element.prototype.attachShadow;
          if(!oa.__vexMV){
            var na=function(){ var r=oa.apply(this,arguments); try{ var s=window.__vexMV; if(s&&s.addRoot) s.addRoot(r); }catch(e){} return r; };
            na.__vexMV=true; Element.prototype.attachShadow=na;
          }
        }catch(e){}
        try{
          var AN=window.AudioNode, ADN=window.AudioDestinationNode;
          if(AN && ADN && AN.prototype && typeof AN.prototype.connect==='function'){
            OC=AN.prototype.connect; OD=AN.prototype.disconnect;
            if(!OC.__vexMV){
              var oc=OC, od=OD;
              var nc=function(dest){
                try{
                  var s=window.__vexMV;
                  if(s && s.masterFor && dest instanceof ADN){
                    var m=s.masterFor(dest);
                    if(m && this!==m && this.context===dest.context){ var a=Array.prototype.slice.call(arguments); a[0]=m; oc.apply(this,a); return dest; }
                  }
                }catch(e){}
                return oc.apply(this,arguments);
              };
              var nd=function(dest){
                try{
                  var s=window.__vexMV;
                  if(s && s.masterOf && dest instanceof ADN){
                    var m=s.masterOf(dest);
                    if(m && this!==m){ var a=Array.prototype.slice.call(arguments); a[0]=m; return od.apply(this,a); }
                  }
                }catch(e){}
                return od.apply(this,arguments);
              };
              nc.__vexMV=nd.__vexMV=true; nc.__orig=oc; nd.__orig=od; AN.prototype.connect=nc; AN.prototype.disconnect=nd;
            } else { OC=OC.__orig||OC; }
          }
        }catch(e){}
      }
      function waSet(v){
        for(var i=0;i<wa.length;i++){ var m=wa[i].deref?wa[i].deref():wa[i]; if(m){ try{ m.gain.value=v; }catch(e){} } }
      }

      st.hook=hook;
      st.addRoot=function(r){ try{ roots.push(typeof WeakRef==='function'?new WeakRef(r):r); watchRoot(r); }catch(e){} };
      st.masterFor=masterFor;
      st.masterOf=function(dest){ return masters.get(dest.context)||null; };
      st.set=function(v){ st.g=v; if(v!==1) patch(); waSet(v); resume(); applyAll(); deep(true); };
      // What the slider's status line says: how many players there are, how many
      // are boosted, and why the others are not.
      st.report=function(){
        var players=0, boosted=0, why={};
        try{ eachMedia(function(m){
          players++;
          if(st.g>1 && !map.get(m)) hook(m);
          var rec=map.get(m);
          if(!rec) return;
          if(rec.why==='silent') why.silent=(why.silent||0)+1;
          else if(rec.gain && st.g>1) boosted++;
          else if(rec.why && st.g>1) why[rec.why]=(why[rec.why]||0)+1;
        }); }catch(e){}
        var contexts=0; for(var i=0;i<wa.length;i++){ if(wa[i].deref?wa[i].deref():wa[i]) contexts++; }
        return {g:st.g,players:players,boosted:boosted,why:why,contexts:contexts};
      };
      window.__vexMV=st;
      if(target!==1) patch();
      waSet(target);
      resume(); applyAll(); deep(true);
      try{ new MutationObserver(applyAll).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
      document.addEventListener('play',onPlay,true);
      // Players in shadow roots made before this ran have no event and no
      // mutation that reaches here: looked for now and then while off 100%.
      setInterval(function(){ if(st.g!==1) deep(false); },2000);
      // Any page interaction → resume the context (gives boost a chance to engage).
      ['pointerdown','keydown','click'].forEach(function(ev){ document.addEventListener(ev, resume, true); });
    }catch(e){}})(${g});`;
  },

  // In every frame of the page (vexGuestEvalFrames, site-volume.js): a player
  // embedded in an iframe was never reached (found 2026-09-29).
  applyToWebview(wv) {
    if (!wv) return;
    // A page that could not take it is said in the console, not swallowed.
    try { window.vexGuestEvalFrames(wv, this._script(this.levelFor(this._urlOf(wv)))).catch(err => console.warn('[MasterVolume] could not apply to a page:', err && err.message)); }
    catch (err) { console.warn('[MasterVolume] could not apply to a page:', err && err.message); }
  },

  // A player frame the page adds after it loaded gets the level too
  // (site-volume.js); dom-ready covers only the page itself.
  init() {
    window.vexOnLateFrame((wv) => { if (this.needsApply(wv)) this.applyToWebview(wv); });
    // A level above 100% is louder than the source: said once a week, not every start.
    if (typeof VexJobs !== 'undefined') VexJobs.every('Loud volume reminder', 6 * 3600 * 1000, () => this.warnIfLoud(), { when: 'ui', feature: 'site-audio-memory' });
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('site-audio-memory', () => this.show());
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
    for (const wv of this._allWebviews()) {
      // A site with a level of its own keeps it; the slider moves the rest.
      const kept = this.siteLevel(this._urlOf(wv));
      const script = this._script(kept === null ? g : kept);
      try { window.vexGuestEvalFrames(wv, script).catch(err => console.warn('[MasterVolume] could not apply to a page:', err && err.message)); }
      catch (err) { console.warn('[MasterVolume] could not apply to a page:', err && err.message); }
    }
  },

  // One line in the Attention Inbox when the level for every site is above 100%.
  // -> true when it was added.
  warnIfLoud(now = Date.now()) {
    if (!this.siteMemoryEnabled()) return false;
    const g = this.level();
    if (g <= 1) return false;
    const last = Number(localStorage.getItem(this.WARN_KEY)) || 0;
    if (now - last < this.WARN_EVERY_MS) return false;
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded');
    localStorage.setItem(this.WARN_KEY, String(now));
    return VexAttention.suggest({
      feature: 'site-audio-memory', id: 'loud', label: 'Volume',
      title: 'Master volume is at ' + Math.round(g * 100) + '%, louder than the source',
      body: 'Every site is boosted, loud ones too. Keep a boost only for the sites that need it, and leave the rest at 100%.',
      action: { label: 'Open volume', key: 'open' },
    });
  },

  // The pages in front: the tab you are on and the panels showing beside it.
  _visibleWebviews() {
    const out = [];
    try { const wv = typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview && WebviewManager.getActiveWebview(); if (wv) out.push(wv); } catch {}
    try {
      if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) {
        for (const name of [SidebarManager.activePanel, SidebarManager.sidePanel]) {
          const w = name && SidebarManager.panelWebviews[name];
          if (w && !out.includes(w)) out.push(w);
        }
      }
    } catch {}
    return out;
  },

  // What the level did on the pages in front, added up over their frames.
  // → { players, boosted, contexts, why: { cors, routed, silent, tapfail }, pages }
  async status() {
    const total = { players: 0, boosted: 0, contexts: 0, why: {}, pages: 0, audible: 0 };
    for (const wv of this._visibleWebviews()) {
      const r = await window.vexGuestEvalFrames(wv, 'window.__vexMV && window.__vexMV.report ? window.__vexMV.report() : null');
      total.pages++;
      // Chromium knows whether the page is making sound, whoever makes it.
      if (typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()) total.audible++;
      for (const f of r.results) {
        if (!f.ok || !f.value) continue;
        total.players += f.value.players || 0;
        total.boosted += f.value.boosted || 0;
        total.contexts += f.value.contexts || 0;
        for (const k of Object.keys(f.value.why || {})) total.why[k] = (total.why[k] || 0) + f.value.why[k];
      }
    }
    return total;
  },

  // The status line for a level above 100%, in plain words ('' at or below it).
  describe(total, pct) {
    if (!(pct > 100)) return '';
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    const parts = [];
    if (total.boosted) parts.push('Boosting ' + plural(total.boosted, 'player') + ' on this page.');
    if (total.contexts) parts.push('The page\'s own audio engine is boosted too.');
    const w = total.why || {};
    if (w.silent) parts.push('Protected video (DRM): the browser cannot boost it above 100%. Use the video\'s own volume or Windows\' volume.');
    if (w.cors) parts.push(plural(w.cors, 'player') + ' stream' + (w.cors === 1 ? 's' : '') + ' from a server that does not allow boosting (one on your own network) and stay' + (w.cors === 1 ? 's' : '') + ' at 100%.');
    if (w.routed) parts.push(plural(w.routed, 'player') + ' already use' + (w.routed === 1 ? 's' : '') + ' the page\'s own audio processing and stay' + (w.routed === 1 ? 's' : '') + ' at 100%.');
    if (w.tapfail) parts.push(plural(w.tapfail, 'player') + ' could not be boosted.');
    // Sound the page makes in a way this slider could not reach: its own Web
    // Audio, started before the slider left 100%.
    if (!parts.length && total.audible) parts.push('This page makes its sound in a way Vex could not reach (it started before the boost). Reload the page to boost it.');
    if (!parts.length) parts.push(total.players ? 'Waiting for the sound to start.' : 'Nothing is playing on this page yet; it boosts when something does.');
    return parts.join(' ');
  },

  async _refreshStatus() {
    const el = this._el && this._el.querySelector('.mastervol-status');
    if (!el || this._statusBusy) return;
    this._statusBusy = true;
    try { await this._refreshStatusNow(el); } finally { this._statusBusy = false; }
  },

  async _refreshStatusNow(el) {
    const pct = +this._el.querySelector('.mastervol-slider').value;
    if (!(pct > 100)) { el.hidden = true; el.textContent = ''; return; }
    try {
      const total = await this.status();
      if (!this._el) return;
      el.textContent = this.describe(total, pct);
    } catch (err) {
      if (!this._el) return;
      el.textContent = 'Could not check the page: ' + ((err && err.message) || 'unknown');
    }
    el.hidden = false;
  },

  show() {
    this.close();
    this._injectStyles();
    const before = document.activeElement;
    const pct = Math.round(this.level() * 100);
    const el = document.createElement('div');
    el.className = 'mastervol-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Master Volume');
    el.innerHTML = `
      <div class="mastervol-head"><span class="mastervol-title">${VexIcons.svg('sliders', { size: 15 })}Master Volume</span> <span class="mastervol-pct">${pct}%</span></div>
      <div class="mastervol-row">
        <button class="mastervol-mute" title="Mute / unmute" aria-label="Mute / unmute">${VexIcons.svg(pct === 0 ? 'mute' : 'volume', { size: 18 })}</button>
        <input class="mastervol-slider" type="range" min="0" max="500" step="5" value="${pct}" aria-label="Master volume, in percent" aria-valuetext="${pct}%">
      </div>
      <div class="mastervol-ticks"><span style="--at:0">0</span><span style="--at:0.2">100</span><span style="--at:0.5">250</span><span style="--at:1">500%</span></div>
      <div class="mastervol-sub">Applies to every tab &amp; panel · above 100% boosts louder than the source</div>
      <div class="mastervol-warn" role="note" hidden>Above 100% is louder than the source: loud sites get louder too, and it can distort or tire your ears. Keep a boost only for the sites that need it.</div>
      <div class="mastervol-site"></div>
      <div class="mastervol-status" role="status" aria-live="polite" hidden></div>`;
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.popover(el, 'master-volume');
    this._el = el;
    this._prevFocus = before;

    const slider = el.querySelector('.mastervol-slider');
    const pctEl = el.querySelector('.mastervol-pct');
    const mute = el.querySelector('.mastervol-mute');
    const warn = el.querySelector('.mastervol-warn');
    const siteBox = el.querySelector('.mastervol-site');
    let lastNonZero = pct || 100;
    // "Keep this level for <site>" (T2-003): the site in front, if it is a web page.
    const frontUrl = () => { try { const t = typeof TabManager !== 'undefined' && TabManager.getActiveTab && TabManager.getActiveTab(); return t && t.url ? t.url : ''; } catch { return ''; } };
    const drawSite = () => {
      siteBox.textContent = '';
      if (!this.siteMemoryEnabled()) return;
      const url = frontUrl();
      const host = this.hostOf(url);
      if (!/^https?:/i.test(url) || !host) return;
      const kept = this.siteLevel(url);
      const mk = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mastervol-keep'; b.textContent = text; b.addEventListener('click', fn); return b; };
      const note = document.createElement('div');
      note.className = 'mastervol-keepnote';
      if (kept !== null) {
        note.textContent = host + ' keeps its own level: ' + Math.round(kept * 100) + '%. The slider does not move it.';
        siteBox.append(note, mk('Use the slider for ' + host + ' again', () => { try { this.forgetSite(Object.keys(this.sites()).find(h => host === h || host.endsWith('.' + h))); window.showToast?.(host + ' follows the slider again'); this.apply(this.level()); } catch (err) { window.showToast?.(err.message, 'error'); } drawSite(); }));
      } else {
        siteBox.appendChild(mk('Keep ' + (+slider.value) + '% for ' + host, () => {
          try { this.setSiteLevel(url, (+slider.value) / 100); window.showToast?.(host + ' keeps ' + (+slider.value) + '%'); }
          catch (err) { window.showToast?.(err.message, 'error'); }
          drawSite();
        }));
      }
    };
    // Opening the panel only shows the level; nothing is applied to any page
    // until the slider or mute actually moves (found 2026-09-29: opening it at
    // 100% injected the script into every tab and pinned all media volume).
    const set = (p, apply = true) => {
      p = Math.max(0, Math.min(500, Math.round(p)));
      slider.value = p; pctEl.textContent = p + '%';
      slider.setAttribute('aria-valuetext', p + '%');
      pctEl.style.color = p > 100 ? 'var(--warning, #e8b84a)' : 'var(--primary, #6366f1)';
      warn.hidden = !(p > 100);
      mute.innerHTML = VexIcons.svg(p === 0 ? 'mute' : 'volume', { size: 18 });
      if (p > 0) lastNonZero = p;
      if (apply) {
        this.apply(p / 100);
        // Said once the pages have answered: a cross-origin player reloads first.
        clearTimeout(this._statusTimer);
        const status = el.querySelector('.mastervol-status');
        if (!(p > 100)) { status.hidden = true; status.textContent = ''; }
        else this._statusTimer = setTimeout(() => this._refreshStatus(), 1500);
      }
    };
    slider.addEventListener('input', () => set(+slider.value));
    mute.addEventListener('click', () => set(+slider.value === 0 ? lastNonZero : 0));
    set(pct, false); // colourise the % label on open
    drawSite();
    slider.addEventListener('change', drawSite);
    // On the slider at once, so the arrow keys set the level when it was opened
    // with Ctrl+K: it was a long Tab away from wherever the focus had been.
    slider.focus({ preventScroll: true });
    if (pct > 100) this._refreshStatus();
    // A page can change what it plays (the next video, a protected one that
    // could not be boosted): the line follows it while the slider is open.
    this._statusPoll = VexJobs.every('Master volume status', 2500, () => { if (this._el && +slider.value > 100) this._refreshStatus(); }, { feature: 'master-volume' });

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
    clearTimeout(this._statusTimer);
    if (this._statusPoll) { this._statusPoll.stop(); this._statusPoll = null; }
    if (this._el) {
      this._el.remove(); this._el = null;
      // Back to what had the focus (the page, a button), unless it already went
      // somewhere else on its own.
      const back = this._prevFocus;
      this._prevFocus = null;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (back && back !== document.body && back.isConnected && lost && typeof back.focus === 'function') back.focus({ preventScroll: true });
    }
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
      .mastervol-status{margin-top:8px;padding:8px 10px;font-size:11px;line-height:1.45;border-radius:8px;
        color:var(--text,#e9e9ee);background:rgba(232,184,74,0.12);border:1px solid rgba(232,184,74,0.4);}
      .mastervol-status[hidden]{display:none;}
      .mastervol-warn{margin-top:8px;padding:8px 10px;font-size:11px;line-height:1.45;border-radius:8px;color:var(--text,#e9e9ee);background:rgba(232,184,74,0.12);border:1px solid rgba(232,184,74,0.4);}
      .mastervol-warn[hidden]{display:none;}
      .mastervol-site{margin-top:8px;display:flex;flex-direction:column;gap:6px;align-items:flex-start;}
      .mastervol-keepnote{font-size:11px;line-height:1.4;color:var(--text-muted,#9a9aa5);}
      .mastervol-keep{font:inherit;font-size:11.5px;padding:4px 10px;border-radius:7px;cursor:pointer;color:var(--text,#e9e9ee);background:transparent;border:1px solid var(--border,rgba(255,255,255,0.18));}
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.MasterVolume = MasterVolume;
// site-volume.js loads first (index.html); in a unit test on its own it is absent.
if (typeof window !== 'undefined' && typeof window.vexOnLateFrame === 'function') MasterVolume.init();
if (typeof module !== 'undefined' && module.exports) module.exports = { MasterVolume };
