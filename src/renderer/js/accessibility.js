// === Vex Accessibility & Reading pack ===
// All injected into the page (host → webview on dom-ready, like Boosts):
//  - dyslexia-friendly font  - color-blind simulation filter  - reading ruler
// Plus on-demand: Bionic reading, RSVP speed reader, Translate selection.

const AccessibilityPack = {
  KEY: 'vex.a11y',
  cfg: { font: 'off', cvd: 'off', ruler: false },

  init() {
    try { const c = JSON.parse(localStorage.getItem(this.KEY) || 'null'); if (c) this.cfg = { ...this.cfg, ...c }; } catch {}
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.cfg)); } catch {} this.reapplyAll(); },

  FONTS: {
    off: '',
    lexend: `@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;600&display=swap');*{font-family:'Lexend',sans-serif!important}`,
    atkinson: `@import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap');*{font-family:'Atkinson Hyperlegible',sans-serif!important}`,
    opendyslexic: `@import url('https://fonts.cdnfonts.com/css/opendyslexic');*{font-family:'OpenDyslexic',sans-serif!important}`,
  },
  // feColorMatrix daltonization matrices for color-vision simulation.
  CVD: {
    off: null,
    protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
    deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
    tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
    grayscale: '0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0',
  },

  applyTo(webview) {
    const fontCss = this.FONTS[this.cfg.font] || '';
    const matrix = this.CVD[this.cfg.cvd];
    const cvdSvg = matrix
      ? `var s=document.getElementById('vex-cvd-svg')||document.createElementNS('http://www.w3.org/2000/svg','svg');s.id='vex-cvd-svg';s.setAttribute('style','position:fixed;width:0;height:0');s.innerHTML='<filter id="vex-cvd"><feColorMatrix type="matrix" values="${matrix}"/></filter>';document.body&&document.body.appendChild(s);document.documentElement.style.filter='url(#vex-cvd)';`
      : `document.documentElement.style.filter='';var x=document.getElementById('vex-cvd-svg');x&&x.remove();`;
    const rulerJs = this.cfg.ruler
      ? `if(!window.__vexRuler){window.__vexRuler=1;var r=document.createElement('div');r.id='vex-ruler';r.style.cssText='position:fixed;left:0;right:0;height:38px;background:rgba(120,120,120,0.16);border-top:1px solid rgba(0,0,0,0.25);border-bottom:1px solid rgba(0,0,0,0.25);pointer-events:none;z-index:2147483600;transform:translateY(-50%);transition:top .03s linear';document.documentElement.appendChild(r);document.addEventListener('mousemove',function(e){r.style.top=e.clientY+'px'});}`
      : `var rr=document.getElementById('vex-ruler');rr&&rr.remove();window.__vexRuler=0;`;
    const js = `(function(){try{
      var id='vex-a11y-style';var el=document.getElementById(id);
      if(!el){el=document.createElement('style');el.id=id;document.documentElement.appendChild(el);}
      el.textContent=${JSON.stringify(fontCss)};
      ${cvdSvg}
      ${rulerJs}
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },

  reapplyAll() {
    if (typeof WebviewManager === 'undefined') return;
    WebviewManager.webviews.forEach((wv) => { try { this.applyTo(wv); } catch {} });
  },

  // --- Bionic reading: bold the leading ~42% of each word, current page ---
  bionic() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('Open a page first'); return; }
    const js = `(function(){try{
      if(document.documentElement.getAttribute('data-vex-bionic')){document.querySelectorAll('b.vexbi').forEach(function(b){var t=document.createTextNode(b.textContent);b.replaceWith(t)});document.documentElement.removeAttribute('data-vex-bionic');return 'off';}
      var root=document.querySelector('article,main,[role=main]')||document.body;
      var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){var p=n.parentNode;if(!p)return 2;var tag=p.nodeName;if(/SCRIPT|STYLE|CODE|PRE|TEXTAREA|NOSCRIPT/.test(tag))return 2;if(!n.nodeValue.trim())return 2;return 1;}});
      var nodes=[],x;while(x=walker.nextNode())nodes.push(x);
      nodes.slice(0,4000).forEach(function(n){
        var frag=document.createDocumentFragment();
        n.nodeValue.split(/(\\s+)/).forEach(function(w){
          if(!w.trim()){frag.appendChild(document.createTextNode(w));return;}
          var k=Math.max(1,Math.round(w.length*0.42));
          var b=document.createElement('b');b.className='vexbi';b.textContent=w.slice(0,k);
          frag.appendChild(b);frag.appendChild(document.createTextNode(w.slice(k)));
        });
        n.parentNode.replaceChild(frag,n);
      });
      document.documentElement.setAttribute('data-vex-bionic','1');return 'on';
    }catch(e){return 'err'}})();`;
    wv.executeJavaScript(js).then(r => window.showToast?.(r === 'on' ? '⚡ Bionic reading on' : r === 'off' ? 'Bionic off' : 'Bionic failed')).catch(() => {});
  },

  // --- RSVP speed reader: flash the article one word at a time ---
  async rsvp() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('Open a page first'); return; }
    let text = '';
    try { text = await wv.executeJavaScript(`(()=>{const el=document.querySelector('article,main,[role=main]')||document.body;return (el.innerText||'').replace(/\\s+/g,' ').trim().substring(0,40000);})()`); } catch {}
    const words = (text || '').split(/\s+/).filter(Boolean);
    if (words.length < 10) { window.showToast?.('Not enough text to speed-read'); return; }
    document.getElementById('vex-rsvp')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-rsvp';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px';
    m.innerHTML = `
      <div id="rsvp-word" style="font:600 56px 'Outfit',sans-serif;color:#fff;min-height:70px;letter-spacing:-0.01em"></div>
      <div style="display:flex;align-items:center;gap:14px;color:#bbb;font:14px 'Outfit',sans-serif">
        <button id="rsvp-play" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;font-family:inherit">⏸ Pause</button>
        <label>WPM <input id="rsvp-wpm" type="range" min="150" max="900" step="50" value="400" style="vertical-align:middle"></label>
        <span id="rsvp-wpmval">400</span>
        <span id="rsvp-prog"></span>
        <button id="rsvp-close" style="background:#333;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-family:inherit">✕</button>
      </div>`;
    document.body.appendChild(m);
    let i = 0, playing = true, wpm = 400, timer = null;
    const wordEl = m.querySelector('#rsvp-word'), prog = m.querySelector('#rsvp-prog');
    const tick = () => {
      if (!playing) return;
      if (i >= words.length) { playing = false; m.querySelector('#rsvp-play').textContent = '↺ Replay'; wordEl.textContent = '✓ Done'; return; }
      wordEl.textContent = words[i];
      prog.textContent = Math.round((i / words.length) * 100) + '%';
      i++;
      timer = setTimeout(tick, 60000 / wpm);
    };
    tick();
    m.querySelector('#rsvp-play').addEventListener('click', (e) => {
      if (i >= words.length) { i = 0; }
      playing = !playing; e.target.textContent = playing ? '⏸ Pause' : '▶ Play';
      if (playing) tick(); else clearTimeout(timer);
    });
    m.querySelector('#rsvp-wpm').addEventListener('input', (e) => { wpm = parseInt(e.target.value, 10); m.querySelector('#rsvp-wpmval').textContent = wpm; });
    const close = () => { playing = false; clearTimeout(timer); m.remove(); };
    m.querySelector('#rsvp-close').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
  },

  // --- Translate the current selection (or a word) → tooltip ---
  async translateSelection() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('Open a page first'); return; }
    let sel = '';
    try { sel = await wv.executeJavaScript('String(getSelection&&getSelection()||"").trim().substring(0,400)'); } catch {}
    if (!sel) { window.showToast?.('Select some text first'); return; }
    const tl = (typeof navigator !== 'undefined' && navigator.language || 'en').slice(0, 2);
    const out = await window.vex.translateText(sel, tl);
    if (!out) { window.showToast?.('Translation failed'); return; }
    window.showToast?.(sel.length > 40 ? out.slice(0, 120) : (sel + ' → ' + out));
  },

  renderPanel(container) {
    if (!container) return;
    const sel = (id, label, opts, cur) => `<div class="setting-row-label" style="margin-top:10px">${label}</div><select id="${id}">${opts.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:6px">Applied to every page you open.</p>
      ${sel('a11y-font', 'Reading font', [['off', 'Default'], ['lexend', 'Lexend'], ['atkinson', 'Atkinson Hyperlegible'], ['opendyslexic', 'OpenDyslexic']], this.cfg.font)}
      ${sel('a11y-cvd', 'Color-vision filter', [['off', 'Off'], ['protanopia', 'Protanopia (red-blind)'], ['deuteranopia', 'Deuteranopia (green-blind)'], ['tritanopia', 'Tritanopia (blue-blind)'], ['grayscale', 'Grayscale']], this.cfg.cvd)}
      <div class="setting-toggle-row" style="margin-top:10px"><span>Reading ruler (bar follows cursor)</span><label class="toggle"><input type="checkbox" id="a11y-ruler" ${this.cfg.ruler ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
      <p class="setting-info muted" style="margin-top:10px">On demand from the command bar: <strong>Bionic Reading</strong>, <strong>Speed Read</strong>, <strong>Translate Selection</strong>.</p>`;
    container.querySelector('#a11y-font').addEventListener('change', (e) => { this.cfg.font = e.target.value; this.save(); });
    container.querySelector('#a11y-cvd').addEventListener('change', (e) => { this.cfg.cvd = e.target.value; this.save(); });
    container.querySelector('#a11y-ruler').addEventListener('change', (e) => { this.cfg.ruler = e.target.checked; this.save(); });
  },
};

if (typeof window !== 'undefined') window.AccessibilityPack = AccessibilityPack;
if (typeof module !== 'undefined' && module.exports) module.exports = { AccessibilityPack };
