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
// Not here, on purpose: filling forms, signing, compressing, OCR and opening a
// password-protected PDF (those need a different engine, or the password). The
// window never names a path: main hands out tokens from its own file picker.

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
    { id: 'shrink', label: 'Shrink pictures', needs: 'one PDF' },
  ],

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
    if (f.op === 'shrink') {
      const level = f.level || 'balanced';
      if (!['small', 'balanced', 'high'].includes(level)) throw new Error('Pick how small to make the pictures');
      return { op: 'shrink', tokens, level };
    }
    if (f.op === 'rotate') {
      const degrees = Number(f.degrees);
      if (![90, 180, 270].includes(degrees)) throw new Error('Pick how far to turn the pages');
      return { op: 'rotate', tokens, degrees, spec: String(f.spec || '').trim() || 'all' };
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
    const form = { op: 'merge', spec: '', degrees: '90', mode: 'each', n: '2' };
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
      if (form.op === 'shrink') {
        const lvl = document.createElement('select');
        lvl.className = 'vexsr-input';
        lvl.setAttribute('aria-label', 'Picture quality');
        for (const [v, l] of [['small', 'Smallest file (pictures up to 1200 px, quality 50)'], ['balanced', 'Balanced (1600 px, quality 70)'], ['high', 'Best quality (2400 px, quality 85)']]) { const o = document.createElement('option'); o.value = v; o.textContent = l; o.selected = v === (form.level || 'balanced'); lvl.appendChild(o); }
        lvl.addEventListener('change', () => { form.level = lvl.value; });
        field('Pictures', lvl);
        body.appendChild(VexSettingsGroups.note('Re-encodes photos and scans as JPEG and scales large ones down. Pictures that would not get at least 10% smaller are left alone.'));
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
      body.appendChild(VexSettingsGroups.button('Make the new PDF', async () => {
        try {
          const req = this.buildRequest(files, form);
          const r = await this.run(req);
          if (r.cancelled) return;
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

  group(el) {
    el.appendChild(VexSettingsGroups.note('Merge, split, extract or reorder, and rotate pages of PDF files, and shrink the pictures inside them, all on this computer with nothing uploaded. Your originals are never changed. Not included: filling forms, signing, OCR, and PDFs protected by a password.'));
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
