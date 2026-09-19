// === Why is this page slow? =================================================
//
// Chromium measures everything about how a page loaded and keeps it in the
// page (the Performance API): when the first byte came, when something was
// first painted, when the biggest thing appeared, how much the layout jumped,
// every file fetched and its size. It is all there and nobody sees it without
// opening DevTools and knowing which tab to look in.
//
// This reads it and says it in words, graded against Google's published Core
// Web Vitals thresholds, with the concrete culprits: the heaviest files, the
// pictures sent at four times the size they are shown, the scripts that stop
// the page drawing, the share that comes from other companies' servers.
//
// Like the accessibility check, the audit is a plain function — tested here,
// serialized into the page to run where the numbers live.

// Runs IN THE PAGE. Self-contained.
async function auditPerformance(doc, win, opts) {
  const perf = (opts && opts.performance) || win.performance;
  const settle = (opts && opts.settleMs != null) ? opts.settleMs : 400;
  const out = { url: String(win.location && win.location.href || ''), metrics: {}, weight: {}, findings: [] };

  // --- timings -------------------------------------------------------------------
  const nav = (perf.getEntriesByType && perf.getEntriesByType('navigation')[0]) || null;
  if (nav) {
    out.metrics.ttfb = Math.round(nav.responseStart - (nav.startTime || 0));
    out.metrics.domReady = Math.round(nav.domContentLoadedEventEnd);
    out.metrics.load = nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null;
  }
  const fcp = (perf.getEntriesByName && perf.getEntriesByName('first-contentful-paint')[0]) || null;
  if (fcp) out.metrics.fcp = Math.round(fcp.startTime);

  // LCP and layout shifts are only readable through an observer; "buffered"
  // hands back what already happened.
  const observe = (type) => new Promise((resolve) => {
    const seen = [];
    let po;
    try {
      po = new win.PerformanceObserver((list) => { for (const e of list.getEntries()) seen.push(e); });
      po.observe({ type, buffered: true });
    } catch (e) { resolve(seen); return; }
    setTimeout(() => { try { po.disconnect(); } catch (e) {} resolve(seen); }, settle);
  });
  const [lcps, shifts] = await Promise.all([observe('largest-contentful-paint'), observe('layout-shift')]);
  if (lcps.length) {
    const last = lcps[lcps.length - 1];
    out.metrics.lcp = Math.round(last.renderTime || last.loadTime || last.startTime);
    const el = last.element;
    out.metrics.lcpElement = el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.currentSrc || el.src ? ' ' + String(el.currentSrc || el.src).split('/').pop().slice(0, 60) : '')) : '';
  }
  // CLS: the worst "session window" of shifts not caused by user input
  // (gaps under 1 s, windows at most 5 s) — the definition Chrome reports.
  let cls = 0, win5 = 0, first = 0, lastT = 0;
  for (const s of shifts) {
    if (s.hadRecentInput) continue;
    if (win5 && (s.startTime - lastT > 1000 || s.startTime - first > 5000)) { cls = Math.max(cls, win5); win5 = 0; }
    if (!win5) first = s.startTime;
    win5 += s.value; lastT = s.startTime;
  }
  out.metrics.cls = Math.round(Math.max(cls, win5) * 1000) / 1000;

  // --- weight ----------------------------------------------------------------------
  const here = (() => { try { return new URL(out.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();
  const site = (h) => h.split('.').slice(-2).join('.');
  const resources = (perf.getEntriesByType && perf.getEntriesByType('resource')) || [];
  const kinds = {};
  let total = 0, thirdParty = 0, thirdRequests = 0, hidden = 0;
  const thirdHosts = new Set();
  const items = [];
  for (const r of resources) {
    const bytes = r.transferSize || r.encodedBodySize || 0;
    // A server on another site hides its sizes unless it opts in
    // (Timing-Allow-Origin): the file WAS downloaded, its size reads as 0.
    // Measured: every ad and tracker on a big news site came back 0 bytes.
    if (!bytes && !r.decodedBodySize) hidden++;
    let host = '';
    try { host = new URL(r.name).hostname.replace(/^www\./, ''); } catch (e) {}
    const kind = r.initiatorType === 'img' || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(r.name) ? 'images'
      : r.initiatorType === 'script' || /\.m?js(\?|$)/i.test(r.name) ? 'scripts'
        : r.initiatorType === 'css' || r.initiatorType === 'link' && /\.css(\?|$)/i.test(r.name) ? 'styles'
          : /\.(woff2?|ttf|otf)(\?|$)/i.test(r.name) ? 'fonts'
            : (r.initiatorType === 'video' || r.initiatorType === 'audio') ? 'media' : 'other';
    kinds[kind] = (kinds[kind] || 0) + bytes;
    total += bytes;
    if (host && here && site(host) !== site(here)) { thirdParty += bytes; thirdRequests++; thirdHosts.add(site(host)); }
    items.push({ name: r.name, kind, bytes, ms: Math.round(r.duration || 0) });
  }
  out.weight = { requests: resources.length + (nav ? 1 : 0), bytes: total + (nav ? (nav.transferSize || 0) : 0), kinds, thirdPartyBytes: thirdParty, thirdPartyRequests: thirdRequests, thirdPartyHosts: [...thirdHosts].slice(0, 20), hiddenSizes: hidden };
  out.heaviest = items.sort((a, b) => b.bytes - a.bytes).slice(0, 6).filter(i => i.bytes > 0);

  // --- pictures sent far bigger than shown ------------------------------------------
  const dpr = win.devicePixelRatio || 1;
  let oversized = 0;
  const bigImgs = [];
  for (const img of doc.images) {
    const shownW = (opts && opts.shownWidth) ? opts.shownWidth(img) : img.getBoundingClientRect().width;
    if (!img.naturalWidth || !shownW) continue;
    const factor = img.naturalWidth / (shownW * dpr);
    if (factor >= 2 && img.naturalWidth >= 600) { oversized++; if (bigImgs.length < 5) bigImgs.push({ src: String(img.currentSrc || img.src).split('/').pop().slice(0, 60), natural: img.naturalWidth, shown: Math.round(shownW), factor: Math.round(factor * 10) / 10 }); }
  }
  out.oversizedImages = { count: oversized, examples: bigImgs };

  // --- scripts that stop the page drawing --------------------------------------------
  const blocking = [...doc.querySelectorAll('head script[src]:not([async]):not([defer]):not([type="module"])')].map(s => String(s.src).split('/').pop().slice(0, 60));
  out.blockingScripts = blocking;
  out.domSize = doc.getElementsByTagName('*').length;
  if (perf.memory && perf.memory.usedJSHeapSize) out.jsHeapMB = Math.round(perf.memory.usedJSHeapSize / 1048576);
  return out;
}

const PerfCheck = {
  // Google's Core Web Vitals / Lighthouse thresholds: [good up to, poor from].
  THRESHOLDS: {
    ttfb: [800, 1800, 'ms', 'Server answered'],
    fcp: [1800, 3000, 'ms', 'First thing drawn'],
    lcp: [2500, 4000, 'ms', 'Main content drawn'],
    cls: [0.1, 0.25, '', 'Layout jumping'],
  },

  grade(metric, value) {
    const t = this.THRESHOLDS[metric];
    if (!t || value == null) return null;
    return value <= t[0] ? 'good' : value < t[1] ? 'needs work' : 'poor';
  },

  fmt(metric, v) {
    if (v == null) return 'not measured';
    if (metric === 'cls') return v.toFixed(3);
    return v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v + ' ms';
  },
  size(bytes) {
    if (!bytes) return '0 KB';
    const mb = bytes / 1048576;
    return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  },

  // The plain-words findings, worst first.
  findings(r) {
    const f = [];
    const g = (m) => this.grade(m, r.metrics[m]);
    if (g('lcp') === 'poor' || g('lcp') === 'needs work') f.push({ sev: g('lcp') === 'poor' ? 2 : 1, text: 'The main content took ' + this.fmt('lcp', r.metrics.lcp) + ' to appear' + (r.metrics.lcpElement ? ' (' + r.metrics.lcpElement + ')' : '') + '. Under 2.5 s is good.' });
    if (g('ttfb') === 'poor' || g('ttfb') === 'needs work') f.push({ sev: g('ttfb') === 'poor' ? 2 : 1, text: 'The server took ' + this.fmt('ttfb', r.metrics.ttfb) + ' just to start answering — before the page could do anything. Under 0.8 s is good.' });
    if (g('cls') === 'poor' || g('cls') === 'needs work') f.push({ sev: g('cls') === 'poor' ? 2 : 1, text: 'The layout jumped around while loading (shift score ' + this.fmt('cls', r.metrics.cls) + '). That is the page moving under your finger. Under 0.1 is good.' });
    if (r.blockingScripts && r.blockingScripts.length) f.push({ sev: 1, text: r.blockingScripts.length + ' script' + (r.blockingScripts.length === 1 ? '' : 's') + ' in the page head stop it drawing until they have downloaded and run: ' + r.blockingScripts.slice(0, 4).join(', ') + '.' });
    if (r.oversizedImages && r.oversizedImages.count) {
      const e = r.oversizedImages.examples[0];
      f.push({ sev: 1, text: r.oversizedImages.count + ' picture' + (r.oversizedImages.count === 1 ? ' is' : 's are') + ' sent far bigger than shown' + (e ? ' — e.g. ' + e.src + ' is ' + e.natural + ' px wide, shown at ' + e.shown + ' px' : '') + '.' });
    }
    const w = r.weight || {};
    if (w.bytes > 5 * 1048576) f.push({ sev: w.bytes > 10 * 1048576 ? 2 : 1, text: 'The page downloaded ' + (w.hiddenSizes ? 'at least ' : '') + this.size(w.bytes) + ' in ' + w.requests + ' requests.' });
    // By request count, not bytes: other sites usually hide their sizes, so a
    // byte share would understate them badly (measured on a news site).
    if (w.requests && (w.thirdPartyRequests || 0) / w.requests > 0.3) f.push({ sev: 1, text: w.thirdPartyRequests + ' of its ' + w.requests + " requests went to other companies' servers (" + (w.thirdPartyHosts || []).slice(0, 5).join(', ') + ((w.thirdPartyHosts || []).length > 5 ? ', …' : '') + ').' });
    if (r.domSize > 3000) f.push({ sev: r.domSize > 6000 ? 2 : 1, text: 'The page is built from ' + r.domSize.toLocaleString() + ' elements; past about 1,500 every change to it gets slower.' });
    return f.sort((a, b) => b.sev - a.sev);
  },

  summary(r) {
    const worst = ['lcp', 'fcp', 'ttfb', 'cls'].map(m => this.grade(m, r.metrics[m])).filter(Boolean);
    if (worst.includes('poor')) return 'Slow';
    if (worst.includes('needs work')) return 'Could be faster';
    return worst.length ? 'Fast' : 'Not enough measured';
  },

  script() { return '(' + auditPerformance.toString() + ')(document, window, {})'; },

  async run() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('No page is open');
    const r = await window.vexGuestEval(wv, this.script());
    if (!r || !r.metrics) throw new Error('The page did not report its timings');
    const sheet = this._render(r);
    // What changed since the last check of this page, and Run again (which
    // reloads first: these timings describe a load).
    if (window.CheckHistory) {
      const entries = Object.entries(this.THRESHOLDS).filter(([m]) => r.metrics[m] != null)
        .map(([m, t]) => ({ key: m, label: t[3], value: r.metrics[m], text: this.fmt(m, r.metrics[m]) }));
      const n = this.findings(r).length;
      entries.push({ key: 'problems', label: 'Things slowing it down', value: n, text: String(n) });
      const prev = window.CheckHistory.track('speed', wv, entries, this.summary(r));
      window.CheckHistory.decorate(sheet, 'speed', prev, entries, () => window.CheckHistory.runOn('speed', null));
    }
    return r;
  },

  report(r) {
    const lines = ['Performance of ' + r.url, 'Verdict: ' + this.summary(r), ''];
    for (const [m, t] of Object.entries(this.THRESHOLDS)) lines.push(t[3] + ': ' + this.fmt(m, r.metrics[m]) + (this.grade(m, r.metrics[m]) ? ' (' + this.grade(m, r.metrics[m]) + ')' : ''));
    lines.push('Downloaded: ' + (r.weight.hiddenSizes ? 'at least ' : '') + this.size(r.weight.bytes) + ' in ' + r.weight.requests + ' requests' + (r.weight.hiddenSizes ? ' (' + r.weight.hiddenSizes + ' files hid their size)' : ''), '');
    const f = this.findings(r);
    if (f.length) { lines.push('What slows it down:'); for (const x of f) lines.push('  - ' + x.text); lines.push(''); }
    if (r.heaviest && r.heaviest.length) { lines.push('Heaviest files:'); for (const h of r.heaviest) lines.push('  ' + this.size(h.bytes).padStart(8) + '  ' + h.name); }
    return lines.join('\n').trim() + '\n';
  },

  _render(r) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const sheet = window.PageExport._sheet('How fast is this page?', 'vex-perf-overlay');
    const { head, body } = sheet;
    head.insertAdjacentHTML('beforeend', `<button data-copy type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Copy report</button>`);
    head.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.report(r)); window.showToast?.('Performance report copied'); }
      catch { window.showToast?.('Could not copy that', 'error'); }
    });
    const colour = { good: 'var(--success,#2da44e)', 'needs work': 'var(--warning,#d4a72c)', poor: 'var(--danger,#e5534b)' };
    const tiles = Object.entries(this.THRESHOLDS).map(([m, t]) => {
      const gr = this.grade(m, r.metrics[m]);
      return `<div style="flex:1 1 130px;border:1px solid var(--border);border-radius:9px;padding:9px 11px">
        <div style="font-size:11px;color:var(--text-muted)">${esc(t[3])}</div>
        <div style="font-size:18px;font-weight:650;color:${gr ? colour[gr] : 'var(--text)'};font-variant-numeric:tabular-nums">${esc(this.fmt(m, r.metrics[m]))}</div>
        <div style="font-size:10.5px;color:var(--text-muted)">${esc(gr || '—')}</div></div>`;
    }).join('');
    const f = this.findings(r);
    const k = r.weight.kinds || {};
    body.innerHTML = `
      <div style="padding:12px 14px 4px;font-size:14px;font-weight:650;color:var(--text)">${esc(this.summary(r))}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;padding:6px 14px 10px">${tiles}</div>
      <div style="padding:0 14px 8px;font-size:12px;color:var(--text-muted)">Downloaded ${r.weight.hiddenSizes ? 'at least ' : ''}${esc(this.size(r.weight.bytes))} in ${esc(r.weight.requests)} requests · ${Object.entries(k).filter(([, b]) => b).sort((a, b) => b[1] - a[1]).map(([n, b]) => esc(n + ' ' + this.size(b))).join(' · ')}${r.jsHeapMB ? ' · page memory ' + esc(r.jsHeapMB) + ' MB' : ''}</div>
      <div style="padding:4px 8px 10px">${f.length ? f.map(x => `<div style="display:flex;gap:8px;padding:6px;font-size:12.5px;color:var(--text)"><span style="flex:0 0 auto;margin-top:5px;width:8px;height:8px;border-radius:50%;background:${x.sev > 1 ? 'var(--danger,#e5534b)' : 'var(--warning,#d4a72c)'}"></span><span>${esc(x.text)}</span></div>`).join('') : '<div style="padding:10px 6px;font-size:12.5px;color:var(--text-muted)">Nothing here is slowing it down noticeably.</div>'}</div>
      ${r.heaviest && r.heaviest.length ? `<div style="padding:0 14px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted)">Heaviest files</div>
      <div style="padding:0 14px 14px">${r.heaviest.map(h => `<div style="display:flex;gap:10px;font-size:11.5px;padding:2px 0"><span style="flex:0 0 64px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text)">${esc(this.size(h.bytes))}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${esc(h.name)}</span></div>`).join('')}</div>` : ''}
      <div style="padding:0 14px 12px;font-size:10.5px;color:var(--text-muted)">${r.weight.hiddenSizes ? esc(r.weight.hiddenSizes + ' files from other sites did not reveal their size, so download totals are a minimum. ') : ''}Measured by Chromium as this page loaded. Graded against Google's Core Web Vitals thresholds. Run again reloads the page and measures a fresh load.</div>`;
    return sheet;
  },
};

if (typeof window !== 'undefined') window.PerfCheck = PerfCheck;
if (typeof module !== 'undefined' && module.exports) module.exports = { PerfCheck, auditPerformance };
