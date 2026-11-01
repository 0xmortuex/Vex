((opts) => {
  opts = opts || {};
  // Collect every visible text node / attribute in this document. Returns [{k,t,sc,w}]
  const SC = (window.VexI18nUI && VexI18nUI.SCOPES) ? VexI18nUI.SCOPES.join(',') : '';
  const out = [];
  const seen = new Set();
  const vis = (el) => {
    if (!el || !el.isConnected) return false;
    if (opts.all) return true;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
    const r = el.getClientRects(); return r.length > 0 && r[0].width > 0 && r[0].height > 0;
  };
  const where = (el) => {
    let e = el, i = 0;
    while (e && e.nodeType === 1 && i < 12) {
      if (e.id) return '#' + e.id;
      e = e.parentElement; i++;
    }
    return '?';
  };
  const cls = (el) => (el.className && el.className.toString ? el.className.toString().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '');
  const push = (k, t, el) => {
    t = (t || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2) return;
    const key = k + '|' + t + '|' + where(el);
    if (seen.has(key)) return;
    seen.add(key);
    let sc = false; try { sc = !!(SC && el.closest(SC)); } catch { /* selector */ }
    out.push({ k, t, sc, w: where(el), c: cls(el), tag: el.tagName });
  };
  const roots = opts.root ? [...document.querySelectorAll(opts.root)] : [document.body];
  // shadow roots
  const walk = (root) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) {
        const p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) continue;
        if (p.closest('webview')) continue;
        if (!vis(p)) continue;
        push('text', n.nodeValue, p);
      } else {
        const el = n;
        if (el.tagName === 'WEBVIEW' || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
        if (el.shadowRoot) walk(el.shadowRoot);
        if (el.tagName === 'OPTION') { const s = el.closest('select'); if (s && vis(s)) push('option', el.textContent, s); continue; }
        if (!vis(el)) continue;
        for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'data-tip', 'data-tooltip']) {
          const v = el.getAttribute(a); if (v) push(a, v, el);
        }
        if (el.tagName === 'INPUT' && /^(button|submit)$/.test(el.type) && el.value) push('value', el.value, el);
        if (el.tagName === 'OPTION') push('option', el.textContent, el);
      }
    }
  };
  for (const r of roots) walk(r);
  return out;
})
