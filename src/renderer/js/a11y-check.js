// === Can everyone use this page? ============================================
//
// Accessibility audits live in developer tools most people never open, and
// report in WCAG success-criterion numbers most people cannot read. The
// problems themselves are plain: a picture a screen reader cannot describe, a
// form box with no name, a button that reads out as "button", grey text on a
// grey background, a page that does not say what language it is in.
//
// This checks the page in front of you for exactly those, in words, and
// outlines each one on the page. It is not a full WCAG audit and does not
// claim to be — it finds the common, certain failures, the ones a site owner
// can fix in an afternoon.
//
// The audit is a plain function so it can be tested; it is serialized and run
// inside the page, where the layout it needs (colours, sizes) actually exists.

// Runs IN THE PAGE. Must be self-contained: no closures over this file.
function auditPage(doc, win, opts) {
  const LIMIT = 60;                        // per rule — a list of 900 helps nobody
  const visible = (opts && opts.assumeVisible) ? () => true : (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = win.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  };
  const hidden = (el) => !!el.closest('[aria-hidden="true"], [hidden]');
  const issues = [];
  let n = 0;
  const counts = {};
  const add = (rule, severity, el, message) => {
    counts[rule] = (counts[rule] || 0) + 1;
    if (counts[rule] > LIMIT) return;
    // The page's own markup, read BEFORE Vex marks the element for "show on
    // page" — the marker is Vex's, not the site's, and has no place in a report.
    const snippet = el && el.outerHTML ? el.outerHTML.replace(/\s+/g, ' ').slice(0, 140) : '';
    let index = null;
    if (el && el.setAttribute) { index = n++; el.setAttribute('data-vex-a11y', String(index)); }
    issues.push({ rule, severity, message, snippet, index });
  };
  const text = (el) => String(el.textContent || '').replace(/\s+/g, ' ').trim();
  const labelledBy = (el) => {
    const ids = String(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return ids.map(id => doc.getElementById(id)).filter(Boolean).map(text).join(' ').trim();
  };
  const accessibleName = (el) => {
    const aria = String(el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const by = labelledBy(el);
    if (by) return by;
    const own = text(el);
    if (own) return own;
    const imgAlt = [...el.querySelectorAll('img[alt]')].map(i => i.getAttribute('alt').trim()).filter(Boolean).join(' ');
    if (imgAlt) return imgAlt;
    const svgTitle = el.querySelector('svg title');
    if (svgTitle && text(svgTitle)) return text(svgTitle);
    return String(el.getAttribute('title') || '').trim();
  };

  // --- the page itself -------------------------------------------------------
  const lang = String(doc.documentElement.getAttribute('lang') || '').trim();
  if (!lang) add('lang', 'error', null, 'The page does not say what language it is in, so a screen reader may read it in the wrong accent — or the wrong language.');
  if (!String(doc.title || '').trim()) add('title', 'error', null, 'The page has no title, so the tab, the history and a screen reader all call it nothing.');

  // --- pictures ------------------------------------------------------------------
  for (const img of doc.querySelectorAll('img')) {
    if (hidden(img) || img.getAttribute('role') === 'presentation' || img.getAttribute('role') === 'none') continue;
    if (!visible(img)) continue;
    const w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
    if (!(opts && opts.assumeVisible) && w && h && (w < 16 || h < 16)) continue;
    if (!img.hasAttribute('alt')) add('img-alt', 'error', img, 'A picture with no description. A screen reader says the file name instead — or skips it, and the point it made.');
  }

  // --- form fields ---------------------------------------------------------------
  const labelFor = new Set([...doc.querySelectorAll('label[for]')].map(l => l.getAttribute('for')));
  for (const f of doc.querySelectorAll('input, select, textarea')) {
    const type = String(f.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    if (hidden(f) || !visible(f)) continue;
    const named = String(f.getAttribute('aria-label') || '').trim() || labelledBy(f)
      || (f.id && labelFor.has(f.id)) || f.closest('label') || String(f.getAttribute('title') || '').trim();
    if (named) continue;
    if (String(f.getAttribute('placeholder') || '').trim()) add('field-label', 'warning', f, 'A box whose only label is its placeholder. It vanishes as soon as you type, and many screen readers do not read it.');
    else add('field-label', 'error', f, 'A box with no label. Someone using a screen reader hears "edit text" and has to guess what goes in it.');
  }

  // --- buttons and links -------------------------------------------------------
  for (const el of doc.querySelectorAll('a[href], button, [role="button"], [role="link"]')) {
    if (hidden(el) || !visible(el)) continue;
    if (accessibleName(el)) continue;
    const isLink = el.tagName === 'A' || el.getAttribute('role') === 'link';
    add(isLink ? 'link-name' : 'button-name', 'error', el, isLink
      ? 'A link with no words. A screen reader reads out the address, or just "link".'
      : 'A button with no words — usually an icon. A screen reader says only "button".');
  }

  // --- headings --------------------------------------------------------------------
  const heads = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(h => !hidden(h) && visible(h));
  if (!heads.some(h => h.tagName === 'H1')) add('headings', 'warning', null, 'No main heading (h1). People who move around a page by its headings have nowhere to start.');
  let prev = 0;
  for (const h of heads) {
    const level = Number(h.tagName[1]);
    if (prev && level > prev + 1) add('headings', 'warning', h, 'The headings jump from level ' + prev + ' to ' + level + ', so the outline has a missing step.');
    prev = level;
  }

  // --- contrast ----------------------------------------------------------------
  // WCAG's own formula: 4.5:1 for body text, 3:1 for large text (24px, or
  // 18.66px bold). A background image makes the real background unknowable,
  // so such text is left alone rather than guessed at.
  const parse = (c) => {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(String(c || ''));
    if (!m) return null;
    let a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: +m[1], g: +m[2], b: +m[3], a };
  };
  const lum = ({ r, g, b }) => {
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backgroundOf = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = win.getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a >= 0.95) return c;
      if (c && c.a > 0.05) return null;               // translucent layers: do not guess
    }
    return { r: 255, g: 255, b: 255, a: 1 };           // the canvas default
  };
  let checked = 0;
  const seenStyles = new Set();
  for (const el of doc.querySelectorAll('body *')) {
    if (checked > 1500) break;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) continue;
    const own = [...el.childNodes].some(c => c.nodeType === 3 && c.textContent.trim().length > 1);
    if (!own || hidden(el) || !visible(el)) continue;
    checked++;
    const cs = win.getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = backgroundOf(el);
    if (!fg || !bg || fg.a < 0.95) continue;
    const size = parseFloat(cs.fontSize) || 16;
    const bold = Number(cs.fontWeight) >= 700 || cs.fontWeight === 'bold';
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    if (got >= need) continue;
    // One report per colour pair and size, not one per paragraph in it.
    const key = cs.color + '|' + (bg.r + ',' + bg.g + ',' + bg.b) + '|' + large;
    if (seenStyles.has(key)) { counts.contrast = (counts.contrast || 0) + 1; continue; }
    seenStyles.add(key);
    add('contrast', got < need * 0.7 ? 'error' : 'warning', el, 'Text too faint to read comfortably: contrast ' + got.toFixed(2) + ':1, where ' + need + ':1 is the minimum for ' + (large ? 'large' : 'normal') + ' text.');
  }

  return { issues, counts, checkedText: checked };
}

const A11yCheck = {
  RULES: {
    'img-alt': 'Pictures with no description',
    'field-label': 'Form boxes with no label',
    'button-name': 'Buttons with no name',
    'link-name': 'Links with no words',
    'contrast': 'Text too faint',
    'headings': 'Heading structure',
    'lang': 'Page language',
    'title': 'Page title',
  },

  script() { return '(' + auditPage.toString() + ')(document, window, {})'; },

  async run() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('No page is open');
    const result = await window.vexGuestEval(wv, this.script());
    if (!result || !Array.isArray(result.issues)) throw new Error('The page could not be checked');
    this._render(result, wv);
    return result;
  },

  summary(result) {
    const errors = result.issues.filter(i => i.severity === 'error').length;
    const warnings = result.issues.filter(i => i.severity === 'warning').length;
    if (!errors && !warnings) return 'Nothing found. This is not a full audit, but the common, certain failures are not here.';
    return [errors ? errors + ' problem' + (errors === 1 ? '' : 's') : '', warnings ? warnings + ' to look at' : ''].filter(Boolean).join(' and ');
  },

  report(result, url) {
    const lines = ['Accessibility check' + (url ? ' — ' + url : ''), this.summary(result), ''];
    for (const [rule, label] of Object.entries(this.RULES)) {
      const items = result.issues.filter(i => i.rule === rule);
      if (!items.length) continue;
      const total = result.counts[rule] || items.length;
      lines.push(label + ' (' + total + ')');
      let last = null;
      for (const i of items) {
        if (i.message !== last) { lines.push('  ' + i.message); last = i.message; }
        if (i.snippet) lines.push('    ' + i.snippet);
      }
      if (total > items.length) lines.push('  …and ' + (total - items.length) + ' more like these');
      lines.push('');
    }
    return lines.join('\n').trim() + '\n';
  },

  _render(result, wv) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('Accessibility of this page', 'vex-a11y-overlay');
    head.insertAdjacentHTML('beforeend', `<button data-copy type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Copy report</button>`);
    head.querySelector('[data-copy]').addEventListener('click', async () => {
      let url = ''; try { url = wv.getURL(); } catch {}
      try { await navigator.clipboard.writeText(this.report(result, url)); window.showToast?.('Accessibility report copied'); }
      catch { window.showToast?.('Could not copy that', 'error'); }
    });
    body.innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)">${esc(this.summary(result))}</div><div data-rows style="padding:6px"></div>`;
    const list = body.querySelector('[data-rows]');
    for (const [rule, label] of Object.entries(this.RULES)) {
      const items = result.issues.filter(i => i.rule === rule);
      if (!items.length) continue;
      const total = result.counts[rule] || items.length;
      list.insertAdjacentHTML('beforeend', `<div style="padding:10px 8px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted)">${esc(label)} · ${total}</div>`);
      // The same sentence twelve times over is noise: say it once, then list
      // the elements it applies to underneath.
      let lastMessage = null;
      for (const i of items) {
        const repeat = i.message === lastMessage;
        lastMessage = i.message;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:8px';
        row.innerHTML = `
          <span style="flex:0 0 auto;margin-top:5px;width:8px;height:8px;border-radius:50%;background:${i.severity === 'error' ? 'var(--danger,#e5534b)' : 'var(--warning,#d4a72c)'}" title="${i.severity === 'error' ? 'Problem' : 'Worth a look'}"></span>
          <div style="flex:1;min-width:0">
            ${repeat ? '' : `<div style="font-size:12.5px;color:var(--text)">${esc(i.message)}</div>`}
            ${i.snippet ? `<code style="display:block;margin-top:${repeat ? 0 : 3}px;font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.snippet)}</code>` : ''}
          </div>
          ${i.index != null ? '<button data-find type="button" style="flex:0 0 auto;font-size:11px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer;color:var(--text)">Show on page</button>' : ''}`;
        row.querySelector('[data-find]')?.addEventListener('click', () => { close(); this.showOnPage(wv, i.index); });
        list.appendChild(row);
      }
      if (total > items.length) list.insertAdjacentHTML('beforeend', `<div style="padding:2px 24px 6px;font-size:11px;color:var(--text-muted)">…and ${total - items.length} more like these</div>`);
    }
    if (!result.issues.length) list.innerHTML = '<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing found.</div>';
  },

  showOnPage(wv, index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) return Promise.resolve(false);
    return window.vexGuestEval(wv, `(() => {
      const el = document.querySelector('[data-vex-a11y="${i}"]');
      if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const before = el.style.outline, offset = el.style.outlineOffset;
      el.style.outline = '3px solid #e5534b'; el.style.outlineOffset = '2px';
      setTimeout(() => { el.style.outline = before; el.style.outlineOffset = offset; }, 2600);
      return true;
    })()`).catch(() => false);
  },
};

if (typeof window !== 'undefined') window.A11yCheck = A11yCheck;
if (typeof module !== 'undefined' && module.exports) module.exports = { A11yCheck, auditPage };
