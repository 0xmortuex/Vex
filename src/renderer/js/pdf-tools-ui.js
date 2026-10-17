// === PDF toolkit: merge, split, extract, rotate (all on this computer) ==========
//
// T3-117, the smallest solid part of it. Ctrl+K › PDF toolkit opens a box:
// choose one or more PDFs with the system file picker, pick what to do, and the
// result is saved where you choose. The work is done in the main process by
// pdf-lib (src/main/pdf-toolkit.js): no network, no upload, no shell, and the
// original files are never changed or replaced.
//
//   Merge            two or more PDFs into one, in the order listed here
//   Extract / reorder  keep these pages, in this order ("3, 1, 2" reorders; "1-5" cuts the rest)
//   Split            one file per page, every N pages, or by ranges ("1-3; 4-6; 7-")
//   Rotate           pages 90, 180 or 270 degrees clockwise
//
// Page lists work like the print box: 1-3, 5, 8-   and   all, odd, even, reverse.
//
//   Mark up          text, a highlight or a box placed on a page (click or drag on the page outline)
//   Fill a form      type into the form fields the PDF has; optionally bake the answers in
//   Sign             place the picture of a drawn or typed signature. NOT a digital signature: it is a stamp
//   Compress         repack the file; pictures inside are not re-encoded, so a scan stays about as big
//
// Not here, on purpose: OCR, a cryptographic digital signature and opening a password-protected PDF. The
// window never names a path: main hands out tokens from its own file picker. The total-bytes cap stays.

const VexPdfTools = {
  PREF: 'vex.pdfTools.prefs',          // { enabled }
  FEATURE: 'pdf-tools',

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[PdfTools]', err.message); return false; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return !!on;
  },

  OPS: [
    { id: 'merge', label: 'Merge', needs: 'two or more PDFs' },
    { id: 'extract', label: 'Extract or reorder pages', needs: 'one PDF' },
    { id: 'split', label: 'Split', needs: 'one PDF' },
    { id: 'rotate', label: 'Rotate pages', needs: 'one PDF' },
    { id: 'annotate', label: 'Mark up: text, highlight, box', needs: 'one PDF' },
    { id: 'fill', label: 'Fill a form', needs: 'one PDF with form fields' },
    { id: 'sign', label: 'Place a signature picture', needs: 'one PDF' },
    { id: 'compress', label: 'Compress (repack)', needs: 'one PDF' },
  ],
  KINDS: ['text', 'highlight', 'rect'],
  COLORS: ['black', 'red', 'blue', 'green', 'yellow', 'orange'],

  // ---- pure: one mark from the form --------------------------------------------------------------------
  // f: { kind, page, x, y, w, h, text, size, color } with x, y, w, h in PERCENT of the page. -> the mark main wants (fractions).
  markFromForm(f, pageCount) {
    const kind = f.kind;
    if (!['text', 'highlight', 'rect', 'signature'].includes(kind)) throw new Error('Pick text, a highlight, a box or a signature');
    const page = Math.round(Number(f.page));
    if (!(page >= 1 && page <= pageCount)) throw new Error('Pick a page from 1 to ' + pageCount);
    const pc = (v, name) => { const n = Number(v); if (!(Number.isFinite(n) && n >= 0 && n <= 100)) throw new Error(name + ' is a percentage from 0 to 100'); return n / 100; };
    const m = { kind, page, x: pc(f.x, 'Left'), y: pc(f.y, 'Top') };
    const wanted = kind !== 'text' || String(f.w || '').trim() !== '';
    if (wanted) { m.w = pc(f.w, 'Width'); if (!(m.w > 0) || m.x + m.w > 1.0001) throw new Error('The mark is wider than the page'); }
    if (kind === 'highlight' || kind === 'rect') { m.h = pc(f.h, 'Height'); if (!(m.h > 0) || m.y + m.h > 1.0001) throw new Error('The mark is taller than the page'); }
    if (kind === 'text') {
      const text = String(f.text || '').trim();
      if (!text) throw new Error('Type the text to place');
      if (text.length > 500) throw new Error('Keep a text to 500 letters');
      m.text = text;
      const size = Number(f.size || 12);
      if (!(size >= 6 && size <= 72)) throw new Error('The text size is 6 to 72');
      m.size = size;
    }
    if (kind !== 'signature' && f.color) { if (!this.COLORS.includes(f.color)) throw new Error('Pick one of the listed colours'); m.color = f.color; }
    return m;
  },

  // ---- pure: the request for main --------------------------------------------------------------
  // files: [{ token, name, pages }], form: { op, spec, degrees, mode, n }. Throws a plain sentence.
  buildRequest(files, form) {
    const f = form || {};
    if (!this.OPS.some(o => o.id === f.op)) throw new Error('Pick what to do first');
    const list = Array.isArray(files) ? files : [];
    if (f.op === 'merge') {
      if (list.length < 2) throw new Error('Choose at least two PDFs to merge');
      return { op: 'merge', tokens: list.map(x => x.token) };
    }
    if (list.length !== 1) throw new Error('This works on one PDF at a time. Remove the others from the list');
    const tokens = [list[0].token];
    if (f.op === 'extract') {
      if (!String(f.spec || '').trim()) throw new Error('Say which pages to keep, for example 1-3, 5, 8-');
      return { op: 'extract', tokens, spec: String(f.spec).trim() };
    }
    if (f.op === 'rotate') {
      const degrees = Number(f.degrees);
      if (![90, 180, 270].includes(degrees)) throw new Error('Pick how far to turn the pages');
      return { op: 'rotate', tokens, degrees, spec: String(f.spec || '').trim() || 'all' };
    }
    if (f.op === 'compress') return { op: 'compress', tokens };
    if (f.op === 'annotate' || f.op === 'sign') {
      const items = Array.isArray(f.items) ? f.items : [];
      if (!items.length) throw new Error(f.op === 'sign' ? 'Place the signature on a page first' : 'Add at least one mark first');
      const req = { op: 'annotate', tokens, items };
      if (f.op === 'sign' || items.some(i => i.kind === 'signature')) {
        if (!(f.signature instanceof Uint8Array) || !f.signature.length) throw new Error('Draw or type a signature first');
        req.signature = f.signature;
      }
      if (f.ascii) req.ascii = true;
      return req;
    }
    if (f.op === 'fill') {
      const values = f.values && typeof f.values === 'object' ? f.values : {};
      if (!Object.keys(values).length) throw new Error('Type an answer into at least one field');
      return { op: 'fill', tokens, values, ...(f.flatten ? { flatten: true } : {}), ...(f.ascii ? { ascii: true } : {}) };
    }
    if (!['each', 'every', 'ranges'].includes(f.mode)) throw new Error('Pick how to split it');
    if (f.mode === 'every') {
      const n = Number(f.n);
      if (!Number.isInteger(n) || n < 1) throw new Error('Say how many pages go in each part');
      return { op: 'split', tokens, mode: 'every', n };
    }
    if (f.mode === 'ranges') {
      if (!String(f.spec || '').trim()) throw new Error('Write the parts, for example 1-3; 4-6; 7-');
      return { op: 'split', tokens, mode: 'ranges', spec: String(f.spec).trim() };
    }
    return { op: 'split', tokens, mode: 'each' };
  },

  _size(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; },

  // ---- main calls ---------------------------------------------------------------------------------
  async pick() {
    if (!window.vex || typeof window.vex.pdftoolPickFiles !== 'function') throw new Error('The PDF toolkit is not available here');
    const r = await window.vex.pdftoolPickFiles();
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not choose PDFs');
    return r;
  },
  async inspect(token) {
    if (!window.vex || typeof window.vex.pdftoolInspect !== 'function') throw new Error('The PDF toolkit is not available here');
    const r = await window.vex.pdftoolInspect(token);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The PDF could not be read');
    return r;
  },

  // ---- a signature picture (a drawn or typed one, as a PNG) -------------------------------------------------
  // Typed: the name in a script font on a transparent canvas. Drawn: the pointer strokes on a pad. Either way
  // the result is just a picture, kept in this window until you close it.
  signatureFromText(text) {
    const t = String(text || '').trim();
    if (!t) throw new Error('Type your name first');
    if (t.length > 60) throw new Error('Keep the signature to 60 letters');
    const c = document.createElement('canvas');
    c.width = 640; c.height = 180;
    const g = c.getContext('2d');
    if (!g) throw new Error('A drawing surface could not be made');
    g.fillStyle = '#10204a';
    g.font = 'italic 84px "Segoe Script", "Brush Script MT", cursive';
    g.textBaseline = 'middle';
    g.fillText(t, 20, 90, 600);
    return this._png(c);
  },
  async _png(canvas) {
    const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The signature could not be saved as a picture'))), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  },
  signaturePad(onUse) {
    const wrap = document.createElement('div');
    const c = document.createElement('canvas');
    c.width = 480; c.height = 150;
    c.style.cssText = 'width:100%;max-width:480px;border:1px dashed var(--border);border-radius:8px;touch-action:none;background:#fff';
    c.setAttribute('aria-label', 'Draw your signature here');
    const g = c.getContext('2d');
    let down = false, any = false;
    if (g) { g.lineWidth = 3; g.lineCap = 'round'; g.strokeStyle = '#10204a'; }
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.addEventListener('pointerdown', (e) => { down = true; any = true; const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); c.setPointerCapture?.(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (!down) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); });
    for (const ev of ['pointerup', 'pointercancel']) c.addEventListener(ev, () => { down = false; });
    const clear = VexSettingsGroups.button('Clear', () => { g.clearRect(0, 0, c.width, c.height); any = false; });
    const use = VexSettingsGroups.button('Use this signature', async () => { try { if (!any) throw new Error('Draw your signature first'); onUse(await this._png(c)); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true });
    wrap.append(c, clear, use);
    return wrap;
  },

  async run(request) {
    if (!window.vex || typeof window.vex.pdftoolRun !== 'function') throw new Error('The PDF toolkit is not available here');
    const r = await window.vex.pdftoolRun(request);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The PDF tool failed');
    return r;
  },

  // ---- the box ---------------------------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('The PDF toolkit is switched off in Settings', 'info'); return null; }
    const { body } = VexSettingsGroups.dialog({ id: 'vex-pdf-tools', title: 'PDF toolkit', sub: 'Merge, split, extract and rotate. Works on copies: your original files are never changed.' });
    let files = [];
    const form = { op: 'merge', spec: '', degrees: '90', mode: 'each', n: '2', items: [], values: {}, flatten: false, ascii: false, signature: null, info: null, mark: { kind: 'text', page: '1', x: '10', y: '10', w: '', h: '', text: '', size: '12', color: 'black' } };
    const draw = () => {
      body.textContent = '';
      body.appendChild(VexSettingsGroups.button('Choose PDFs', async () => {
        try {
          await window.vex.pdftoolForget();
          const r = await this.pick();
          if (r.cancelled) return;
          files = r.files;
          if (r.problems && r.problems.length) window.showToast?.(r.problems.join(' '), 'warn', 8000);
          form.op = files.length > 1 ? 'merge' : (form.op === 'merge' ? 'extract' : form.op);
          draw();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: true }));
      if (!files.length) { body.appendChild(VexSettingsGroups.note('Choose the PDFs to work on. Password-protected PDFs are refused: remove the password in the program that made them first.')); return; }
      const list = document.createElement('div');
      list.className = 'vexsr-list';
      files.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = (i + 1) + '. ' + f.name + '  (' + f.pages + ' page' + (f.pages === 1 ? '' : 's') + ', ' + this._size(f.bytes) + ')';
        row.appendChild(text);
        if (i > 0) row.appendChild(VexSettingsGroups.button('Up', () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); }, { label: 'Move ' + f.name + ' up' }));
        if (i < files.length - 1) row.appendChild(VexSettingsGroups.button('Down', () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; draw(); }, { label: 'Move ' + f.name + ' down' }));
        row.appendChild(VexSettingsGroups.button('Remove', () => { files = files.filter(x => x !== f); draw(); }, { danger: true, label: 'Remove ' + f.name + ' from the list' }));
        list.appendChild(row);
      });
      body.appendChild(list);

      const opSel = document.createElement('select');
      opSel.className = 'vexsr-input';
      opSel.setAttribute('aria-label', 'What to do');
      for (const o of this.OPS) { const opt = document.createElement('option'); opt.value = o.id; opt.textContent = o.label + ' (' + o.needs + ')'; opt.selected = o.id === form.op; opSel.appendChild(opt); }
      opSel.addEventListener('change', () => { form.op = opSel.value; draw(); });
      body.appendChild(opSel);

      const field = (label, el) => { const w = document.createElement('label'); w.style.cssText = 'display:block;margin:8px 0 0;font-size:11.5px;color:var(--text-muted)'; w.append(label + ' ', el); body.appendChild(w); return el; };
      const text = (key, placeholder) => { const i = document.createElement('input'); i.type = 'text'; i.className = 'vexsr-input'; i.placeholder = placeholder; i.value = form[key] || ''; i.setAttribute('aria-label', placeholder); i.addEventListener('input', () => { form[key] = i.value; }); return i; };
      if (form.op === 'extract') field('Pages to keep, in order', text('spec', '1-3, 5, 8-  (or 3, 1, 2 to reorder)'));
      if (form.op === 'rotate') {
        const deg = document.createElement('select');
        deg.className = 'vexsr-input';
        deg.setAttribute('aria-label', 'Degrees clockwise');
        for (const d of ['90', '180', '270']) { const o = document.createElement('option'); o.value = d; o.textContent = d + ' degrees clockwise'; o.selected = d === form.degrees; deg.appendChild(o); }
        deg.addEventListener('change', () => { form.degrees = deg.value; });
        field('Turn', deg);
        field('Pages (empty is all)', text('spec', 'all, odd, even, or 1-3, 5'));
      }
      if (form.op === 'split') {
        const mode = document.createElement('select');
        mode.className = 'vexsr-input';
        mode.setAttribute('aria-label', 'How to split');
        for (const [v, l] of [['each', 'One file per page'], ['every', 'Every N pages'], ['ranges', 'By page ranges']]) { const o = document.createElement('option'); o.value = v; o.textContent = l; o.selected = v === form.mode; mode.appendChild(o); }
        mode.addEventListener('change', () => { form.mode = mode.value; draw(); });
        field('Split', mode);
        if (form.mode === 'every') field('Pages per part', text('n', 'Pages per part'));
        if (form.mode === 'ranges') field('Parts, separated by semicolons', text('spec', '1-3; 4-6; 7-'));
      }
      if (['annotate', 'sign', 'fill'].includes(form.op)) this._markupParts(body, files, form, draw);
      body.appendChild(VexSettingsGroups.button('Make the new PDF', async () => {
        try {
          const req = this.buildRequest(files, form);
          const r = await this.run(req);
          if (r.cancelled) return;
          if (r.files[0] && r.files[0].before) window.showToast?.('From ' + this._size(r.files[0].before) + ' to ' + this._size(r.files[0].bytes), 'info', 8000);
          if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
          const first = r.files[0];
          window.showToast?.(r.files.length === 1 ? 'Saved ' + first.name + ' (' + first.pages + ' page' + (first.pages === 1 ? '' : 's') + ')' : 'Saved ' + r.files.length + ' PDFs', 'success', 8000,
            window.vex && window.vex.downloadsShowInFolder ? { action: { label: 'Show in folder', run: () => window.vex.downloadsShowInFolder(first.path) } } : undefined);
        } catch (err) { window.showToast?.(err.message, 'error', 7000); }
      }, { primary: true }));
    };
    draw();
    return body;
  },

  // ---- the parts for mark up, sign and fill (they need to know the pages and the form fields) -------------------
  _markupParts(body, files, form, draw) {
    const G = VexSettingsGroups;
    const note = (t) => body.appendChild(G.note(t));
    if (files.length !== 1) { note('Choose exactly one PDF for this.'); return; }
    if (!form.info || form.info.token !== files[0].token) {
      note('Reading the PDF...');
      this.inspect(files[0].token).then((info) => { form.info = { ...info, token: files[0].token }; form.items = []; form.values = {}; draw(); }, (err) => window.showToast?.(err.message, 'error'));
      return;
    }
    const info = form.info;
    const field = (label, el) => { const w = document.createElement('label'); w.style.cssText = 'display:block;margin:8px 0 0;font-size:11.5px;color:var(--text-muted)'; w.append(label + ' ', el); body.appendChild(w); return el; };
    const input = (obj, key, aria, type = 'text') => { const i = document.createElement('input'); i.type = type; i.className = 'vexsr-input'; i.value = obj[key] == null ? '' : obj[key]; i.setAttribute('aria-label', aria); i.addEventListener('input', () => { obj[key] = i.value; }); return i; };
    const ascii = () => {
      const row = document.createElement('label'); row.className = 'vexsr-rule';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = form.ascii; cb.addEventListener('change', () => { form.ascii = cb.checked; });
      row.append(cb, document.createTextNode(' Replace letters the PDF font cannot draw (s-cedilla, g-breve, dotless i become s, g, i)'));
      body.appendChild(row);
    };
    if (form.op === 'fill') {
      if (!info.fields.length) { note('This PDF has no form fields to fill.'); return; }
      for (const f of info.fields) {
        if (f.type === 'checkbox') {
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = f.name in form.values ? !!form.values[f.name] : !!f.value;
          cb.addEventListener('change', () => { form.values[f.name] = cb.checked; });
          field(f.name, cb);
        } else if (f.type === 'dropdown' || f.type === 'radio' || f.type === 'list') {
          const s = document.createElement('select'); s.className = 'vexsr-input'; s.setAttribute('aria-label', f.name);
          const none = document.createElement('option'); none.value = ''; none.textContent = '(leave as it is)'; s.appendChild(none);
          for (const o of f.options || []) { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; s.appendChild(opt); }
          s.addEventListener('change', () => { if (s.value) form.values[f.name] = s.value; else delete form.values[f.name]; });
          field(f.name, s);
        } else if (f.type === 'text') {
          const i = document.createElement('input'); i.type = 'text'; i.className = 'vexsr-input'; i.value = f.name in form.values ? form.values[f.name] : f.value; i.setAttribute('aria-label', f.name);
          i.addEventListener('input', () => { if (i.value !== f.value) form.values[f.name] = i.value; else delete form.values[f.name]; });
          field(f.name, i);
        }
      }
      const flat = document.createElement('label'); flat.className = 'vexsr-rule';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = form.flatten; cb.addEventListener('change', () => { form.flatten = cb.checked; });
      flat.append(cb, document.createTextNode(' Bake the answers in (they can no longer be edited)'));
      body.append(flat);
      ascii();
      return;
    }
    // annotate and sign
    const signing = form.op === 'sign';
    if (signing) {
      if (!form.signature) {
        note('First make the signature picture. This is a stamp of your name or your drawing, not a digital signature: it proves nothing about who placed it.');
        const typed = document.createElement('input'); typed.type = 'text'; typed.className = 'vexsr-input'; typed.maxLength = 60; typed.placeholder = 'Type your name'; typed.setAttribute('aria-label', 'Your name as a signature');
        body.append(typed, G.button('Use the typed name', async () => { try { form.signature = await this.signatureFromText(typed.value); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
        body.appendChild(this.signaturePad((png) => { form.signature = png; draw(); }));
        return;
      }
      body.appendChild(G.button('Make another signature', () => { form.signature = null; form.items = form.items.filter(i => i.kind !== 'signature'); draw(); }));
    }
    const m = form.mark;
    m.kind = signing ? 'signature' : (m.kind === 'signature' ? 'text' : m.kind);
    if (!signing) {
      const k = document.createElement('select'); k.className = 'vexsr-input'; k.setAttribute('aria-label', 'Kind of mark');
      for (const [v, l] of [['text', 'Text'], ['highlight', 'Highlight'], ['rect', 'Box']]) { const o = document.createElement('option'); o.value = v; o.textContent = l; o.selected = v === m.kind; k.appendChild(o); }
      k.addEventListener('change', () => { m.kind = k.value; draw(); });
      field('Mark', k);
      if (m.kind === 'text') { field('Text', input(m, 'text', 'Text to place')); field('Size', input(m, 'size', 'Text size', 'number')); }
      const c = document.createElement('select'); c.className = 'vexsr-input'; c.setAttribute('aria-label', 'Colour');
      for (const col of this.COLORS) { const o = document.createElement('option'); o.value = col; o.textContent = col; o.selected = col === m.color; c.appendChild(o); }
      c.addEventListener('change', () => { m.color = c.value; });
      field('Colour', c);
    }
    field('Page (1 to ' + info.pages.length + ')', input(m, 'page', 'Page', 'number'));
    // The page outline: click for the top-left corner, or drag to also set the width and height.
    const pg = info.pages[Math.max(0, Math.min(info.pages.length - 1, (Number(m.page) || 1) - 1))];
    const outline = document.createElement('div');
    outline.style.cssText = 'position:relative;width:220px;aspect-ratio:' + pg.w + ' / ' + pg.h + ';border:1px solid var(--border);background:var(--surface);margin:8px 0;cursor:crosshair;touch-action:none';
    outline.setAttribute('role', 'img'); outline.setAttribute('aria-label', 'Outline of page ' + (m.page || 1) + '. Click to place the top left corner; the boxes below hold the exact numbers.');
    const marker = document.createElement('div'); marker.style.cssText = 'position:absolute;border:2px solid var(--primary);pointer-events:none';
    outline.appendChild(marker);
    const paint = () => { marker.style.left = (Number(m.x) || 0) + '%'; marker.style.top = (Number(m.y) || 0) + '%'; marker.style.width = (Number(m.w) || 2) + '%'; marker.style.height = (Number(m.h) || 2) + '%'; };
    let start = null;
    const rel = (e) => { const r = outline.getBoundingClientRect(); return [Math.max(0, Math.min(100, (e.clientX - r.left) * 100 / r.width)), Math.max(0, Math.min(100, (e.clientY - r.top) * 100 / r.height))]; };
    outline.addEventListener('pointerdown', (e) => { start = rel(e); m.x = start[0].toFixed(1); m.y = start[1].toFixed(1); m.w = ''; m.h = ''; outline.setPointerCapture?.(e.pointerId); paint(); });
    outline.addEventListener('pointerup', (e) => { if (!start) return; const [x, y] = rel(e); if (Math.abs(x - start[0]) > 1 && Math.abs(y - start[1]) > 1) { m.x = Math.min(x, start[0]).toFixed(1); m.y = Math.min(y, start[1]).toFixed(1); m.w = Math.abs(x - start[0]).toFixed(1); m.h = Math.abs(y - start[1]).toFixed(1); } start = null; draw(); });
    paint();
    body.appendChild(outline);
    const nums = document.createElement('div'); nums.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    for (const [key, label] of [['x', 'Left %'], ['y', 'Top %'], ['w', 'Width %'], ['h', 'Height %']]) { const i = input(m, key, label, 'number'); i.placeholder = label; i.style.width = '86px'; nums.appendChild(i); }
    body.appendChild(nums);
    body.appendChild(G.button(signing ? 'Place the signature here' : 'Add this mark', () => {
      try {
        if (signing && !String(m.w || '').trim()) m.w = '25';
        form.items.push(this.markFromForm({ ...m }, info.pages.length));
        if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
        draw();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    const list = document.createElement('div'); list.className = 'vexsr-list';
    form.items.forEach((it, i) => {
      const row = document.createElement('div'); row.className = 'vexsr-rule';
      const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal';
      t.textContent = (i + 1) + '. page ' + it.page + ': ' + it.kind + (it.text ? ' "' + it.text.slice(0, 40) + '"' : '');
      row.append(t, G.button('Remove', () => { form.items.splice(i, 1); draw(); }, { danger: true, label: 'Remove mark ' + (i + 1) }));
      list.appendChild(row);
    });
    body.appendChild(list);
    if (!signing) ascii();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Merge, split, extract or reorder, and rotate pages of PDF files, all on this computer with nothing uploaded. Your originals are never changed. Also fills forms, marks up pages, places a signature picture (not a digital signature) and repacks a file. Not included: OCR, and PDFs protected by a password.'));
    el.appendChild(VexSettingsGroups.button('Open the PDF toolkit', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexPdfTools = VexPdfTools;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'pdf-tools', title: 'PDF toolkit', keywords: 'pdf merge split extract rotate reorder pages combine local offline', before: 'about', build: (el) => VexPdfTools.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'pdf-toolkit', label: 'PDF toolkit', hint: 'Merge, split, extract and rotate PDF pages on this computer', icon: 'file', action: () => VexPdfTools.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPdfTools };
