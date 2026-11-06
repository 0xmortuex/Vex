// === Bass, treble, mono and balance for one site ===================================
//
// Beside the volume slider (Master Volume, Ctrl+K "Master Volume" or the Quick Tools
// entry): two sliders for bass and treble, a left/right balance and a mono switch, kept
// for the site you are on. A film with muffled dialogue gets less bass; a music video with
// a hard left/right mix can be heard in one ear (mono); a sound that is louder in one
// earpiece is balanced.
//
// How: the page's own sound goes through the same Web Audio route the volume boost uses
// (window.__vexAudio: one source and one "out" gain per player, shared with Night mode),
// and after that gain the chain is
//
//     gain -> low shelf (150 Hz) -> high shelf (4 kHz) -> mono mix -> stereo balance -> speakers
//
// Nothing is changed for a player until a setting leaves its neutral position, and with all
// four at neutral the chain is bypassed (the gain connects straight to the speakers, as it
// did before the first touch).
//
// What it cannot do - and the slider says so, with the number of players it could not reach:
//   - sound from another site that does not allow it (a CDN without permission). Vex asks
//     for permission and reloads the player once, as the volume boost does (main/media-cors.js);
//     where the server still refuses, the player stays as it was;
//   - protected video (Netflix, Prime Video: DRM);
//   - players that were already routed through the page's own audio processing;
//   - sound a page makes with its own Web Audio graph rather than a media element.
//
// Remembered per site in this profile (vex.siteEq); a private tab applies it for the moment
// and keeps nothing.
const VexSiteEq = {
  KEY: 'vex.siteEq',                     // { [host]: { bass, treble, balance, mono } }
  FEATURE: 'site-eq',
  BASS_HZ: 150, TREBLE_HZ: 4000,
  RANGE_DB: 12,
  NEUTRAL: Object.freeze({ bass: 0, treble: 0, balance: 0, mono: false }),
  MAX_SITES: 300,

  // ---- pure --------------------------------------------------------------------------
  clean(cfg) {
    const o = cfg && typeof cfg === 'object' ? cfg : {};
    const num = (v, lo, hi, step) => { const n = Number(v); if (!Number.isFinite(n)) return 0; return Math.round(Math.max(lo, Math.min(hi, n)) / step) * step; };
    const r = this.RANGE_DB;
    const out = { bass: num(o.bass, -r, r, 1), treble: num(o.treble, -r, r, 1), balance: num(o.balance, -1, 1, 0.05), mono: o.mono === true };
    // Rounding to the step can leave -0.
    for (const k of ['bass', 'treble', 'balance']) if (out[k] === 0) out[k] = 0;
    out.balance = Math.round(out.balance * 100) / 100;
    return out;
  },
  isNeutral(cfg) { const c = this.clean(cfg); return c.bass === 0 && c.treble === 0 && c.balance === 0 && !c.mono; },
  hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  // A level kept for example.com covers its subdomains.
  match(all, host) { return Object.keys(all).find(h => host === h || host.endsWith('.' + h)); },
  // What could not be shaped, in plain words, from a page's report ({ players, shaped, why: { cors, drm, routed, tapfail } }).
  limits(report) {
    const total = { players: 0, shaped: 0, why: {} };
    for (const r of report || []) {
      if (!r) continue;
      total.players += r.players || 0; total.shaped += r.shaped || 0;
      for (const k of Object.keys(r.why || {})) total.why[k] = (total.why[k] || 0) + r.why[k];
    }
    const one = (n, singular, plural) => (n === 1 ? singular : plural.replace('{1}', n));
    const parts = [];
    const w = total.why;
    if (total.shaped) parts.push(one(total.shaped, 'Shaping 1 player on this page.', 'Shaping {1} players on this page.'));
    if (w.cors) parts.push(one(w.cors, '1 player plays from another site that does not allow its sound to be processed, and stays as it was.', '{1} players play from another site that does not allow their sound to be processed, and stay as they were.'));
    if (w.drm) parts.push('Protected video (DRM) cannot be shaped; use the video\'s own volume.');
    if (w.routed) parts.push(one(w.routed, '1 player already uses the page\'s own audio processing and stays as it was.', '{1} players already use the page\'s own audio processing and stay as they were.'));
    if (w.tapfail) parts.push(one(w.tapfail, '1 player could not be reached.', '{1} players could not be reached.'));
    if (!parts.length) parts.push(total.players ? 'Waiting for the sound to start.' : 'Nothing is playing on this page yet; it is shaped when something does.');
    return parts.join(' ');
  },

  // ---- storage -----------------------------------------------------------------------
  all() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The sound settings kept for sites could not be read', { cause: err }); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const [h, c] of Object.entries(o)) if (typeof h === 'string' && h && !this.isNeutral(c)) out[h] = this.clean(c);
    return out;
  },
  for(url) {
    const host = this.hostOf(url);
    if (!host) return { ...this.NEUTRAL };
    const all = this.all();
    const key = this.match(all, host);
    return key === undefined ? { ...this.NEUTRAL } : { ...all[key] };
  },
  has(url) { const host = this.hostOf(url); return !!host && this.match(this.all(), host) !== undefined; },
  // Keep (or, when neutral, forget) the setting for the site of `url`. -> the host.
  save(url, cfg) {
    const host = this.hostOf(url);
    if (!host || !/^https?:/i.test(String(url))) throw new Error('That is not a web page');
    const all = this.all();
    const key = this.match(all, host) || host;
    if (this.isNeutral(cfg)) delete all[key];
    else all[key] = this.clean(cfg);
    const keys = Object.keys(all);
    if (keys.length > this.MAX_SITES) throw new Error('Sound settings are kept for at most ' + this.MAX_SITES + ' sites');
    try { localStorage.setItem(this.KEY, JSON.stringify(all)); }
    catch (err) { throw new Error('Could not keep the sound settings: ' + err.message, { cause: err }); }
    return key;
  },
  forget(host) { const all = this.all(); if (!(host in all)) return false; delete all[host]; localStorage.setItem(this.KEY, JSON.stringify(all)); return true; },

  // ---- the page script ----------------------------------------------------------------
  // Idempotent. `cfg` is set again on every call. window.__vexEq.makeTail(ctx, destination) builds the chain on any
  // audio context (the proof in the tests and the probe use that same code on an offline one).
  script(cfg) {
    const c = this.clean(cfg);
    return `(function(cfg){try{
      var DB_BASS=${this.BASS_HZ}, DB_TREBLE=${this.TREBLE_HZ};
      function makeTail(c,dest){
        var low=c.createBiquadFilter(); low.type='lowshelf'; low.frequency.value=DB_BASS;
        var high=c.createBiquadFilter(); high.type='highshelf'; high.frequency.value=DB_TREBLE;
        var mono=c.createGain();
        var pan=c.createStereoPanner();
        low.connect(high); high.connect(mono); mono.connect(pan); pan.connect(dest);
        var t={input:low,output:pan,low:low,high:high,mono:mono,pan:pan,
          set:function(k){
            low.gain.value=k.bass; high.gain.value=k.treble; pan.pan.value=k.balance;
            // Mono: the two sides are mixed to one (half of each), then put back in both ears. The balance stage spreads one
            // channel with an equal-power law, which is 3 dB lower, so the mix is raised by the same 3 dB to leave a
            // centred sound at the level it had.
            if(k.mono){ mono.channelCountMode='explicit'; mono.channelCount=1; mono.channelInterpretation='speakers'; mono.gain.value=Math.SQRT2; }
            else { mono.channelCountMode='max'; mono.channelCount=2; mono.gain.value=1; }
          }};
        t.set(cfg);
        return t;
      }
      function neutral(k){ return !k.bass && !k.treble && !k.balance && !k.mono; }
      if(window.__vexEq){ window.__vexEq.set(cfg); return; }
      var A=window.__vexAudio||(window.__vexAudio={ctx:null,nodes:new WeakMap()});
      var st={cfg:cfg,makeTail:makeTail,recs:new WeakMap(),players:0};
      function getCtx(){ if(!A.ctx){ try{ A.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; } } return A.ctx; }
      function resume(){ try{ var c=getCtx(); if(c&&c.state==='suspended'){ c.resume().then(applyAll).catch(function(){}); } }catch(e){} }
      // The same shared route as the volume boost and Night mode: one source and one out gain per player.
      function shared(m){
        var n=A.nodes.get(m); if(n) return n;
        var source=A.ctx.createMediaElementSource(m); var out=A.ctx.createGain();
        source.connect(out); out.connect(A.ctx.destination);
        n={source:source,out:out}; A.nodes.set(m,n); return n;
      }
      function sameOrigin(m){ try{ var s=m.currentSrc||m.src||''; if(!s) return true; if(s.lastIndexOf('blob:',0)===0||s.lastIndexOf('data:',0)===0||s.lastIndexOf('mediastream:',0)===0) return true; var u=new URL(s,location.href); if(u.origin===location.origin) return true; return m.crossOrigin==='anonymous'||m.crossOrigin==='use-credentials'; }catch(e){ return false; } }
      function isDrm(m){ try{ return !!m.mediaKeys; }catch(e){ return false; } }
      // Another site's sound plays as silence through Web Audio unless the server allows it. Vex adds the permission to
      // media responses (main/media-cors.js), so the player is asked again with crossOrigin set, at the same place; a server
      // that still refuses is put back as it was.
      function makeCors(m,rec){
        try{
          var src=m.currentSrc||m.src||'';
          if(!src||src.lastIndexOf('blob:',0)===0||src.lastIndexOf('data:',0)===0) return false;
          var t=0; try{ t=m.currentTime; }catch(e){}
          var was=!m.paused;
          rec.corsTried=true; rec.corsPending=true;
          m.crossOrigin='anonymous';
          var onErr=function(){ try{ m.removeEventListener('error',onErr); m.removeEventListener('canplay',onReady); m.crossOrigin=null; m.load(); try{ m.currentTime=t; }catch(e){} if(was) m.play().catch(function(){}); }catch(e){} rec.corsPending=false; rec.why='cors'; };
          var onReady=function(){ try{ m.removeEventListener('canplay',onReady); m.removeEventListener('error',onErr); m.currentTime=t; }catch(e){} rec.corsPending=false; if(was) m.play().catch(function(){}); hook(m); };
          m.addEventListener('error',onErr,{once:true}); m.addEventListener('canplay',onReady,{once:true});
          m.load(); if(was) m.play().catch(function(){});
          return true;
        }catch(e){ return false; }
      }
      // Send the player's gain through the chain, or straight to the speakers when everything is neutral.
      function route(n,through){
        var d=A.ctx.destination;
        if(n.eqThrough===through) return;
        n.eqThrough=through;
        if(through){ try{ n.out.disconnect(d); }catch(e){} try{ n.out.connect(n.eq.input); }catch(e){} }
        else { try{ n.out.disconnect(n.eq.input); }catch(e){} try{ n.out.connect(d); }catch(e){} }
      }
      function hook(m){
        try{
          var rec=st.recs.get(m);
          if(!rec){ rec={why:null,corsTried:false,corsPending:false}; st.recs.set(m,rec); }
          var n=A.nodes.get(m);
          if(!n || !n.eq){
            if(neutral(st.cfg)) return;               // never touched while everything is flat
            if(rec.corsPending||rec.why) return;
            if(isDrm(m)){ rec.why='drm'; return; }
            var c=getCtx(); if(!c) { rec.why='tapfail'; return; }
            if(c.state!=='running'){ resume(); return; }
            if(!n){
              if(!sameOrigin(m)){ if(!rec.corsTried){ if(makeCors(m,rec)) return; } rec.why='cors'; return; }
              try{ n=shared(m); }catch(e){ rec.why=(e&&e.name==='InvalidStateError')?'routed':'tapfail'; return; }
            }
            if(!n.eq) n.eq=makeTail(A.ctx,A.ctx.destination);
          }
          n.eq.set(st.cfg);
          route(n,!neutral(st.cfg));
          rec.shaped=true;
        }catch(e){}
      }
      function applyAll(){ try{ document.querySelectorAll('video,audio').forEach(hook); }catch(e){} }
      st.set=function(k){ st.cfg=k; resume(); applyAll(); };
      st.report=function(){
        var players=0, shaped=0, why={};
        try{ document.querySelectorAll('video,audio').forEach(function(m){
          players++; if(!neutral(st.cfg)) hook(m);
          var r=st.recs.get(m); if(!r) return;
          if(r.shaped && !neutral(st.cfg)) shaped++; else if(r.why && !neutral(st.cfg)) why[r.why]=(why[r.why]||0)+1;
        }); }catch(e){}
        return {players:players,shaped:shaped,why:why,neutral:neutral(st.cfg)};
      };
      window.__vexEq=st;
      resume(); applyAll();
      try{ new MutationObserver(applyAll).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
      document.addEventListener('play',function(e){ resume(); var t=e.target; if(t&&(t.tagName==='VIDEO'||t.tagName==='AUDIO')) hook(t); },true);
      ['pointerdown','keydown','click'].forEach(function(ev){ document.addEventListener(ev,resume,true); });
    }catch(e){}})(${JSON.stringify(c)});`;
  },

  // ---- applying -------------------------------------------------------------------------
  async applyToWebview(wv, cfg) {
    if (!wv) return;
    const url = this._urlOf(wv);
    const c = cfg === undefined ? this.for(url) : cfg;
    if (cfg === undefined && this.isNeutral(c) && !(await this._hasScript(wv))) return;
    try { await window.vexGuestEvalFrames(wv, this.script(c)); }
    catch (err) { window.VexProblems?.note('Sound shaping', 'Could not apply the sound settings to a page', err); }
  },
  async _hasScript(wv) {
    try { const r = await window.vexGuestEvalFrames(wv, '!!window.__vexEq'); return r.results.some(f => f && f.ok && f.value); }
    catch (err) { window.VexProblems?.note('Sound shaping', 'Could not ask a page about its sound settings', err); return false; }
  },
  _urlOf(wv) { try { return typeof window.vexGuestUrl === 'function' ? window.vexGuestUrl(wv) : wv.getURL(); } catch { return ''; } },
  // Every tab and panel on a site gets the change.
  _webviewsOf(host) {
    const mv = window.MasterVolume;
    const all = mv && typeof mv._allWebviews === 'function' ? mv._allWebviews() : [];
    return all.filter(wv => { const h = this.hostOf(this._urlOf(wv)); return h && (h === host || h.endsWith('.' + host)); });
  },
  async report(wv) {
    const r = await window.vexGuestEvalFrames(wv, 'window.__vexEq && window.__vexEq.report ? window.__vexEq.report() : null');
    return r.results.filter(f => f && f.ok && f.value).map(f => f.value);
  },

  // ---- the controls inside the Master Volume box -------------------------------------------
  draw(box, { url, wv, persist }) {
    box.textContent = '';
    const host = this.hostOf(url);
    if (!host || !/^https?:/i.test(String(url))) return;
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    let cfg = this.for(url);
    const head = document.createElement('div');
    head.className = 'mastervol-eqhead';
    head.textContent = `Bass, treble and balance for ${host}`;
    box.appendChild(head);
    const status = document.createElement('div');
    status.className = 'mastervol-eqstatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const rows = {};
    const row = (name, label, min, max, step, fmt) => {
      const line = document.createElement('label');
      line.className = 'mastervol-eqrow';
      const t = document.createElement('span'); t.textContent = label;
      const input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = cfg[name];
      input.setAttribute('aria-label', label);
      const val = document.createElement('span'); val.className = 'mastervol-eqval';
      const show = () => { val.textContent = fmt(+input.value); input.setAttribute('aria-valuetext', val.textContent); };
      show();
      input.addEventListener('input', () => { show(); cfg = { ...cfg, [name]: +input.value }; apply(false); });
      input.addEventListener('change', () => apply(true));
      line.append(t, input, val);
      box.appendChild(line);
      rows[name] = { input, show };
    };
    const db = (n) => (n > 0 ? '+' : '') + n + ' dB';
    row('bass', 'Bass', -this.RANGE_DB, this.RANGE_DB, 1, db);
    row('treble', 'Treble', -this.RANGE_DB, this.RANGE_DB, 1, db);
    row('balance', 'Left / right', -1, 1, 0.05, (n) => n === 0 ? 'centre' : (n < 0 ? 'left ' : 'right ') + Math.round(Math.abs(n) * 100) + '%');
    const monoLine = document.createElement('label');
    monoLine.className = 'mastervol-eqrow';
    const mono = document.createElement('input'); mono.type = 'checkbox'; mono.checked = cfg.mono;
    mono.addEventListener('change', () => { cfg = { ...cfg, mono: mono.checked }; apply(true); });
    monoLine.append(mono, document.createTextNode(' Mono (the same sound in both ears)'));
    box.appendChild(monoLine);
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'mastervol-keep'; reset.textContent = 'Back to flat';
    reset.addEventListener('click', () => {
      cfg = { ...this.NEUTRAL };
      for (const [k, r] of Object.entries(rows)) { r.input.value = cfg[k]; r.show(); }
      mono.checked = false;
      apply(true);
    });
    box.appendChild(reset);
    const limits = document.createElement('div');
    limits.className = 'mastervol-eqnote';
    limits.textContent = 'Works on players that play from this site, or from a site that allows it (Vex asks and reloads the player once). Protected video (DRM), a player the page already processes itself, and another site that refuses cannot be shaped.';
    box.append(status, limits);
    const note = document.createElement('div');
    note.className = 'mastervol-eqnote';
    box.appendChild(note);
    let timer = null;
    const apply = (keep) => {
      const c = this.clean(cfg);
      for (const w of this._webviewsOf(host).concat(wv && !this._webviewsOf(host).includes(wv) ? [wv] : [])) this.applyToWebview(w, c);
      if (keep) {
        if (persist) {
          try { this.save(url, c); note.textContent = this.isNeutral(c) ? `${host} is flat again.` : `Kept for ${host}.`; }
          catch (err) { window.showToast?.(err.message, 'error'); }
        } else note.textContent = 'This tab is private, so this is not kept.';
      }
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!box.isConnected || !wv) return;
        try { status.textContent = this.isNeutral(c) ? '' : this.limits(await this.report(wv)); }
        catch (err) { status.textContent = `Could not check the page: ${(err && err.message) || 'unknown'}`; }
      }, 1500);
    };
    if (!this.isNeutral(cfg)) note.textContent = `Kept for ${host}.`;
  },
};

if (typeof window !== 'undefined') window.VexSiteEq = VexSiteEq;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSiteEq };
