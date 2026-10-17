// === Middle-click autoscroll (T3-042) ===========================================
// vex-layer-exempt: drawn inside the guest page (injected script), pointer-events:none
//
// Windows browsers scroll a page by itself when you press the wheel: a small
// mark appears where you pressed, and the page moves toward wherever you take the
// pointer, faster the further you go. Electron ships none of it. This adds it.
//
//   * press the middle button on empty page: the mark appears and the page
//     follows the pointer (click it again, or press any key, or use the wheel,
//     to stop); hold the button and drag, and letting go stops it;
//   * NOT on a link (middle-click there opens the link in a new tab, as before),
//     a text box, a video, an embedded frame or a button;
//   * the scrolled thing is the nearest scrollable box under the pointer, else
//     the page itself; across and down.
//
// The page-side script is a function stringified into the tab (like
// js/pip-manager.js does), run once per loaded page. It listens only for the
// middle button, reads nothing from the page and sends nothing anywhere.
// On: the switch below; off by default for a profile that already existed.

// Runs INSIDE the page (stringified). → 'installed' | 'already'
function vexAutoscrollInstall() {
  if (window.__vexAutoscroll) return 'already';
  const DEAD = 14;           // px around the mark where nothing moves
  const FASTEST = 48;        // px per frame
  const SKIP = 'a[href],input,textarea,select,button,video,audio,iframe,embed,object,[contenteditable=""],[contenteditable="true"],[role="textbox"]';
  let run = null;

  const scrollerFor = (el) => {
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const y = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
      const x = /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
      if (y || x) return el;
    }
    const se = document.scrollingElement || document.documentElement;
    return (se.scrollHeight > se.clientHeight + 1 || se.scrollWidth > se.clientWidth + 1) ? se : null;
  };

  const mark = (x, y) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '30'); svg.setAttribute('height', '30'); svg.setAttribute('viewBox', '0 0 30 30');
    svg.id = 'vex-autoscroll-mark';
    svg.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:' + (x - 15) + 'px;top:' + (y - 15) + 'px;';
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '15'); c.setAttribute('cy', '15'); c.setAttribute('r', '13');
    c.setAttribute('fill', 'rgba(20,20,20,0.7)'); c.setAttribute('stroke', 'rgba(255,255,255,0.9)'); c.setAttribute('stroke-width', '1.5');
    svg.appendChild(c);
    for (const d of ['M15 6l3.5 4.5h-7z', 'M15 24l3.5-4.5h-7z', 'M6 15l4.5-3.5v7z', 'M24 15l-4.5-3.5v7z']) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d); p.setAttribute('fill', 'rgba(255,255,255,0.95)');
      svg.appendChild(p);
    }
    (document.body || document.documentElement).appendChild(svg);
    return svg;
  };

  const speed = (d) => {
    const a = Math.abs(d);
    return a < DEAD ? 0 : Math.sign(d) * Math.min(FASTEST, (a - DEAD) * 0.18);
  };

  function stop() {
    if (!run) return;
    const r = run; run = null;
    cancelAnimationFrame(r.raf);
    r.mark.remove();
    document.documentElement.style.cursor = r.cursor;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('mousedown', onAnyDown, true);
    window.removeEventListener('keydown', stop, true);
    window.removeEventListener('wheel', stop, true);
    window.removeEventListener('blur', stop, true);
  }
  function onMove(e) { if (run) { run.x = e.clientX; run.y = e.clientY; if (Math.hypot(run.x - run.sx, run.y - run.sy) > 12) run.dragged = true; } }
  function onUp(e) { if (run && e.button === 1 && run.dragged) stop(); }
  function onAnyDown(e) { if (!run) return; e.preventDefault(); e.stopPropagation(); stop(); }

  function frame() {
    if (!run) return;
    const vx = speed(run.x - run.sx), vy = speed(run.y - run.sy);
    if (vx || vy) {
      const s = run.scroller;
      if (s === document.scrollingElement || s === document.documentElement) window.scrollBy(vx, vy);
      else s.scrollBy(vx, vy);
    }
    run.raf = requestAnimationFrame(frame);
  }

  function onDown(e) {
    if (e.button !== 1 || !e.isTrusted || e.defaultPrevented || run) return;
    const target = e.target && e.target.nodeType === 1 ? e.target : null;
    if (!target || target.closest(SKIP)) return;
    const scroller = scrollerFor(target);
    if (!scroller) return;
    e.preventDefault();
    run = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, scroller, dragged: false, mark: mark(e.clientX, e.clientY), cursor: document.documentElement.style.cursor, raf: 0 };
    document.documentElement.style.cursor = 'all-scroll';
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('mousedown', onAnyDown, true);
    window.addEventListener('keydown', stop, true);
    window.addEventListener('wheel', stop, true);
    window.addEventListener('blur', stop, true);
    run.raf = requestAnimationFrame(frame);
  }

  window.addEventListener('mousedown', onDown, true);
  window.__vexAutoscroll = { stop, off() { stop(); window.removeEventListener('mousedown', onDown, true); delete window.__vexAutoscroll; } };
  return 'installed';
}

const VexAutoscroll = {
  KEY: 'vex.autoscroll',            // '0' = off

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    if (!on) this._everyPage('(function(){ if (window.__vexAutoscroll) window.__vexAutoscroll.off(); return true; })()');
    else this._everyPage('(' + vexAutoscrollInstall.toString() + ')()');
  },

  _everyPage(code) {
    if (typeof WebviewManager === 'undefined') return;
    for (const [tabId, wv] of WebviewManager.webviews) {
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
      if (!tab || !/^https?:/i.test(tab.url || '') || wv.isConnected === false) continue;
      window.vexGuestEval(wv, code, false, 3000).catch(err => {
        if (typeof VexProblems !== 'undefined') VexProblems.note('Autoscroll', 'Could not reach a page to switch autoscroll', err);
      });
    }
  },

  // Put it into one tab's page (a page that has just settled).
  async install(tabId) {
    if (!this.enabled()) return null;
    const tab = TabManager.tabs.find(t => t.id === tabId);
    const wv = WebviewManager.webviews.get(tabId);
    if (!tab || !wv || !/^https?:/i.test(tab.url || '') || wv.isConnected === false) return null;
    try { return await window.vexGuestEval(wv, '(' + vexAutoscrollInstall.toString() + ')()', false, 3000); }
    catch (err) {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Autoscroll', 'Could not add autoscroll to a page', err);
      return null;
    }
  },

  init() {
    if (this._inited) return false;
    this._inited = true;
    document.addEventListener('vex:tab-settled', (e) => { const id = e.detail && e.detail.tabId; if (id) this.install(id); });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexAutoscroll = VexAutoscroll;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAutoscroll, vexAutoscrollInstall };
