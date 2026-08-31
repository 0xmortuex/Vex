// === Vex Toolbox ===
// Small, self-contained tools built into Vex (no embedded external sites) that
// professions use every day. Jobs (job-profiles.js) pick a subset; the launcher
// shows the ones you've enabled. Pure logic lives in ToolboxLib (unit-tested);
// each tool's open() renders a modal that uses it.

const ToolboxLib = {
  // --- Base64 ---
  b64enc(s) { try { return btoa(unescape(encodeURIComponent(String(s)))); } catch { return ''; } },
  b64dec(s) { try { return decodeURIComponent(escape(atob(String(s).trim()))); } catch { return null; } },

  // --- Unix timestamp <-> date ---
  tsToDate(ts) {
    let n = Number(ts);
    if (!isFinite(n)) return null;
    if (String(Math.trunc(n)).length <= 10) n *= 1000; // seconds -> ms
    const d = new Date(n);
    return isNaN(d.getTime()) ? null : d;
  },
  dateToTs(str) { const d = new Date(str); return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000); },

  // --- UUID v4 (crypto if available) ---
  uuidv4() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch {}
    const b = new Uint8Array(16);
    (crypto && crypto.getRandomValues) ? crypto.getRandomValues(b) : b.forEach((_, i) => b[i] = Math.floor(Math.random() * 256));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0'));
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
  },

  // --- Word / character stats ---
  wordStats(text) {
    const t = String(text || '');
    const words = (t.trim().match(/\S+/g) || []).length;
    const chars = t.length;
    const charsNoSpace = t.replace(/\s/g, '').length;
    const lines = t === '' ? 0 : t.split(/\r\n|\r|\n/).length;
    const sentences = (t.match(/[.!?]+(\s|$)/g) || []).length;
    const paragraphs = (t.trim() ? t.trim().split(/\n\s*\n/).length : 0);
    const readingMin = Math.max(0, words / 200); // ~200 wpm
    return { words, chars, charsNoSpace, lines, sentences, paragraphs, readingMin };
  },

  // --- Color conversions + contrast ---
  hexToRgb(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  },
  rgbToHex(r, g, b) { const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'); return '#' + c(r) + c(g) + c(b); },
  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  },
  _lum(r, g, b) { const a = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; },
  contrast(hex1, hex2) {
    const a = this.hexToRgb(hex1), b = this.hexToRgb(hex2);
    if (!a || !b) return null;
    const l1 = this._lum(a.r, a.g, a.b), l2 = this._lum(b.r, b.g, b.b);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    return Math.round(ratio * 100) / 100;
  },

  // --- CSV -> rows (handles quoted fields, commas, escaped quotes) ---
  csvToRows(text) {
    const rows = []; let row = [], field = '', inQ = false;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  },

  // --- Cron (5-field) description + next runs ---
  cronDescribe(expr) {
    const p = String(expr || '').trim().split(/\s+/);
    if (p.length !== 5) return null;
    const [min, hr, dom, mon, dow] = p;
    const part = (f, unit, names) => {
      if (f === '*') return `every ${unit}`;
      let m;
      if ((m = f.match(/^\*\/(\d+)$/))) return `every ${m[1]} ${unit}s`;
      if (/^\d+$/.test(f)) return names ? names[+f % names.length] : `${unit} ${f}`;
      return `${unit}s ${f}`;
    };
    const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const bits = [];
    if (min === '*' && hr === '*') bits.push('every minute');
    else bits.push('at ' + (hr === '*' ? part(min, 'minute') : (min.padStart ? `${hr.padStart(2, '0')}:${min.padStart(2, '0')}` : `${hr}:${min}`)));
    if (dom !== '*') bits.push('on day ' + dom + ' of the month');
    if (mon !== '*') bits.push('in month ' + mon);
    if (dow !== '*') bits.push('on ' + part(dow, 'weekday', DOW));
    return bits.join(', ');
  },
  cronNext(expr, count = 5, from) {
    const p = String(expr || '').trim().split(/\s+/);
    if (p.length !== 5) return [];
    const match = (f, val, min, max) => {
      if (f === '*') return true;
      for (const seg of f.split(',')) {
        let m;
        if ((m = seg.match(/^\*\/(\d+)$/))) { if ((val - min) % (+m[1]) === 0) return true; }
        else if ((m = seg.match(/^(\d+)-(\d+)$/))) { if (val >= +m[1] && val <= +m[2]) return true; }
        else if (/^\d+$/.test(seg)) { if (val === +seg) return true; }
      }
      return false;
    };
    const out = [];
    const d = new Date(from ? from.getTime() : Date.now());
    d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 527040 && out.length < count; i++) { // ~1 year of minutes
      if (match(p[0], d.getMinutes(), 0, 59) && match(p[1], d.getHours(), 0, 23) &&
          match(p[2], d.getDate(), 1, 31) && match(p[3], d.getMonth() + 1, 1, 12) &&
          match(p[4], d.getDay(), 0, 6)) out.push(new Date(d.getTime()));
      d.setMinutes(d.getMinutes() + 1);
    }
    return out;
  },
};

const Toolbox = {
  TOOLS: [
    { id: 'regex', name: 'Regex Tester', icon: '.*', family: 'dev', desc: 'Test a regular expression against sample text' },
    { id: 'json', name: 'JSON Formatter', icon: '{ }', family: 'dev', desc: 'Pretty-print, validate, and minify JSON' },
    { id: 'csv', name: 'CSV Viewer', icon: '▦', family: 'dev', desc: 'View CSV as a table and convert to JSON' },
    { id: 'base64', name: 'Base64', icon: '⧉', family: 'dev', desc: 'Encode and decode Base64' },
    { id: 'hash', name: 'Hash', icon: '#', family: 'dev', desc: 'SHA-1 / SHA-256 / SHA-512 of any text' },
    { id: 'timestamp', name: 'Timestamp', icon: '🕐', family: 'dev', desc: 'Convert Unix time ⇄ human date' },
    { id: 'cron', name: 'Cron', icon: '⏱', family: 'dev', desc: 'Explain a cron expression and its next runs' },
    { id: 'uuid', name: 'UUID', icon: '🆔', family: 'dev', desc: 'Generate v4 UUIDs' },
    { id: 'wordcount', name: 'Word Count', icon: '¶', family: 'write', desc: 'Words, characters, reading time' },
    { id: 'color', name: 'Color & Contrast', icon: '🎨', family: 'design', desc: 'Pick colors, convert, check WCAG contrast' },
  ],

  get(id) { return this.TOOLS.find(t => t.id === id); },

  // Which tools the user has enabled (job-profiles sets this). Empty = show all.
  enabledIds() {
    try { const a = JSON.parse(localStorage.getItem('vex.jobTools') || 'null'); return Array.isArray(a) ? a : null; } catch { return null; }
  },

  // Launcher grid of enabled tools.
  open() {
    const enabled = this.enabledIds();
    const tools = enabled ? this.TOOLS.filter(t => enabled.includes(t.id)) : this.TOOLS;
    document.getElementById('vex-toolbox')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-toolbox';
    m.style.cssText = 'position:fixed;inset:0;z-index:100053;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:520px;max-width:94vw;max-height:82vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);padding:18px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🧰 Toolbox</span><button id="tb-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${tools.map(t => `<button class="tb-tool" data-id="${t.id}" style="text-align:left;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:'Outfit',sans-serif">
          <div style="font-size:16px">${t.icon}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-top:4px">${t.name}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${t.desc}</div>
        </button>`).join('')}
      </div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#tb-close').addEventListener('click', () => m.remove());
    m.querySelectorAll('.tb-tool').forEach(b => b.addEventListener('click', () => { m.remove(); this.openTool(b.dataset.id); }));
  },

  openTool(id) {
    const fn = this['_' + id];
    if (typeof fn === 'function') fn.call(this);
  },

  // Shared tool modal shell. Returns { body, close }.
  _modal(title, bodyHtml) {
    document.getElementById('vex-tbtool')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-tbtool';
    m.style.cssText = 'position:fixed;inset:0;z-index:100054;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:\'Outfit\',sans-serif';
    m.innerHTML = `<div style="width:560px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 18px 10px"><span style="font-size:14px;font-weight:700;color:var(--text);flex:1">${title}</span><button id="tbt-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button></div>
      <div style="padding:4px 18px 18px;overflow:auto" id="tbt-body">${bodyHtml}</div></div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelector('#tbt-close').addEventListener('click', close);
    return { body: m.querySelector('#tbt-body'), close, root: m };
  },

  _ta(id, ph, val) { return `<textarea id="${id}" placeholder="${ph || ''}" spellcheck="false" style="width:100%;box-sizing:border-box;min-height:90px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px;resize:vertical">${val || ''}</textarea>`; },
  _inp(id, ph, val) { return `<input id="${id}" placeholder="${ph || ''}" value="${val || ''}" spellcheck="false" style="width:100%;box-sizing:border-box;padding:9px 11px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px">`; },
  _out(id) { return `<div id="${id}" style="margin-top:10px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text);white-space:pre-wrap;word-break:break-word"></div>`; },
  _copyBtn(getText) { const b = document.createElement('button'); b.textContent = 'Copy'; b.style.cssText = "margin-top:8px;padding:7px 14px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif"; b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(getText()); window.showToast?.('Copied'); } catch {} }); return b; },

  _regex() {
    const { body } = this._modal('.* Regex Tester', `
      <label style="font-size:11px;color:var(--text-muted)">Pattern</label>${this._inp('rx-pat', '\\b\\w+@\\w+\\.\\w+\\b')}
      <div style="display:flex;gap:6px;margin-top:6px"><input id="rx-flags" placeholder="flags (gim)" value="g" style="width:90px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px"></div>
      <label style="font-size:11px;color:var(--text-muted);display:block;margin-top:10px">Test string</label>${this._ta('rx-test', 'paste text here')}
      ${this._out('rx-out')}`);
    const run = () => {
      const out = body.querySelector('#rx-out');
      try {
        const re = new RegExp(body.querySelector('#rx-pat').value, body.querySelector('#rx-flags').value || undefined);
        const txt = body.querySelector('#rx-test').value;
        const ms = [...txt.matchAll(re.global ? re : new RegExp(re.source, re.flags + 'g'))];
        out.style.color = 'var(--text)';
        out.textContent = ms.length ? `${ms.length} match${ms.length === 1 ? '' : 'es'}:\n` + ms.slice(0, 50).map(m => '• ' + m[0] + (m.length > 1 ? '  [' + m.slice(1).join(', ') + ']' : '')).join('\n') : 'No matches.';
      } catch (e) { out.style.color = 'var(--danger,#ef4444)'; out.textContent = 'Invalid regex: ' + e.message; }
    };
    body.querySelectorAll('input,textarea').forEach(el => el.addEventListener('input', run));
  },

  _json() {
    const { body } = this._modal('{ } JSON Formatter', `${this._ta('js-in', 'paste JSON')}
      <div style="display:flex;gap:6px;margin-top:8px"><button id="js-pretty" style="padding:7px 12px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Pretty</button><button id="js-min" style="padding:7px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Minify</button></div>
      ${this._out('js-out')}`);
    const inEl = body.querySelector('#js-in'), out = body.querySelector('#js-out');
    const go = (min) => { try { const o = JSON.parse(inEl.value); out.style.color = 'var(--text)'; out.textContent = JSON.stringify(o, null, min ? 0 : 2); } catch (e) { out.style.color = 'var(--danger,#ef4444)'; out.textContent = 'Invalid JSON: ' + e.message; } };
    body.querySelector('#js-pretty').addEventListener('click', () => go(false));
    body.querySelector('#js-min').addEventListener('click', () => go(true));
    body.appendChild(this._copyBtn(() => out.textContent));
  },

  _csv() {
    const { body } = this._modal('▦ CSV Viewer', `${this._ta('cv-in', 'a,b,c\\n1,2,3')}${this._out('cv-out')}`);
    const inEl = body.querySelector('#cv-in'), out = body.querySelector('#cv-out');
    const run = () => {
      const rows = ToolboxLib.csvToRows(inEl.value);
      if (!rows.length) { out.textContent = ''; return; }
      const esc = (s) => window.escapeHtml ? window.escapeHtml(s) : s;
      const head = rows[0], data = rows.slice(1);
      out.innerHTML = `<div style="overflow:auto"><table style="border-collapse:collapse;font-size:11px">${'<tr>' + head.map(h => `<th style="border:1px solid var(--border);padding:4px 8px;background:var(--bg);text-align:left">${esc(h)}</th>`).join('') + '</tr>'}${data.slice(0, 100).map(r => '<tr>' + r.map(c => `<td style="border:1px solid var(--border);padding:4px 8px">${esc(c)}</td>`).join('') + '</tr>').join('')}</table></div>
      <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">${data.length} row${data.length === 1 ? '' : 's'} · <a id="cv-json" style="color:var(--primary,var(--accent));cursor:pointer">Copy as JSON</a></div>`;
      out.querySelector('#cv-json')?.addEventListener('click', async () => {
        const objs = data.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
        try { await navigator.clipboard.writeText(JSON.stringify(objs, null, 2)); window.showToast?.('Copied JSON'); } catch {}
      });
    };
    inEl.addEventListener('input', run); run();
  },

  _base64() {
    const { body } = this._modal('⧉ Base64', `${this._ta('b6-in', 'text or base64')}
      <div style="display:flex;gap:6px;margin-top:8px"><button id="b6-enc" style="padding:7px 12px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Encode</button><button id="b6-dec" style="padding:7px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Decode</button></div>${this._out('b6-out')}`);
    const inEl = body.querySelector('#b6-in'), out = body.querySelector('#b6-out');
    body.querySelector('#b6-enc').addEventListener('click', () => { out.style.color = 'var(--text)'; out.textContent = ToolboxLib.b64enc(inEl.value); });
    body.querySelector('#b6-dec').addEventListener('click', () => { const d = ToolboxLib.b64dec(inEl.value); out.style.color = d === null ? 'var(--danger,#ef4444)' : 'var(--text)'; out.textContent = d === null ? 'Not valid Base64' : d; });
    body.appendChild(this._copyBtn(() => out.textContent));
  },

  _hash() {
    const { body } = this._modal('# Hash', `${this._ta('h-in', 'text to hash')}
      <div style="display:flex;gap:6px;margin-top:8px">${['SHA-1', 'SHA-256', 'SHA-512'].map(a => `<button class="h-alg" data-a="${a}" style="padding:7px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">${a}</button>`).join('')}</div>${this._out('h-out')}`);
    const inEl = body.querySelector('#h-in'), out = body.querySelector('#h-out');
    body.querySelectorAll('.h-alg').forEach(b => b.addEventListener('click', async () => {
      try {
        const buf = await crypto.subtle.digest(b.dataset.a, new TextEncoder().encode(inEl.value));
        out.style.color = 'var(--text)';
        out.textContent = b.dataset.a + ': ' + [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
      } catch (e) { out.style.color = 'var(--danger,#ef4444)'; out.textContent = 'Hash failed: ' + e.message; }
    }));
    body.appendChild(this._copyBtn(() => out.textContent.replace(/^[^:]+:\s*/, '')));
  },

  _timestamp() {
    const now = Math.floor(Date.now() / 1000);
    const { body } = this._modal('🕐 Timestamp', `
      <label style="font-size:11px;color:var(--text-muted)">Unix timestamp → date</label>${this._inp('ts-in', String(now), String(now))}${this._out('ts-out')}
      <label style="font-size:11px;color:var(--text-muted);display:block;margin-top:12px">Date → Unix timestamp</label>${this._inp('ts-din', '2026-08-31 14:00')}${this._out('ts-dout')}`);
    const tin = body.querySelector('#ts-in'), tout = body.querySelector('#ts-out');
    const din = body.querySelector('#ts-din'), dout = body.querySelector('#ts-dout');
    const r1 = () => { const d = ToolboxLib.tsToDate(tin.value); tout.textContent = d ? d.toString() + '\n' + d.toISOString() : '—'; };
    const r2 = () => { const t = ToolboxLib.dateToTs(din.value); dout.textContent = t == null ? '—' : String(t); };
    tin.addEventListener('input', r1); din.addEventListener('input', r2); r1();
  },

  _cron() {
    const { body } = this._modal('⏱ Cron', `${this._inp('cr-in', '*/15 9-17 * * 1-5', '*/15 9-17 * * 1-5')}${this._out('cr-out')}`);
    const inEl = body.querySelector('#cr-in'), out = body.querySelector('#cr-out');
    const run = () => {
      const desc = ToolboxLib.cronDescribe(inEl.value);
      if (!desc) { out.style.color = 'var(--danger,#ef4444)'; out.textContent = 'A cron expression has 5 fields: minute hour day month weekday'; return; }
      const next = ToolboxLib.cronNext(inEl.value, 5);
      out.style.color = 'var(--text)';
      out.textContent = '“' + desc + '”\n\nNext runs:\n' + (next.length ? next.map(d => '• ' + d.toLocaleString()).join('\n') : '(none in the next year)');
    };
    inEl.addEventListener('input', run); run();
  },

  _uuid() {
    const gen = () => Array.from({ length: 5 }, () => ToolboxLib.uuidv4()).join('\n');
    const { body } = this._modal('🆔 UUID v4', `${this._out('uu-out')}<div style="margin-top:8px"><button id="uu-gen" style="padding:7px 14px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Generate 5 more</button></div>`);
    const out = body.querySelector('#uu-out');
    const refresh = () => { out.textContent = gen(); };
    body.querySelector('#uu-gen').addEventListener('click', refresh); refresh();
    body.appendChild(this._copyBtn(() => out.textContent));
  },

  _wordcount() {
    const { body } = this._modal('¶ Word Count', `${this._ta('wc-in', 'paste or type text')}${this._out('wc-out')}`);
    const inEl = body.querySelector('#wc-in'), out = body.querySelector('#wc-out');
    const run = () => { const s = ToolboxLib.wordStats(inEl.value); out.textContent = `Words: ${s.words}\nCharacters: ${s.chars} (${s.charsNoSpace} without spaces)\nSentences: ${s.sentences}   Paragraphs: ${s.paragraphs}   Lines: ${s.lines}\nReading time: ${s.readingMin < 1 ? '<1' : Math.round(s.readingMin)} min`; };
    inEl.addEventListener('input', run); run();
  },

  _color() {
    const { body } = this._modal('🎨 Color & Contrast', `
      <div style="display:flex;gap:10px;align-items:center"><input type="color" id="cl-1" value="#6366f1" style="width:48px;height:36px;border:none;background:none;cursor:pointer"><div id="cl-1out" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text)"></div></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px"><span style="font-size:11px;color:var(--text-muted)">vs background</span><input type="color" id="cl-2" value="#ffffff" style="width:48px;height:36px;border:none;background:none;cursor:pointer"></div>
      ${this._out('cl-out')}`);
    const c1 = body.querySelector('#cl-1'), c2 = body.querySelector('#cl-2'), o1 = body.querySelector('#cl-1out'), out = body.querySelector('#cl-out');
    const run = () => {
      const rgb = ToolboxLib.hexToRgb(c1.value), hsl = rgb && ToolboxLib.rgbToHsl(rgb.r, rgb.g, rgb.b);
      o1.textContent = rgb ? `${c1.value}  ·  rgb(${rgb.r}, ${rgb.g}, ${rgb.b})  ·  hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` : '';
      const cr = ToolboxLib.contrast(c1.value, c2.value);
      const rate = (r) => r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA Large' : 'Fail';
      out.innerHTML = cr ? `Contrast ratio: <b>${cr}:1</b> — ${rate(cr)} <span style="color:var(--text-muted)">(AA needs 4.5, AAA 7)</span>` : '';
    };
    c1.addEventListener('input', run); c2.addEventListener('input', run); run();
  },
};

if (typeof window !== 'undefined') { window.Toolbox = Toolbox; window.ToolboxLib = ToolboxLib; }
if (typeof module !== 'undefined' && module.exports) module.exports = { Toolbox, ToolboxLib };
