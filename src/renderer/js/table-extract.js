// === Table and list extraction (T2-061) ======================================
// vex-layer-exempt: drawn inside the guest page (injected script), pointer-events:none
//
// "Copy a table or list from this page…" (page right-click menu, or the command
// bar): point at a table, a list or a definition list, click it, and get it as CSV,
// Markdown or tab-separated text for a sheet, or as a note. Deterministic: it reads
// the page's own cells, nothing is guessed, nothing is sent anywhere, no AI.
//
// The picking runs INSIDE the page (vexTablePick's source is sent to it; it uses
// nothing from this file). It only reads, highlights what is under the pointer and
// waits for one click; Escape cancels and a minute without a click ends it. The
// page cannot see what was picked.
//
// A CSV cell that would be read as a formula by a spreadsheet (starts with = or @, or
// with + or - and then something that is not a number) gets a leading apostrophe.

function vexTablePick(timeoutMs) {
  return new Promise(function (resolve, reject) {
    var SEL = 'table, ul, ol, dl, [role="table"], [role="grid"], [role="treegrid"], [role="list"]';
    var box = document.createElement('div');
    box.setAttribute('data-vex-table-pick', '');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;background:rgba(76,141,255,0.15);border-radius:3px;display:none';
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:50%;top:10px;transform:translateX(-50%);background:#111;color:#fff;font:13px system-ui,sans-serif;padding:6px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    tip.textContent = 'Click a table or list to copy it. Escape cancels.';
    document.documentElement.appendChild(box);
    document.documentElement.appendChild(tip);
    var target = null;
    var timer = setTimeout(function () { done(null, new Error('Nothing was picked within a minute')); }, timeoutMs || 60000);
    function done(value, err) {
      clearTimeout(timer);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      box.remove(); tip.remove();
      if (err) reject(err); else resolve(value);
    }
    function pick(el) {
      var t = el && el.closest ? el.closest(SEL) : null;
      return t;
    }
    function onMove(e) {
      target = pick(e.target);
      if (!target) { box.style.display = 'none'; return; }
      var r = target.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
      box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    }
    function text(el) { return String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000); }
    function extract(t) {
      var rows = [], tag = t.tagName.toLowerCase(), caption = '';
      if (tag === 'table') {
        var cap = t.querySelector('caption');
        caption = cap ? text(cap) : '';
        var trs = t.rows;
        for (var i = 0; i < trs.length && rows.length < 5000; i++) {
          if (trs[i].closest('table') !== t) continue;
          var row = [];
          for (var j = 0; j < trs[i].cells.length; j++) {
            row.push(text(trs[i].cells[j]));
            var span = Math.min(parseInt(trs[i].cells[j].colSpan, 10) || 1, 50);
            for (var k = 1; k < span; k++) row.push('');
          }
          rows.push(row);
        }
        return { kind: 'table', caption: caption, rows: rows };
      }
      if (tag === 'dl') {
        var kids = t.children, term = '';
        for (var d = 0; d < kids.length && rows.length < 5000; d++) {
          var n = kids[d].tagName.toLowerCase();
          if (n === 'dt') term = text(kids[d]);
          else if (n === 'dd') { rows.push([term, text(kids[d])]); }
        }
        return { kind: 'list', caption: '', rows: rows };
      }
      if (tag === 'ul' || tag === 'ol') {
        var lis = t.children;
        for (var l = 0; l < lis.length && rows.length < 5000; l++) {
          if (lis[l].tagName.toLowerCase() !== 'li') continue;
          rows.push(tag === 'ol' ? [String(rows.length + 1), text(lis[l])] : [text(lis[l])]);
        }
        return { kind: 'list', caption: '', rows: rows };
      }
      // ARIA grid / table / list
      var rr = t.querySelectorAll('[role="row"], [role="listitem"]');
      for (var m = 0; m < rr.length && rows.length < 5000; m++) {
        var cells = rr[m].querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]');
        if (cells.length) { rows.push(Array.prototype.map.call(cells, text)); } else rows.push([text(rr[m])]);
      }
      return { kind: 'table', caption: '', rows: rows };
    }
    function onClick(e) {
      var t = pick(e.target) || target;
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      var out = extract(t);
      if (!out.rows.length) { done(null, new Error('That has no rows to copy')); return; }
      done(out, null);
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null, new Error('Cancelled')); } }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  });
}

const TableExtract = {
  PREF_KEY: 'vex.tableExtract.enabled',
  MAX_ROWS: 5000,

  enabled() { try { return localStorage.getItem(this.PREF_KEY) !== 'false'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },

  // ---- pure ------------------------------------------------------------------
  _guard(cell) {
    const s = String(cell == null ? '' : cell);
    return /^[=@\t\r]/.test(s) || /^[+-][^0-9.\s,]/.test(s) ? "'" + s : s;
  },
  _width(rows) { return rows.reduce((w, r) => Math.max(w, r.length), 0); },
  _pad(rows) { const w = this._width(rows); return rows.map(r => r.concat(Array(w - r.length).fill(''))); },
  toCsv(rows) {
    const q = (c) => { const s = this._guard(c); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return this._pad(rows).map(r => r.map(q).join(',')).join('\r\n');
  },
  toTsv(rows) {
    return this._pad(rows).map(r => r.map(c => this._guard(c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  },
  toMarkdown(rows) {
    const p = this._pad(rows);
    if (!p.length) return '';
    const esc = (c) => String(c).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
    const line = (r) => '| ' + r.map(esc).join(' | ') + ' |';
    const head = p[0];
    const sep = '| ' + head.map(() => '---').join(' | ') + ' |';
    return [line(head), sep, ...p.slice(1).map(line)].join('\n');
  },
  format(rows, how) {
    if (how === 'csv') return this.toCsv(rows);
    if (how === 'md') return this.toMarkdown(rows);
    if (how === 'tsv') return this.toTsv(rows);
    throw new Error('Unknown format ' + how);
  },
  // Rows come from a page: bound them again here.
  clean(result) {
    if (!result || !Array.isArray(result.rows)) throw new Error('The page returned no table');
    const rows = result.rows.slice(0, this.MAX_ROWS).map(r => (Array.isArray(r) ? r : []).slice(0, 200).map(c => String(c == null ? '' : c).slice(0, 2000)));
    return { kind: result.kind === 'list' ? 'list' : 'table', caption: String(result.caption || '').slice(0, 300), rows };
  },

  // ---- the page ----------------------------------------------------------------
  async pick(wv) {
    const policy = window.VexTabPolicy;
    if (!wv) throw new Error('Open a page first');
    if (policy && !policy.canReadWebview(wv)) throw new Error('Tables are not read from private, Tor or routed tabs');
    window.showToast?.('Click a table or list on the page. Escape cancels.');
    const result = await window.vexGuestEval(wv, '(' + vexTablePick.toString() + ')(60000)', true, 65000);
    const data = this.clean(result);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('table-extract');
    return this.show(data, wv);
  },

  async pickActive() {
    const wv = typeof WebviewManager !== 'undefined' && typeof TabManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    if (!wv) throw new Error('Open a page first');
    return this.pick(wv);
  },

  show(data, wv) {
    const { body, close } = window.PageExport._sheet('Table from this page', 'vex-tableextract-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const sub = document.createElement('div');
    sub.style.cssText = 'padding:8px 14px;font-size:11.5px;color:var(--text-muted)';
    const cols = this._width(data.rows);
    sub.textContent = data.rows.length + ' row' + (data.rows.length === 1 ? '' : 's') + ' by ' + cols + ' column' + (cols === 1 ? '' : 's') + (data.caption ? ' · ' + data.caption : '') + '. Read from the page; nothing leaves this computer.';
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;padding:10px 14px;font:12px ui-monospace,Consolas,monospace;color:var(--text);white-space:pre;overflow:auto;max-height:46vh';
    pre.textContent = this.toMarkdown(data.rows.slice(0, 30)) + (data.rows.length > 30 ? '\n… ' + (data.rows.length - 30) + ' more rows' : '');
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--border)';
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'padding:0 14px 10px;font-size:11.5px;color:var(--text-muted)';
    const copy = (label, how) => {
      const b = document.createElement('button');
      b.type = 'button'; b.style.cssText = btn; b.textContent = label;
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(this.format(data.rows, how)); status.textContent = 'Copied as ' + label.replace('Copy ', '') + '.'; }
        catch (err) { status.textContent = 'Could not copy: ' + ((err && err.message) || err); }
      });
      return b;
    };
    const note = document.createElement('button');
    note.type = 'button'; note.style.cssText = btn; note.textContent = 'Save as a note';
    note.addEventListener('click', () => {
      try {
        if (typeof AgentTools === 'undefined') throw new Error('Notes are not available');
        let title = 'Table'; try { title = (wv && wv.getTitle && wv.getTitle()) || title; } catch { /* vex-allow-empty-catch: a detached page; the note gets the plain title */ }
        AgentTools.saveNote(String(title).slice(0, 60) + ' (table)', this.toMarkdown(data.rows), undefined, { origin: 'page-tables' });
        status.textContent = 'Saved to Notes.';
      } catch (err) { status.textContent = err.message; }
    });
    bar.append(copy('Copy CSV', 'csv'), copy('Copy Markdown', 'md'), copy('Copy for a sheet (tabs)', 'tsv'), note);
    body.append(sub, pre, bar, status);
    return close;
  },
};

if (typeof window !== 'undefined') window.TableExtract = TableExtract;
if (typeof module !== 'undefined' && module.exports) module.exports = { TableExtract, vexTablePick };
