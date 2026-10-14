// === Page Watcher: the parts you see ========================================
//
// js/page-watch.js is the engine (what is fetched, kept and said); this file
// is what you touch:
//
//   * the dialog that makes a watch: the whole page, one part of it (picked by
//     selecting text and right-clicking), or a number / price / version
//   * the diff view: what a watched page said before and what it says now
//   * the toolbar badge, shown only while a watched page has changed and you
//     have not looked
//   * the Settings block: the global switch and the limits
//
// Dialogs here are Vex's own (no native confirm / prompt), icons are VexIcons.
const PageWatchUI = {
  // The page in front, as the person sees it: what they selected becomes a
  // selector (and the first words, so a part that moved can be found again).
  // Run inside the page (webview.executeJavaScript); returns null when there
  // is no selection.
  SELECTION_SCRIPT: `(function () {
    function esc(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\\\' + c; }); }
    function stable(c) { return c && c.length <= 24 && !/\\d{3,}|^(?:css|jsx|sc|svelte|ember|emotion|styled)-\\w+$/.test(c) && /^[A-Za-z][\\w-]*$/.test(c); }
    function part(el) {
      var tag = el.tagName.toLowerCase();
      var cls = Array.prototype.filter.call(el.classList || [], stable).slice(0, 2);
      var s = tag + cls.map(function (c) { return '.' + esc(c); }).join('');
      var p = el.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (n) { return n.tagName === el.tagName; });
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      return s;
    }
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var text = String(sel.toString()).replace(/\\s+/g, ' ').trim();
    if (!text) return null;
    var node = sel.getRangeAt(0).commonAncestorContainer;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || el === document.documentElement || el === document.body) return { selector: '', anchor: text.slice(0, 80), text: text.slice(0, 200), url: location.href, title: document.title };
    var chain = [];
    var cur = el;
    for (var depth = 0; cur && cur !== document.body && depth < 7; depth++) {
      if (cur.id && /^[A-Za-z][\\w-]{0,40}$/.test(cur.id) && document.querySelectorAll('#' + esc(cur.id)).length === 1) {
        chain.unshift('#' + esc(cur.id));
        break;
      }
      chain.unshift(part(cur));
      var sofar = chain.join(' > ');
      try { if (document.querySelectorAll(sofar).length === 1) break; } catch (e) { return null; }
      cur = cur.parentElement;
    }
    return { selector: chain.join(' > '), anchor: text.slice(0, 80), text: text.slice(0, 200), url: location.href, title: document.title };
  })()`,

  // --- the toolbar badge ---------------------------------------------------
  init() {
    this._btn = document.getElementById('btn-page-watch');
    if (this._btn && !this._btn._pwWired) {
      this._btn._pwWired = true;
      this._btn.innerHTML = (window.VexIcons ? VexIcons.svg('eye', { size: 16 }) : '') + '<span class="pw-badge" aria-hidden="true"></span>';
      this._btn.addEventListener('click', () => PageWatch.showManager());
    }
    const refresh = () => this.refreshBadge();
    document.addEventListener('vex:page-watch', refresh);
    document.addEventListener('vex:page-watch-list', refresh);
    this._injectStyle();
    this.refreshBadge();
  },

  refreshBadge() {
    const b = this._btn || document.getElementById('btn-page-watch');
    if (!b) return 0;
    const n = typeof PageWatch !== 'undefined' ? PageWatch.unseenCount() : 0;
    b.hidden = n === 0;
    const badge = b.querySelector('.pw-badge');
    if (badge) badge.textContent = n > 9 ? '9+' : String(n);
    const label = n === 1 ? '1 watched page changed' : n + ' watched pages changed';
    b.title = label + ' — open Watched pages';
    b.setAttribute('aria-label', label);
    return n;
  },

  // --- making a watch ------------------------------------------------------
  // From the page's right-click menu: `selection` true when text is selected
  // and the person chose "Watch this part of the page".
  async openForWebview(webview, { selection = false } = {}) {
    try {
      const url = webview.getURL();
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => String(t.id) === String(webview.dataset && webview.dataset.tabId)) : null;
      const partition = (tab && tab.partition) || (webview.getAttribute && webview.getAttribute('partition')) || null;
      const title = (tab && tab.title) || (webview.getTitle && webview.getTitle()) || url;
      let picked = null;
      if (selection) {
        picked = await webview.executeJavaScript(this.SELECTION_SCRIPT);
        if (!picked) { window.showToast?.('Select some text on the page first', 'error'); return null; }
      }
      return this.open({ url, title, partition, picked });
    } catch (err) {
      window.showToast?.((err && err.message) || 'Could not start a watch', 'error');
      return null;
    }
  },

  // Ctrl+K: the page in front.
  async openForActiveTab() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab || !/^https?:/i.test(tab.url || '')) { window.showToast?.('Open a website first', 'error'); return null; }
    return this.open({ url: tab.url, title: tab.title || tab.url, partition: tab.partition || null, picked: null });
  },

  // The dialog. Resolves with the watch that was made, or null.
  open({ url, title, partition = null, picked = null }) {
    if (typeof PageWatch === 'undefined') { window.showToast?.('Not available in this build', 'error'); return Promise.resolve(null); }
    // Said before the form, not after filling it in: a tab that is private,
    // routed or in a container is not watched.
    const refusal = PageWatch.refusalFor({ url, partition });
    if (refusal) { window.showToast?.(refusal, 'error'); return Promise.resolve(null); }
    this._injectStyle();
    document.getElementById('pw-add')?.remove();
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* shown as given */ }
    const settings = PageWatch.settings();
    const aiReady = this._localAiReady();
    const everyOpts = PageWatch.EVERY.filter(e => e.ms >= 15 * 60000)
      .map(e => `<option value="${e.ms}"${e.ms === 3600000 ? ' selected' : ''}>${esc(e.label)}</option>`).join('');
    const wrap = document.createElement('div');
    wrap.id = 'pw-add';
    wrap.className = 'pw-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'pw-add-title');
    wrap.innerHTML = `<form class="pw-card" novalidate>
      <h2 id="pw-add-title" class="pw-title">Watch this page for changes</h2>
      <div class="pw-sub-title">${esc(title || url)} <span class="pw-muted">· ${esc(host)}</span></div>

      <fieldset class="pw-field"><legend>Where on the page</legend>
        <label class="pw-radio"><input type="radio" name="pw-where" value="page" ${picked ? '' : 'checked'}> The whole page</label>
        <label class="pw-radio"><input type="radio" name="pw-where" value="part" ${picked ? 'checked' : ''}> One part of it</label>
        <div class="pw-nest" data-when-where="part">
          <label class="pw-lbl" for="pw-selector">Its CSS selector</label>
          <input id="pw-selector" type="text" value="${esc(picked ? picked.selector : '')}" placeholder=".price  or  #status" autocomplete="off" spellcheck="false">
          <div class="pw-picked" id="pw-picked">${picked ? 'Selected: “' + esc(picked.text) + '”' : 'Tip: select text on the page, right-click, and choose “Watch this part of the page”.'}</div>
        </div>
      </fieldset>

      <fieldset class="pw-field"><legend>What counts as a change</legend>
        <label class="pw-radio"><input type="radio" name="pw-what" value="text" checked> Any change in the words</label>
        <label class="pw-radio"><input type="radio" name="pw-what" value="number"> A number, price or version</label>
        <div class="pw-nest" data-when-what="number">
          <label class="pw-lbl" for="pw-extract">Look for</label>
          <select id="pw-extract">
            <option value="price">A price</option><option value="number">The first number</option>
            <option value="version">A version number</option><option value="custom">My own pattern…</option>
          </select>
          <input id="pw-pattern" type="text" placeholder="build #(\\d+)" autocomplete="off" spellcheck="false" aria-label="Your own pattern (a regular expression; the part in brackets is kept)" hidden>
          <label class="pw-lbl" for="pw-when">Tell me when</label>
          <select id="pw-when">
            <option value="any">It changes</option><option value="down">It goes down</option><option value="up">It goes up</option>
            <option value="below">It goes below…</option><option value="above">It goes above…</option>
          </select>
          <input id="pw-target" type="text" inputmode="decimal" placeholder="a figure, e.g. 300" aria-label="The figure" hidden>
        </div>
      </fieldset>

      <div class="pw-field">
        <label class="pw-lbl" for="pw-every">Check</label>
        <select id="pw-every">${everyOpts}</select>
      </div>
      <label class="pw-check"><input type="checkbox" id="pw-wake"> Open Vex to check even when it is closed <span class="pw-muted">(once a day, at 08:00, through Windows)</span></label>
      <label class="pw-check"><input type="checkbox" id="pw-render"> Read it as a hidden tab <span class="pw-muted">(for pages built by JavaScript; uses more memory)</span></label>
      <label class="pw-check"><input type="checkbox" id="pw-ai" ${settings.summarize ? 'checked' : ''} ${aiReady ? '' : 'disabled'}> Describe changes with my local AI model <span class="pw-muted">${aiReady ? '(on this computer only)' : '(needs a local model — Settings › AI)'}</span></label>
      <p class="pw-note">Vex asks the page from this computer, the way a visitor would, never logs in, and never fills anything in. Pages open in Tor, a proxy, a container or a private tab are not watched.</p>
      <div class="pw-error" id="pw-error" role="alert"></div>
      <div class="pw-actions"><button type="button" class="pw-btn" id="pw-cancel">Cancel</button><button type="submit" class="pw-btn pw-primary">Watch it</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const q = (s) => wrap.querySelector(s);
    const form = q('form');
    const sync = () => {
      const where = form.querySelector('input[name="pw-where"]:checked').value;
      const what = form.querySelector('input[name="pw-what"]:checked').value;
      wrap.querySelectorAll('[data-when-where]').forEach(n => { n.hidden = where !== n.dataset.whenWhere; });
      wrap.querySelectorAll('[data-when-what]').forEach(n => { n.hidden = what !== n.dataset.whenWhat; });
      q('#pw-pattern').hidden = what !== 'number' || q('#pw-extract').value !== 'custom';
      q('#pw-target').hidden = what !== 'number' || !/^(below|above)$/.test(q('#pw-when').value);
    };
    form.addEventListener('change', sync);
    sync();

    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const close = (value) => {
        document.removeEventListener('keydown', onKey, true);
        wrap.remove();
        try { prevFocus && prevFocus.focus && prevFocus.focus({ preventScroll: true }); } catch { /* the opener is gone */ }
        resolve(value);
      };
      const onKey = (e) => {
        if (!wrap.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
        if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
        e.preventDefault(); e.stopPropagation(); close(null);
      };
      document.addEventListener('keydown', onKey, true);
      q('#pw-cancel').addEventListener('click', () => close(null));
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = q('#pw-error');
        err.textContent = '';
        try {
          const spec = this.readForm(form, { url, title, partition, picked });
          const watch = PageWatch.add(spec);
          close(watch);
          window.showToast?.('Watching — Vex will say what changed' + (watch.local ? '. ' + PageWatch.localNote(watch) : ''));
          await PageWatch.firstLook(watch);
          this.refreshBadge();
        } catch (error) {
          err.textContent = (error && error.message) || 'Could not start the watch';
        }
      });
      (picked ? q('#pw-selector') : form.querySelector('input[name="pw-where"]:checked')).focus({ preventScroll: true });
    });
  },

  // The dialog's fields → what PageWatch.add takes. Throws, in words, for a
  // combination that cannot work.
  readForm(form, { url, title, partition, picked }) {
    const val = (s) => form.querySelector(s);
    const where = val('input[name="pw-where"]:checked').value;
    const what = val('input[name="pw-what"]:checked').value;
    const selector = where === 'part' ? val('#pw-selector').value.trim() : '';
    if (where === 'part' && !selector) throw new Error('Give the selector of the part to watch, or choose "The whole page"');
    const D = PageWatch._diff();
    const spec = {
      url, title, partition, byUser: true, selector,
      anchor: where === 'part' && picked ? picked.anchor : '',
      every: Number(val('#pw-every').value),
      wake: val('#pw-wake').checked, render: val('#pw-render').checked,
      summarize: val('#pw-ai').disabled ? null : val('#pw-ai').checked,
    };
    if (what === 'text') return { ...spec, kind: 'text' };
    const extract = val('#pw-extract').value;
    const when = val('#pw-when').value;
    let pattern = '';
    if (extract === 'custom') {
      pattern = val('#pw-pattern').value.trim();
      D.compile(pattern);
    } else if (extract !== 'number') pattern = D.PRESETS[extract].pattern;
    if (when === 'any') return { ...spec, kind: 'regex', pattern: pattern || D.PRESETS.number.pattern };
    if (extract === 'version') throw new Error('A version number is watched for "It changes" — it has no up or down');
    const out = { ...spec, kind: 'number', pattern, direction: when };
    if (when === 'below' || when === 'above') {
      const t = Number(String(val('#pw-target').value).replace(/,/g, '.').trim());
      if (!Number.isFinite(t)) throw new Error('Give the figure, e.g. 300');
      out.target = t;
    }
    return out;
  },

  _localAiReady() {
    try { return typeof Ollama !== 'undefined' && typeof AIRouter !== 'undefined' && AIRouter.isOllamaAvailable() && !!AIRouter.getModel(); }
    catch { return false; }
  },

  // --- what changed --------------------------------------------------------
  // The history of one watch: pick two looks, see the lines added and removed.
  showDiff(id) {
    const w = PageWatch.list().find(x => x.id === id);
    if (!w) { window.showToast?.('That watch is gone', 'error'); return; }
    this._injectStyle();
    const snaps = PageWatch.history(id);
    document.getElementById('pw-diff')?.remove();
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s)) : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const when = (s) => new Date(s.at).toLocaleString();
    const wrap = document.createElement('div');
    wrap.id = 'pw-diff';
    wrap.className = 'pw-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'pw-diff-title');
    const opts = (sel) => snaps.map((s, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(when(s))}</option>`).join('');
    wrap.innerHTML = `<div class="pw-card pw-wide">
      <h2 id="pw-diff-title" class="pw-title">What changed on ${esc(w.title)}</h2>
      ${snaps.length < 2
        ? '<p class="pw-muted">Only one look is kept so far. When the page changes, the difference appears here.</p>'
        : `<div class="pw-compare"><label for="pw-from">From</label><select id="pw-from">${opts(snaps.length - 2)}</select><label for="pw-to">to</label><select id="pw-to">${opts(snaps.length - 1)}</select></div>
           <div id="pw-diff-body" class="pw-diff" aria-live="polite"></div>`}
      ${w.lastSummary ? `<p class="pw-ai"><strong>In a sentence:</strong> ${esc(w.lastSummary)}</p>` : ''}
      <div class="pw-actions"><button type="button" class="pw-btn" id="pw-diff-open">Open the page</button><button type="button" class="pw-btn pw-primary" id="pw-diff-close">Done</button></div>
    </div>`;
    document.body.appendChild(wrap);
    const q = (s) => wrap.querySelector(s);
    const draw = () => {
      if (snaps.length < 2) return;
      const a = snaps[Number(q('#pw-from').value)], b = snaps[Number(q('#pw-to').value)];
      const body = q('#pw-diff-body');
      if (!a || !b || a === b) { body.textContent = 'Pick two different looks.'; return; }
      const d = PageWatch._diff().lineDiff(a.text.split('\n'), b.text.split('\n'));
      if (!d.added.length && !d.removed.length) { body.textContent = 'Nothing differs between these two looks.'; return; }
      const cap = 200;
      const rows = [...d.removed.map(t => ['-', t]), ...d.added.map(t => ['+', t])];
      body.innerHTML = rows.slice(0, cap).map(([s, t]) => `<div class="pw-line ${s === '+' ? 'pw-add' : 'pw-del'}"><span class="pw-sign" aria-label="${s === '+' ? 'added' : 'removed'}">${s}</span><span>${esc(t)}</span></div>`).join('')
        + (rows.length > cap ? `<div class="pw-muted">… and ${rows.length - cap} more lines</div>` : '')
        + (a.truncated || b.truncated ? '<div class="pw-muted">Long pages are kept up to a size; the end of this one is not in the history.</div>' : '');
    };
    wrap.addEventListener('change', draw);
    draw();
    const onKey = (e) => {
      if (!wrap.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
    document.addEventListener('keydown', onKey, true);
    q('#pw-diff-close').addEventListener('click', close);
    q('#pw-diff-open').addEventListener('click', () => { PageWatch.markSeen(id); TabManager.createTab(w.url, true); close(); });
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    PageWatch.markSeen(id);
    q('#pw-diff-close').focus({ preventScroll: true });
  },

  // --- Settings > Page watcher ---------------------------------------------
  renderSettings(container) {
    if (!container || typeof PageWatch === 'undefined') return;
    const s = PageWatch.settings();
    const aiReady = this._localAiReady();
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">Vex checks the pages you chose to watch and tells you what changed. It asks from this computer, never logs in, waits longer when a page keeps failing, and keeps only a short, size-limited history on this device.</p>
      <div class="setting-toggle-row">
        <span>Watch pages for changes</span>
        <label class="toggle"><input type="checkbox" id="pw-set-enabled" aria-label="Watch pages for changes" ${s.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
      <div class="setting-toggle-row">
        <span>Describe changes with my local AI model <span style="color:var(--text-muted);font-size:11px">· ${aiReady ? 'on this computer only; nothing goes to a cloud service' : 'needs a local model set up in Settings › AI'}</span></span>
        <label class="toggle"><input type="checkbox" id="pw-set-ai" aria-label="Describe changes with my local AI model" ${s.summarize ? 'checked' : ''} ${aiReady ? '' : 'disabled'}><span class="toggle-slider"></span></label>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <label for="pw-set-sens">How small a change to tell</label>
        <select id="pw-set-sens">
          <option value="low"${s.sensitivity === 'low' ? ' selected' : ''}>Only bigger changes (3 lines or more)</option>
          <option value="normal"${s.sensitivity === 'normal' ? ' selected' : ''}>Any change in the words</option>
          <option value="high"${s.sensitivity === 'high' ? ' selected' : ''}>Everything, even a clock</option>
        </select>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <label for="pw-set-max">Pages watched at most</label>
        <input id="pw-set-max" type="number" min="1" max="${PageWatch.LIMIT_CEILING.maxWatches}" value="${s.maxWatches}" style="width:80px">
        <label for="pw-set-snaps">Looks kept for each page</label>
        <input id="pw-set-snaps" type="number" min="1" max="${PageWatch.LIMIT_CEILING.maxSnapshots}" value="${s.maxSnapshots}" style="width:80px">
      </div>
      <div style="margin-top:10px"><button type="button" class="btn-secondary" id="pw-set-open">Watched pages…</button></div>`;
    const save = (patch) => {
      try { PageWatch.setSettings(patch); window.showToast?.('Page watcher updated'); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not save', 'error'); }
      this.refreshBadge();
    };
    const num = (el, def) => { const n = Math.floor(Number(el.value)); return Number.isFinite(n) && n >= 1 ? n : def; };
    container.querySelector('#pw-set-enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
    container.querySelector('#pw-set-ai').addEventListener('change', (e) => save({ summarize: e.target.checked }));
    container.querySelector('#pw-set-sens').addEventListener('change', (e) => save({ sensitivity: e.target.value }));
    container.querySelector('#pw-set-max').addEventListener('change', (e) => save({ maxWatches: num(e.target, s.maxWatches) }));
    container.querySelector('#pw-set-snaps').addEventListener('change', (e) => save({ maxSnapshots: num(e.target, s.maxSnapshots) }));
    container.querySelector('#pw-set-open').addEventListener('click', () => PageWatch.showManager());
  },

  _injectStyle() {
    if (document.getElementById('pw-styles')) return;
    const st = document.createElement('style');
    st.id = 'pw-styles';
    st.textContent = `
      #btn-page-watch { position: relative; }
      #btn-page-watch .pw-badge { position:absolute; top:-2px; right:-2px; min-width:14px; height:14px; padding:0 3px; border-radius:7px;
        background:var(--primary,#4f8cff); color:var(--on-primary,#fff); font-size:9px; line-height:14px; text-align:center; font-weight:700; box-sizing:border-box; pointer-events:none; }
      .pw-overlay { position:fixed; inset:0; z-index:100050; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; }
      .pw-card { width:480px; max-width:94vw; max-height:88vh; overflow-y:auto; background:var(--surface); color:var(--text); border:1px solid var(--border);
        border-radius:14px; box-shadow:0 24px 60px rgba(0,0,0,0.5); padding:18px 20px; box-sizing:border-box; }
      .pw-card.pw-wide { width:640px; }
      .pw-title { margin:0 0 4px; font-size:16px; font-weight:600; }
      .pw-sub-title { font-size:12.5px; margin-bottom:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pw-muted { color:var(--text-muted); font-size:11.5px; }
      .pw-field { border:0; padding:0; margin:0 0 12px; }
      .pw-field legend { font-size:12px; color:var(--text-muted); padding:0; margin-bottom:4px; }
      .pw-radio, .pw-check { display:flex; align-items:center; gap:8px; font-size:13px; padding:3px 0; }
      .pw-check { margin-top:2px; }
      .pw-nest { margin:4px 0 4px 24px; display:flex; flex-direction:column; gap:5px; }
      .pw-nest[hidden], .pw-nest input[hidden] { display:none; }
      .pw-lbl { font-size:12px; color:var(--text-muted); }
      .pw-card input[type=text], .pw-card select { background:var(--surface-2,var(--bg)); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:6px 8px; font:inherit; font-size:13px; }
      .pw-picked { font-size:11.5px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; }
      .pw-note { font-size:11.5px; color:var(--text-muted); margin:10px 0 0; }
      .pw-error { color:var(--danger,#e5484d); font-size:12.5px; min-height:16px; margin-top:6px; }
      .pw-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
      .pw-btn { padding:7px 16px; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:8px; cursor:pointer; font:inherit; font-size:13px; }
      .pw-btn.pw-primary { background:var(--primary); color:var(--on-primary,#fff); border-color:transparent; font-weight:600; }
      .pw-compare { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:8px 0; font-size:12.5px; }
      .pw-diff { max-height:46vh; overflow:auto; border:1px solid var(--border); border-radius:8px; padding:6px; font-size:12.5px; }
      .pw-line { display:flex; gap:8px; padding:2px 4px; border-radius:4px; word-break:break-word; }
      .pw-line.pw-add { background:color-mix(in srgb, var(--success,#22c55e) 16%, transparent); }
      .pw-line.pw-del { background:color-mix(in srgb, var(--danger,#e5484d) 16%, transparent); text-decoration:line-through; text-decoration-color:color-mix(in srgb, var(--danger,#e5484d) 55%, transparent); }
      .pw-sign { width:12px; flex:none; font-weight:700; }
      .pw-ai { font-size:12.5px; margin:10px 0 0; }
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.PageWatchUI = PageWatchUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { PageWatchUI };
