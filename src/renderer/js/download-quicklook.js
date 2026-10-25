// === Quick look at a finished download =====================================
//
// Space on a finished download in the Downloads panel (or its eye button, or
// right-click > Quick look) shows what is inside the file over the panel,
// without opening any other program. Left and Right move to the previous and
// next download, Esc closes, Enter opens the file with Windows.
//
// The file is READ BY MAIN (src/main/download-peek.js), which serves only files
// Vex downloaded, within size caps. This side only draws what comes back:
//   picture   zoom (wheel, + and -, buttons) and drag to move
//   PDF       the first pages, drawn with pdf.js (vendor/runtime/pdf.mjs)
//   text      the first 200 KB: JSON coloured, CSV as a table, Markdown drawn
//   audio and video   a small player of Vex's own, quiet by default
//   archive   names and sizes, nothing unpacked
//   Office    the first text of a .docx / .xlsx / .pptx
//   program   (.exe .msi .bat .cmd .ps1 .scr .lnk .jar ...) NEVER opened or run
//             from here: a card that says what it is, who signed it, and
//             "Show in folder" only; Enter does nothing
//   anything else   a clear card
//
// Everything drawn from a file is put in with textContent, never as markup.
// Every visible word goes through T() so the Turkish table can be checked.

const VexQuickLook = (() => {
  const T = (s) => s;            // marks a visible English string for the translation table (tests/renderer/downloadQuickLook.test.js)
  const NS = 'http://www.w3.org/2000/svg';

  const KIND_ICON = { image: 'image', pdf: 'file', text: 'note', audio: 'music', video: 'video', archive: 'archive', office: 'book', program: 'warning', other: 'file' };
  const KIND_NAME = { image: T('Picture'), pdf: T('PDF document'), text: T('Text file'), audio: T('Audio'), video: T('Video file'), archive: T('Archive'), office: T('Office document'), program: T('Program'), other: T('File') };
  const PDF_PAGES = 5;
  const CSV_ROWS = 200, CSV_COLS = 30;

  let ov = null;            // the overlay element
  let items = [];           // the downloads Quick look walks through
  let index = 0;
  let token = 0;            // bumped on every load; a late answer for an old one is dropped
  let cleanup = [];         // functions that release the current preview (object URLs, a pdf, a player)
  let cur = null;           // { dl, info } of the current download
  let menuEl = null;

  const icon = (name, size = 16) => (window.VexIcons ? VexIcons.svg(name, { size }) : '');

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;       // only ever Vex's own icon markup
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const btn = (label, iconName, onclick, extra = {}) => h('button', { type: 'button', class: 'dlql-btn' + (extra.class ? ' ' + extra.class : ''), title: label, 'aria-label': label, onclick, ...(extra.attrs || {}) },
    iconName ? h('span', { class: 'dlql-ic', 'aria-hidden': 'true', html: icon(iconName, 16) }) : null, extra.text ? h('span', null, extra.text) : null);

  const fmtBytes = (n) => (typeof DownloadsPanel !== 'undefined' ? DownloadsPanel.formatBytes(n) : n + ' B');
  const fmtDate = (ms) => new Date(ms).toLocaleString((window.VexI18n?.dateLocale('en-US') || 'en-US'), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const siteOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''; } catch { return ''; } };
  // A sentence with a changing part: the English template is what the Turkish table holds; {1} {2} are filled in.
  const fill = (tpl, ...v) => tpl.replace(/\{(\d)\}/g, (_, n) => String(v[n - 1]));
  const plain = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

  // ---- the downloads Quick look can walk through -----------------------------
  // Finished, still on disk, in the order the panel shows them (a search that hides rows hides them here too).
  function previewable(dl) { return !!dl && dl.state === 'completed' && !!dl.path && !dl.missing; }
  function listFromPanel() {
    const list = document.getElementById('downloads-list');
    const shown = list ? [...list.querySelectorAll('.download-item:not([hidden])')].map(r => r.dataset.id) : [];
    const byId = new Map(DownloadsPanel.downloads.map(d => [d.id, d]));
    const out = shown.map(id => byId.get(id)).filter(previewable);
    return out;
  }

  // ---- open / close ----------------------------------------------------------
  function open(id) {
    if (typeof DownloadsPanel === 'undefined') throw new Error('The Downloads panel is not ready');
    const all = listFromPanel();
    const at = all.findIndex(d => d.id === id);
    if (at < 0) { window.showToast?.(T('Quick look works on a finished download that is still on this computer'), 'info'); return false; }
    items = all; index = at;
    if (!ov) build();
    show();
    return true;
  }

  function build() {
    const host = document.getElementById('panel-downloads') || document.body;
    ov = h('div', { class: 'dlql-ov', onclick: (e) => { if (e.target === ov) close(); } },
      h('div', { class: 'dlql-card', tabindex: '-1', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlql-title' },
        h('div', { class: 'dlql-head' },
          h('span', { class: 'dlql-kind', 'aria-hidden': 'true' }),
          h('div', { class: 'dlql-titles' },
            h('span', { class: 'dlql-eyebrow' }, T('Quick look')),
            h('h2', { id: 'dlql-title', class: 'dlql-title' })),
          h('span', { class: 'dlql-pos', 'aria-live': 'polite' }),
          btn(T('Previous download'), 'arrow-left', () => step(-1), { attrs: { 'data-act': 'prev' } }),
          btn(T('Next download'), 'arrow-right', () => step(1), { attrs: { 'data-act': 'next' } }),
          btn(T('Close'), 'x', close, { attrs: { 'data-act': 'close' } })),
        h('div', { class: 'dlql-stage' }),
        h('div', { class: 'dlql-foot' },
          h('div', { class: 'dlql-meta' }),
          h('div', { class: 'dlql-acts' }))));
    ov.addEventListener('keydown', onKey);
    host.appendChild(ov);
    if (window.VexFocusTrap?.adopt) VexFocusTrap.adopt(ov.firstElementChild, { label: T('Quick look') });
    window.VexI18nUI?.apply?.(ov);
  }

  function close() {
    if (!ov) return;
    const id = cur && cur.dl && cur.dl.id;
    release();
    token++;
    ov.remove();
    ov = null; cur = null; items = [];
    // Focus goes back to the row of the download last looked at, which may not be the one that opened it.
    const row = id && typeof DownloadsPanel !== 'undefined' ? DownloadsPanel._rowFor(id) : null;
    if (row) { row.focus({ preventScroll: false }); row.scrollIntoView?.({ block: 'nearest' }); }
  }

  function release() { const fns = cleanup; cleanup = []; for (const f of fns) { try { f(); } catch (err) { console.error('[QuickLook] could not release a preview:', err); } } }

  function step(d) {
    if (items.length < 2) return;
    index = (index + d + items.length) % items.length;
    show();
  }

  // ---- the keys --------------------------------------------------------------
  function onKey(e) {
    const t = e.target;
    const onButton = t && t.closest && t.closest('button');
    const onMedia = t && /^(AUDIO|VIDEO|INPUT)$/.test(t.tagName);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft' && !(onMedia && t.type === 'range')) { e.preventDefault(); step(-1); return; }
    if (e.key === 'ArrowRight' && !(onMedia && t.type === 'range')) { e.preventDefault(); step(1); return; }
    if (e.key === 'Enter' && !onButton) { e.preventDefault(); openWithWindows(); return; }
    if (e.key === ' ' && !onButton && !onMedia) { e.preventDefault(); close(); return; }
    if (cur && cur.zoom) {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); cur.zoom.by(1.25); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); cur.zoom.by(0.8); }
      else if (e.key === '0') { e.preventDefault(); cur.zoom.fit(); }
      else if (e.key === '1') { e.preventDefault(); cur.zoom.actual(); }
    }
  }

  async function openWithWindows() {
    if (!cur) return;
    // A program is never opened from a preview: it is shown in its folder, and that is all.
    if (cur.info && cur.info.kind === 'program') { window.showToast?.(T('A program is not opened from Quick look. Use Show in folder.'), 'info'); return; }
    await DownloadsPanel.openChecked(cur.dl);
  }

  // ---- one download ----------------------------------------------------------
  async function show() {
    release();
    const mine = ++token;
    const dl = items[index];
    cur = { dl, info: null };
    const q = (s) => ov.querySelector(s);
    const kind0 = guessKind(dl.filename);
    q('.dlql-title').textContent = dl.filename;
    q('.dlql-kind').innerHTML = icon(KIND_ICON[kind0], 20);
    q('.dlql-pos').textContent = items.length > 1 ? (index + 1) + ' / ' + items.length : '';
    q('[data-act="prev"]').disabled = q('[data-act="next"]').disabled = items.length < 2;
    const stage = q('.dlql-stage');
    stage.replaceChildren(h('div', { class: 'dlql-note', role: 'status' }, T('Reading the file…')));
    q('.dlql-meta').replaceChildren();
    q('.dlql-acts').replaceChildren();
    paintActions(dl, kind0);
    // The button that had focus may have just been replaced: keep the keys (Esc, arrows) working.
    if (!ov.contains(document.activeElement)) ov.firstElementChild.focus({ preventScroll: true });

    let info;
    try { info = await window.vex.downloadsPeek(dl.path); }
    catch (err) { info = { ok: false, error: plain(err) }; }
    if (mine !== token || !ov) return;
    if (!info || !info.ok) {
      cur.info = null;
      stage.replaceChildren(card(dl, { kind: kind0, name: dl.filename, size: dl.totalBytes || dl.receivedBytes || 0 }, { problem: (info && info.error) || T('Quick look could not read this file') }));
      paintMeta(dl, { kind: kind0, size: dl.totalBytes || dl.receivedBytes || 0 });
      return;
    }
    cur.info = info;
    q('.dlql-kind').innerHTML = icon(KIND_ICON[info.kind] || 'file', 20);
    paintMeta(dl, info);
    paintActions(dl, info.kind);
    stage.replaceChildren();
    try { await draw(stage, dl, info, mine); }
    catch (err) {
      if (mine !== token || !ov) return;
      console.error('[QuickLook] could not draw the preview:', err);
      stage.replaceChildren(card(dl, info, { problem: fill(T('Could not show a preview: {1}'), plain(err)) }));
    }
  }

  function guessKind(name) {
    const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(name || ''));
    const e = m ? m[1].toLowerCase() : '';
    if (/^(exe|msi|bat|cmd|ps1|scr|lnk|jar|com|vbs|vbe|wsf|hta|reg|msp|msix|appx|dll|cpl)$/.test(e)) return 'program';
    if (/^(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/.test(e)) return 'image';
    if (e === 'pdf') return 'pdf';
    if (/^(mp3|wav|ogg|oga|m4a|flac|opus|aac)$/.test(e)) return 'audio';
    if (/^(mp4|webm|ogv|mov|m4v|mkv)$/.test(e)) return 'video';
    if (/^(zip|7z|rar)$/.test(e)) return 'archive';
    if (/^(docx|xlsx|pptx)$/.test(e)) return 'office';
    return 'other';
  }

  async function draw(stage, dl, info, mine) {
    if (info.tooBig) { stage.append(card(dl, info, { problem: fill(T('This file is too big to preview here. The limit is {1}.'), fmtBytes(info.tooBig)) })); return; }
    switch (info.kind) {
      case 'image': return drawImage(stage, info);
      case 'pdf': return drawPdf(stage, info, mine);
      case 'text': return drawText(stage, info);
      case 'audio': case 'video': return drawMedia(stage, info);
      case 'archive': return drawArchive(stage, dl, info);
      case 'office': return drawOffice(stage, dl, info);
      case 'program': stage.append(card(dl, info, { program: true })); return fillSignature(stage, dl, mine);
      default: stage.append(card(dl, info, { problem: info.note === 'binary' ? T('This file is not text, and Quick look has no picture of it.') : T('Quick look has no preview for this kind of file.') }));
    }
  }

  // ---- the footer ------------------------------------------------------------
  function paintMeta(dl, info) {
    const meta = ov.querySelector('.dlql-meta');
    const bit = (label, ...value) => h('span', { class: 'dlql-bit' }, h('span', { class: 'dlql-bit-k' }, label), ' ', h('span', { class: 'dlql-bit-v' }, ...value));
    const site = siteOf(dl.url);
    meta.replaceChildren(
      bit(T('Type'), h('span', null, KIND_NAME[info.kind] || KIND_NAME.other), info.ext ? ' (.' + info.ext + ')' : ''),
      bit(T('Size'), fmtBytes(info.size)),
      info.modified ? bit(T('Saved'), fmtDate(info.modified)) : null,
      site ? bit(T('From'), site) : null,
      h('span', { class: 'dlql-hash', 'aria-live': 'polite' }));
  }

  function paintActions(dl, kind) {
    const acts = ov.querySelector('.dlql-acts');
    const list = [];
    if (kind !== 'program') list.push(btn(T('Open'), 'external', () => openWithWindows(), { text: T('Open'), attrs: { 'data-act': 'open' } }));
    list.push(btn(T('Show in folder'), 'folder-open', () => window.vex.downloadsShowInFolder?.(dl.path), { text: T('Show in folder'), attrs: { 'data-act': 'folder' } }));
    list.push(btn(T('Copy path'), 'copy', () => copyPath(dl), { text: T('Copy path'), attrs: { 'data-act': 'copy-path' } }));
    list.push(btn(T('SHA-256 hash'), 'hash', () => makeHash(dl), { text: T('SHA-256 hash'), attrs: { 'data-act': 'hash' } }));
    list.push(btn(T('Delete to Recycle Bin'), 'trash', () => deleteIt(dl), { text: T('Delete'), class: 'dlql-danger', attrs: { 'data-act': 'delete' } }));
    acts.replaceChildren(...list);
  }

  async function copyPath(dl) {
    try { await navigator.clipboard.writeText(dl.path); window.showToast?.(T('Path copied')); }
    catch (err) { window.showToast?.(fill(T('Could not copy the path: {1}'), plain(err)), 'error'); }
  }

  async function makeHash(dl) {
    const slot = ov.querySelector('.dlql-hash');
    const b = ov.querySelector('[data-act="hash"]');
    slot.replaceChildren(h('span', { class: 'dlql-bit-k' }, T('SHA-256 hash')), ' ', T('Working it out…'));
    if (b) b.disabled = true;
    const mine = token;
    let r;
    try { r = await window.vex.downloadsPeekHash(dl.path); } catch (err) { r = { ok: false, error: plain(err) }; }
    if (mine !== token || !ov) return;
    if (b) b.disabled = false;
    if (!r || !r.ok) { slot.replaceChildren(h('span', { class: 'dlql-bad' }, (r && r.error) || T('Could not work out the hash'))); return; }
    slot.replaceChildren(h('span', { class: 'dlql-bit-k' }, T('SHA-256 hash')), ' ', h('code', { class: 'dlql-code' }, r.sha256), ' ',
      btn(T('Copy the hash'), 'copy', async () => { try { await navigator.clipboard.writeText(r.sha256); window.showToast?.(T('Hash copied')); } catch (err) { window.showToast?.(plain(err), 'error'); } }));
  }

  async function deleteIt(dl) {
    // The panel's own confirmation and deletion (vexConfirm, to the Recycle Bin).
    await DownloadsPanel._deleteFile(dl.id);
    if (!ov) return;
    if (!dl.missing) return;                                // kept
    items = items.filter(d => d.id !== dl.id);
    if (!items.length) { close(); return; }
    index = Math.min(index, items.length - 1);
    show();
  }

  // ---- the file card ---------------------------------------------------------
  function card(dl, info, opt = {}) {
    const k = info.kind || 'other';
    const box = h('div', { class: 'dlql-cardbox' + (opt.program ? ' is-program' : '') },
      h('div', { class: 'dlql-bigicon', 'aria-hidden': 'true', html: icon(KIND_ICON[k] || 'file', 44) }),
      h('div', { class: 'dlql-cardname' }, dl.filename),
      h('div', { class: 'dlql-cardsub' }, h('span', null, KIND_NAME[k] || KIND_NAME.other), ' \u00b7 ' + fmtBytes(info.size)));
    if (opt.program) {
      box.append(
        h('p', { class: 'dlql-say' }, T('This is a program. Vex never runs a program from a preview; it can only show you where the file is.')),
        h('p', { class: 'dlql-sig', 'data-sig': '' }, T('Checking who signed it…')));
    }
    if (opt.problem) box.append(h('p', { class: 'dlql-say', role: 'note' }, opt.problem));
    const fc = dl.fileCheck;
    if (fc && Array.isArray(fc.findings)) {
      for (const f of fc.findings) box.append(h('div', { class: 'dlql-warn' + (f.level === 'high' ? ' is-high' : ''), role: 'note' }, h('b', null, f.level === 'high' ? T('Warning:') : T('Careful:')), ' ', String(f.text || '')));
    }
    return box;
  }

  // The signature and the verdict Vex already works out for any file (file:inspect). It reads the file, it never runs it.
  async function fillSignature(stage, dl, mine) {
    const slot = stage.querySelector('[data-sig]');
    if (!slot) return;
    let r;
    try { r = await window.vex.fileInspect(dl.path, dl.url || ''); } catch (err) { r = { ok: false, error: plain(err) }; }
    if (mine !== token || !ov || !slot.isConnected) return;
    if (!r || !r.ok) { slot.textContent = T('Who signed it could not be checked.'); return; }
    const lines = Array.isArray(r.lines) ? r.lines : [];
    const head = r.verdict === 'signed' ? T('Signed') : r.verdict === 'unsigned' ? T('Not signed') : T('Could not be checked');
    slot.replaceChildren(h('b', null, head), lines.length ? ' ' : '', lines.join(' '));
    slot.classList.toggle('is-bad', r.verdict !== 'signed');
  }

  // ---- picture ---------------------------------------------------------------
  function objectUrl(bytes, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    cleanup.push(() => URL.revokeObjectURL(url));
    return url;
  }

  async function drawImage(stage, info) {
    const url = objectUrl(info.bytes, info.mime);
    const view = h('div', { class: 'dlql-imgview', tabindex: '0', role: 'img', 'aria-label': ov.querySelector('.dlql-title').textContent });
    const img = h('img', { class: 'dlql-img', alt: '', draggable: 'false' });
    view.append(img);
    const pct = h('span', { class: 'dlql-zoomval', 'aria-live': 'off' }, '');
    const bar = h('div', { class: 'dlql-toolbar', role: 'toolbar', 'aria-label': T('Zoom') },
      btn(T('Zoom out'), 'minus', () => z.by(0.8)), pct, btn(T('Zoom in'), 'plus', () => z.by(1.25)),
      btn(T('Fit to window'), 'maximize', () => z.fit(), { text: T('Fit') }), btn(T('Actual size'), null, () => z.actual(), { text: '100%' }));
    stage.append(view, bar);
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(T('This picture could not be decoded'))); img.src = url; });
    const nw = img.naturalWidth || 512, nh = img.naturalHeight || 512;
    let s = 1, tx = 0, ty = 0;
    const apply = () => { img.style.width = nw + 'px'; img.style.height = nh + 'px'; img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; pct.textContent = Math.round(s * 100) + '%'; };
    const size = () => ({ w: view.clientWidth, h: view.clientHeight });
    const z = {
      fit() { const v = size(); s = Math.min(v.w / nw, v.h / nh, 1); tx = (v.w - nw * s) / 2; ty = (v.h - nh * s) / 2; apply(); },
      actual() { const v = size(); s = 1; tx = (v.w - nw) / 2; ty = (v.h - nh) / 2; apply(); },
      at(f, cx, cy) { const ns = Math.max(0.05, Math.min(16, s * f)); tx = cx - (cx - tx) * (ns / s); ty = cy - (cy - ty) * (ns / s); s = ns; apply(); },
      by(f) { const v = size(); z.at(f, v.w / 2, v.h / 2); },
    };
    cur.zoom = z;
    z.fit();
    view.addEventListener('wheel', (e) => { e.preventDefault(); const r = view.getBoundingClientRect(); z.at(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    let drag = null;
    view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, tx, ty }; view.setPointerCapture(e.pointerId); view.classList.add('is-drag'); });
    view.addEventListener('pointermove', (e) => { if (!drag) return; tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; apply(); });
    const end = () => { drag = null; view.classList.remove('is-drag'); };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
    view.addEventListener('dblclick', () => { (Math.abs(s - 1) < 0.01 ? z.fit : z.actual)(); });
    const ro = new ResizeObserver(() => { if (s <= Math.min(size().w / nw, size().h / nh, 1) + 0.001) z.fit(); });
    ro.observe(view);
    cleanup.push(() => ro.disconnect());
  }

  // ---- PDF -------------------------------------------------------------------
  async function drawPdf(stage, info, mine) {
    const lib = await import(new URL('vendor/runtime/pdf.mjs', window.location.href).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/runtime/pdf.worker.mjs', window.location.href).href;
    const task = lib.getDocument({ data: info.bytes, isEvalSupported: false, enableXfa: false });
    cleanup.push(() => { try { task.destroy(); } catch { /* vex-allow-empty-catch: destroying a loading task that already finished has nothing to report */ } });
    const doc = await task.promise;
    if (mine !== token || !ov) return;
    const scroller = h('div', { class: 'dlql-pdf', tabindex: '0', role: 'region', 'aria-label': T('PDF pages') });
    stage.append(scroller);
    const width = Math.max(240, Math.min(scroller.clientWidth - 40, 900));
    const dpr = window.devicePixelRatio || 1;
    const last = Math.min(doc.numPages, PDF_PAGES);
    for (let n = 1; n <= last; n++) {
      const page = await doc.getPage(n);
      if (mine !== token || !ov) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = h('canvas', { class: 'dlql-pdfpage', role: 'img', 'aria-label': fill(T('Page {1}'), n) });
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      canvas.style.width = Math.ceil(vp.width / dpr) + 'px'; canvas.style.height = Math.ceil(vp.height / dpr) + 'px';
      scroller.append(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
    scroller.append(h('div', { class: 'dlql-note' }, doc.numPages > last ? fill(T('Showing the first {1} pages of {2}'), last, doc.numPages) : (doc.numPages === 1 ? T('1 page') : fill(T('{1} pages'), doc.numPages))));
  }

  // ---- text, JSON, CSV, Markdown, log ----------------------------------------
  function drawText(stage, info) {
    const ext = info.ext;
    const wrap = h('div', { class: 'dlql-textwrap' });
    const note = info.truncated ? h('div', { class: 'dlql-note', role: 'note' }, T('Showing the first 200 KB of this file.')) : null;
    const pane = h('div', { class: 'dlql-text', tabindex: '0', role: 'region', 'aria-label': T('File contents') });
    wrap.append(pane);
    if (/^(md|markdown)$/.test(ext)) {
      const bar = h('div', { class: 'dlql-toolbar', role: 'toolbar' });
      const rendered = h('button', { type: 'button', class: 'dlql-btn is-on', 'aria-pressed': 'true' }, T('Rendered'));
      const source = h('button', { type: 'button', class: 'dlql-btn', 'aria-pressed': 'false' }, T('Source'));
      const set = (on) => { rendered.classList.toggle('is-on', on); source.classList.toggle('is-on', !on); rendered.setAttribute('aria-pressed', String(on)); source.setAttribute('aria-pressed', String(!on)); pane.replaceChildren(on ? markdown(info.text) : plainPre(info.text)); };
      rendered.onclick = () => set(true); source.onclick = () => set(false);
      bar.append(rendered, source);
      wrap.prepend(bar);
      set(true);
    } else if (ext === 'json') {
      pane.append(jsonView(info.text, info.truncated));
    } else if (ext === 'csv' || ext === 'tsv') {
      pane.append(csvTable(info.text, ext === 'tsv' ? '\t' : null));
    } else if (ext === 'log') {
      pane.append(logView(info.text));
    } else pane.append(plainPre(info.text));
    stage.append(wrap);
    if (note) stage.append(note);
  }

  const plainPre = (text) => h('pre', { class: 'dlql-pre' }, text);

  function jsonView(text, truncated) {
    let shown = text;
    if (!truncated) { try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { shown = text; } }
    const pre = h('pre', { class: 'dlql-pre' });
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let last = 0, m;
    while ((m = re.exec(shown)) !== null) {
      if (m.index > last) pre.append(shown.slice(last, m.index));
      const cls = m[1] ? (m[2] ? 'k' : 's') : m[3] ? 'l' : 'n';
      if (m[1] && m[2]) { pre.append(h('span', { class: 'dlql-j-k' }, m[1]), m[2]); }
      else pre.append(h('span', { class: 'dlql-j-' + cls }, m[0]));
      last = re.lastIndex;
    }
    if (last < shown.length) pre.append(shown.slice(last));
    return pre;
  }

  // RFC 4180-ish: quoted fields, doubled quotes, the delimiter picked from the first line.
  function parseCsv(text, delim) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const d = delim || ([',', ';', '\t'].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0]);
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length && rows.length <= CSV_ROWS; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && cell === '') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
      else cell += c;
    }
    if (rows.length <= CSV_ROWS && (cell !== '' || row.length)) { row.push(cell); rows.push(row); }
    return rows;
  }
  function csvTable(text, delim) {
    const rows = parseCsv(text, delim);
    if (!rows.length) return h('div', { class: 'dlql-note' }, T('Empty'));
    const cols = Math.min(CSV_COLS, Math.max(...rows.map(r => r.length)));
    const cut = (r) => Array.from({ length: cols }, (_, i) => r[i] || '');
    const table = h('table', { class: 'dlql-table' },
      h('thead', null, h('tr', null, cut(rows[0]).map(c => h('th', { scope: 'col' }, c)))),
      h('tbody', null, rows.slice(1, CSV_ROWS).map(r => h('tr', null, cut(r).map(c => h('td', null, c))))));
    const out = h('div', { class: 'dlql-tablewrap' }, table);
    if (rows.length > CSV_ROWS) out.append(h('div', { class: 'dlql-note' }, T('Showing the first 200 rows.')));
    return out;
  }

  function logView(text) {
    const pre = h('pre', { class: 'dlql-pre' });
    for (const line of text.split('\n')) {
      const cls = /\b(ERROR|FATAL|SEVERE|CRITICAL|Exception)\b/.test(line) ? 'dlql-l-err' : /\b(WARN|WARNING)\b/.test(line) ? 'dlql-l-warn' : '';
      pre.append(h('span', { class: cls }, line + '\n'));
    }
    return pre;
  }

  // Markdown, drawn node by node: no markup from the file ever reaches innerHTML.
  function inline(parent, text) {
    const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      if (m[1] != null) parent.append(h('code', { class: 'dlql-code' }, m[1]));
      else if (m[2] != null) parent.append(h('strong', null, m[2]));
      else if (m[3] != null) parent.append(h('em', null, m[3]));
      else parent.append(h('span', { class: 'dlql-link', title: m[5] }, m[4]));
      last = re.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  }
  function markdown(src) {
    const root = h('div', { class: 'dlql-md' });
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (/^```/.test(line)) {
        const body = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        i++;
        root.append(h('pre', { class: 'dlql-pre' }, body.join('\n')));
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        const hd = h('div', { class: 'dlql-md-h dlql-md-h' + m[1].length, role: 'heading', 'aria-level': String(m[1].length) });
        inline(hd, m[2]); root.append(hd); i++;
      } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const list = h(ordered ? 'ol' : 'ul');
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) { const li = h('li'); inline(li, lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '')); list.append(li); i++; }
        root.append(list);
      } else if (/^>\s?/.test(line)) {
        const q = h('blockquote');
        const parts = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) parts.push(lines[i++].replace(/^>\s?/, ''));
        inline(q, parts.join(' ')); root.append(q);
      } else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { root.append(h('hr')); i++; }
      else if (!line.trim()) i++;
      else {
        const parts = [];
        while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>\s?|\s*([-*+]|\d+\.)\s+)/.test(lines[i])) parts.push(lines[i++]);
        const p = h('p'); inline(p, parts.join(' ')); root.append(p);
      }
    }
    return root;
  }

  // ---- audio and video -------------------------------------------------------
  function mmss(t) { if (!Number.isFinite(t)) return '0:00'; const s = Math.floor(t); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  async function drawMedia(stage, info) {
    const url = objectUrl(info.bytes, info.mime);
    const isVideo = info.kind === 'video';
    const media = h(isVideo ? 'video' : 'audio', { class: 'dlql-media', preload: 'metadata', playsinline: true });
    media.volume = 0.25;                                         // quiet by default: a preview must never startle
    const screen = h('div', { class: 'dlql-screen' }, isVideo ? media : [h('div', { class: 'dlql-bigicon', 'aria-hidden': 'true', html: icon('headphones', 44) }), media]);
    const play = btn(T('Play'), 'play', () => (media.paused ? media.play().catch(err => window.showToast?.(fill(T('Could not play it: {1}'), plain(err)), 'error')) : media.pause()), { attrs: { 'data-act': 'play' } });
    const seek = h('input', { type: 'range', class: 'dlql-range', min: '0', max: '1000', value: '0', 'aria-label': T('Position') });
    const time = h('span', { class: 'dlql-time' }, '0:00 / 0:00');
    const vol = h('input', { type: 'range', class: 'dlql-range dlql-vol', min: '0', max: '100', value: '25', 'aria-label': T('Volume') });
    stage.append(screen, h('div', { class: 'dlql-player', role: 'group', 'aria-label': T('Player') }, play, seek, time, h('span', { class: 'dlql-ic', 'aria-hidden': 'true', html: icon('volume', 16) }), vol));
    const paint = () => { play.innerHTML = ''; play.append(h('span', { class: 'dlql-ic', 'aria-hidden': 'true', html: icon(media.paused ? 'play' : 'pause', 16) })); const l = media.paused ? T('Play') : T('Pause'); play.title = l; play.setAttribute('aria-label', l); window.VexI18nUI?.apply?.(play); };
    media.addEventListener('play', paint); media.addEventListener('pause', paint); media.addEventListener('ended', paint);
    media.addEventListener('timeupdate', () => { if (!seeking && media.duration) seek.value = String(Math.round(media.currentTime / media.duration * 1000)); time.textContent = mmss(media.currentTime) + ' / ' + mmss(media.duration); });
    media.addEventListener('loadedmetadata', () => { time.textContent = '0:00 / ' + mmss(media.duration); });
    media.addEventListener('error', () => { stage.append(h('div', { class: 'dlql-note', role: 'alert' }, T('This file could not be played here.'))); });
    let seeking = false;
    seek.addEventListener('input', () => { seeking = true; if (media.duration) media.currentTime = Number(seek.value) / 1000 * media.duration; });
    seek.addEventListener('change', () => { seeking = false; });
    vol.addEventListener('input', () => { media.volume = Number(vol.value) / 100; });
    if (isVideo) media.addEventListener('click', () => (media.paused ? media.play().catch(err => window.showToast?.(fill(T('Could not play it: {1}'), plain(err)), 'error')) : media.pause()));
    media.src = url;
    cleanup.push(() => { media.pause(); media.removeAttribute('src'); media.load(); });
    paint();
  }

  // ---- archives and Office files ---------------------------------------------
  function drawArchive(stage, dl, info) {
    if (info.listError) { stage.append(card(dl, info, { problem: fill(T('This archive could not be read: {1}'), info.listError) })); return; }
    if (!info.entries) { stage.append(card(dl, info, { problem: T('Quick look cannot list this archive.') })); return; }
    const files = info.entries;
    const head = h('div', { class: 'dlql-note' }, (info.count === 1 ? T('1 item inside') : fill(T('{1} items inside'), info.count)));
    const rows = files.map(e => h('tr', null,
      h('td', { class: 'dlql-ent' }, h('span', { class: 'dlql-ic', 'aria-hidden': 'true', html: icon(e.dir ? 'folder' : 'file', 14) }), ' ', e.name),
      h('td', { class: 'dlql-num' }, e.dir ? '' : fmtBytes(e.size))));
    const table = h('table', { class: 'dlql-table' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, T('Name')), h('th', { scope: 'col', class: 'dlql-num' }, T('Size')))), h('tbody', null, rows));
    stage.append(head, h('div', { class: 'dlql-tablewrap', tabindex: '0', role: 'region', 'aria-label': T('Archive contents') }, table));
    if (info.truncated) stage.append(h('div', { class: 'dlql-note' }, T('Showing the first 200 items.')));
  }

  function drawOffice(stage, dl, info) {
    if (info.listError || !info.text) { stage.append(card(dl, info, { problem: info.listError ? fill(T('This document could not be read: {1}'), info.listError) : T('This document has no text Vex can read.') })); return; }
    stage.append(
      h('div', { class: 'dlql-text', tabindex: '0', role: 'region', 'aria-label': T('File contents') }, plainPre(info.text)),
      h('div', { class: 'dlql-note', role: 'note' }, info.truncated ? T('The first part of the text only. The layout of the document is not shown.') : T('Text only. The layout of the document is not shown.')));
  }

  // ---- right-click menu ------------------------------------------------------
  function menu(x, y, dl) {
    closeMenu();
    const item = (label, run, key) => h('button', { type: 'button', role: 'menuitem', class: 'dlql-mi', 'data-mi': key, onclick: () => { closeMenu(); run(); } }, label);
    const prog = guessKind(dl.filename) === 'program';
    const els = [item(T('Quick look'), () => open(dl.id), 'look')];
    if (!prog) els.push(item(T('Open'), () => DownloadsPanel.openChecked(dl), 'open'));
    els.push(item(T('Show in folder'), () => window.vex.downloadsShowInFolder?.(dl.path), 'folder'), item(T('Copy path'), () => copyPath(dl), 'copy'));
    menuEl = h('div', { class: 'dlql-menu', role: 'menu', 'aria-label': T('Download actions') }, els);
    menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - 200)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - 40 * els.length - 8)) + 'px';
    menuEl.addEventListener('keydown', (e) => {
      const all = [...menuEl.querySelectorAll('[role="menuitem"]')], at = all.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); const row = DownloadsPanel._rowFor(dl.id); closeMenu(); row?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); all[(at + 1) % all.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); all[(at - 1 + all.length) % all.length].focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); closeMenu(); }
    });
    (document.getElementById('panel-downloads') || document.body).appendChild(menuEl);
    window.VexI18nUI?.apply?.(menuEl);
    all0(menuEl)[0].focus();
    setTimeout(() => { document.addEventListener('pointerdown', outside, true); }, 0);
  }
  const all0 = (el) => [...el.querySelectorAll('[role="menuitem"]')];
  function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function closeMenu() { document.removeEventListener('pointerdown', outside, true); if (menuEl) { menuEl.remove(); menuEl = null; } }

  return { open, close, step, menu, closeMenu, isOpen: () => !!ov, previewable, parseCsv, markdown, jsonView, guessKind, _state: () => ({ index, count: items.length, cur }) };
})();

if (typeof window !== 'undefined') window.VexQuickLook = VexQuickLook;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexQuickLook };
