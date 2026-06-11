// === Vex DOM Extractor — interactive elements with stable selectors ===

const DOMExtractor = {
  async extractInteractiveElements(webview) {
    if (!webview) return { url: '', title: '', elements: [], totalFound: 0 };
    try {
      return await webview.executeJavaScript(`
        (() => {
          const items = []; let c = 0;
          const sel = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [onclick], [tabindex]:not([tabindex="-1"])';
          document.querySelectorAll(sel).forEach(n => {
            const r = n.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            const s = getComputedStyle(n);
            if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return;
            const vid = 'vex-' + (++c);
            n.setAttribute('data-vex-id', vid);
            let label = '';
            if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') {
              label = n.placeholder || n.name || n.getAttribute('aria-label') || n.id || '';
              if (n.type === 'submit' || n.type === 'button') label = n.value || label;
            } else if (n.tagName === 'SELECT') {
              label = n.getAttribute('aria-label') || n.name || n.id || '';
            } else {
              label = (n.innerText || '').trim().substring(0, 80) || n.getAttribute('aria-label') || n.title || '';
            }
            items.push({
              id: vid, tag: n.tagName.toLowerCase(), type: n.type || null,
              label: label.substring(0, 120), href: n.href || null,
              selector: '[data-vex-id="' + vid + '"]',
              position: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
              isVisible: r.top < window.innerHeight && r.bottom > 0,
              value: n.value !== undefined ? String(n.value).substring(0, 200) : null,
              options: n.tagName === 'SELECT' ? Array.from(n.options).map(o => ({ value: o.value, label: o.text })).slice(0, 30) : null
            });
          });
          return { url: location.href, title: document.title, elements: items.slice(0, 100), totalFound: items.length };
        })()
      `);
    } catch (e) {
      return { url: '', title: '', elements: [], totalFound: 0, error: e.message };
    }
  }
};
