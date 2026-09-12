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
  // --- Base64URL + JWT ---
  b64urlDecode(s) {
    try { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); } catch { return null; }
  },
  jwtDecode(token) {
    try {
      const parts = String(token || '').trim().split('.');
      if (parts.length < 2) return null;
      const hd = this.b64urlDecode(parts[0]); const pl = this.b64urlDecode(parts[1]);
      if (hd == null || pl == null) return null;
      return { header: JSON.parse(hd), payload: JSON.parse(pl) };
    } catch { return null; }
  },
  // --- Case conversion ---
  caseConvert(text, mode) {
    const t = String(text || '');
    const words = (t.trim().match(/[A-Za-z0-9]+/g) || []);
    switch (mode) {
      case 'upper': return t.toUpperCase();
      case 'lower': return t.toLowerCase();
      case 'title': return t.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      case 'sentence': return t.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, c => c.toUpperCase());
      case 'camel': return words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
      case 'snake': return words.map(w => w.toLowerCase()).join('_');
      case 'kebab': return words.map(w => w.toLowerCase()).join('-');
      case 'constant': return words.map(w => w.toUpperCase()).join('_');
      default: return t;
    }
  },
  // --- Password generator (crypto-random; excludes look-alike chars) ---
  passGen(len, opts) {
    opts = opts || {};
    let pool = '';
    if (opts.lower !== false) pool += 'abcdefghijkmnpqrstuvwxyz';
    if (opts.upper !== false) pool += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    if (opts.digits !== false) pool += '23456789';
    if (opts.symbols) pool += '!@#$%^&*-_=+?';
    if (!pool) pool = 'abcdefghijkmnpqrstuvwxyz';
    len = Math.max(4, Math.min(128, len || 16));
    const a = new Uint32Array(len);
    try { crypto.getRandomValues(a); } catch { for (let i = 0; i < len; i++) a[i] = Math.floor(Math.random() * 4294967296); }
    let out = ''; for (let i = 0; i < len; i++) out += pool[a[i] % pool.length];
    return out;
  },
  // --- Minimal, safe Markdown -> HTML (escapes first) ---
  mdToHtml(md) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    let html = '', inList = false, inCode = false;
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const raw of lines) {
      if (/^```/.test(raw)) { closeList(); if (inCode) { html += '</pre>'; inCode = false; } else { html += '<pre style="background:rgba(127,127,127,0.12);padding:8px;border-radius:6px;overflow:auto">'; inCode = true; } continue; }
      if (inCode) { html += esc(raw) + '\n'; continue; }
      const line = raw.trimEnd(); let m;
      if (!line.trim()) { closeList(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { closeList(); const n = m[1].length; html += '<h' + n + '>' + inline(m[2]) + '</h' + n + '>'; }
      else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(m[1]) + '</li>'; }
      else { closeList(); html += '<p>' + inline(line) + '</p>'; }
    }
    closeList(); if (inCode) html += '</pre>';
    return html;
  },
};

const Toolbox = {
  TOOLS: [
    { id: 'regex', name: 'Regex Tester', icon: '.*', family: 'dev', desc: 'Test a regular expression against sample text' },
    { id: 'json', name: 'JSON Formatter', icon: '{ }', family: 'dev', desc: 'Pretty-print, validate, and minify JSON' },
    { id: 'csv', name: 'CSV Viewer', icon: '▦', family: 'dev', desc: 'View CSV as a table and convert to JSON' },
    { id: 'base64', name: 'Base64', icon: '⧉', family: 'dev', desc: 'Encode and decode Base64' },
    { id: 'hash', name: 'Hash', icon: '#', family: 'dev', desc: 'SHA-1 / SHA-256 / SHA-512 of any text' },
    { id: 'timestamp', name: 'Timestamp', icon: 'clock', family: 'dev', desc: 'Convert Unix time ⇄ human date' },
    { id: 'cron', name: 'Cron', icon: 'timer', family: 'dev', desc: 'Explain a cron expression and its next runs' },
    { id: 'uuid', name: 'UUID', icon: 'fingerprint', family: 'dev', desc: 'Generate v4 UUIDs' },
    { id: 'wordcount', name: 'Word Count', icon: '¶', family: 'write', desc: 'Words, characters, reading time' },
    { id: 'color', name: 'Color & Contrast', icon: 'palette', family: 'design', desc: 'Pick colors, convert, check WCAG contrast' },
    { id: 'jwt', name: 'JWT Decoder', icon: 'key', family: 'dev', desc: 'Decode a JWT — header & payload (no signature check)' },
    { id: 'urlencode', name: 'URL Encode', icon: '%', family: 'dev', desc: 'Encode / decode URL components' },
    { id: 'caseconvert', name: 'Case Convert', icon: 'Aa', family: 'write', desc: 'UPPER, lower, Title, camelCase, snake_case, kebab' },
    { id: 'passgen', name: 'Password Gen', icon: 'lock', family: 'general', desc: 'Generate a strong random password' },
    { id: 'markdown', name: 'Markdown Preview', icon: 'file', family: 'write', desc: 'Live Markdown → formatted preview' },
  ],

  // Every tool: the hand-built ones above plus the declarative packs
  // (js/toolbox-packs.js, js/toolbox-pack-*.js).
  all() {
    const packs = (typeof ToolboxPacks !== 'undefined') ? ToolboxPacks.specs : [];
    return this.TOOLS.concat(packs);
  },

  get(id) { return this.all().find(t => t.id === id); },

  // Which tools the user's job enabled (job-profiles sets this), or null.
  enabledIds() {
    try { const a = JSON.parse(localStorage.getItem('vex.jobTools') || 'null'); return Array.isArray(a) ? a : null; } catch { return null; }
  },

  // The user's own links (js/tools.js) live in the Toolbox unless they chose
  // to keep them on the sidebar rail.
  linksInRail() {
    try { return localStorage.getItem('vex.toolsInRail') === 'on'; } catch { return false; }
  },
  setLinksInRail(on) {
    try { localStorage.setItem('vex.toolsInRail', on ? 'on' : 'off'); } catch {}
    if (typeof VexTools !== 'undefined') VexTools.renderToolsBar();
  },

  // One icon from vex-icons.js as markup.
  _svg(name, size) {
    return (typeof VexIcons !== 'undefined') ? VexIcons.svg(name, { size: size || 16 }) : '';
  },

  // A modal heading: icon + text, laid out on one line.
  _title(name, text) {
    return `<span style="display:inline-flex;align-items:center;gap:7px">${this._svg(name, 16)}${text}</span>`;
  },

  _modalTitle(spec) {
    const esc = window.escapeHtml ? window.escapeHtml(spec.name) : spec.name;
    return `<span style="display:inline-flex;align-items:center;gap:7px">${this.iconMarkup(spec, 16)}${esc}</span>`;
  },

  // A user link's icon (js/tools.js). Whatever the user typed is theirs, so it
  // is shown as escaped text; only the empty case gets one of our icons.
  _linkIcon(icon) {
    if (!icon) return this._svg('link');
    return window.escapeHtml ? window.escapeHtml(icon) : String(icon);
  },

  // A tool's icon, as markup to drop into the UI.
  //
  // Three hundred tools do not get three hundred drawings. A tool shows:
  //   1. its own icon when that is a VexIcons name (the hand-built tools),
  //   2. its own icon when that is short typographic text — ".*", "{ }", "Aa",
  //      "#", "%" — because those ARE the tool, and
  //   3. otherwise its family's icon, so a whole family reads as one group.
  // Typographic icons are escaped: several contain "<" ("<meta>", "<>→{}").
  iconMarkup(tool, size) {
    const px = size || 16;
    const icons = (typeof VexIcons !== 'undefined') ? VexIcons : null;
    const own = tool && typeof tool.icon === 'string' ? tool.icon : '';
    if (icons && icons.has(own)) return icons.svg(own, { size: px });
    if (own && own.length <= 7 && !/\p{Extended_Pictographic}/u.test(own)) {
      // 137 of the 318 tools are marked with a typographic sign (".*", "{ }",
      // "Aa") rather than a drawing. Returned bare, they took whatever
      // font-size and baseline the surrounding container had, so a grid mixing
      // them with the 181 SVG tools looked like two different designs. Give
      // them the same box an icon occupies: same size, centred, currentColor.
      const txt = window.escapeHtml ? window.escapeHtml(own) : own;
      const chars = [...own].length;
      const fs = Math.max(8, Math.round(px * (chars > 3 ? 0.46 : chars > 2 ? 0.6 : chars > 1 ? 0.72 : 0.86)));
      return `<span class="tb-glyph" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:${px}px;height:${px}px;flex:none;font-size:${fs}px;line-height:1;font-weight:700;letter-spacing:-.02em;color:currentColor;overflow:hidden">${txt}</span>`;
    }
    const F = (typeof ToolboxPacks !== 'undefined') ? ToolboxPacks.FAMILIES : {};
    const fam = F[tool && tool.family];
    if (icons && fam && icons.has(fam.icon)) return icons.svg(fam.icon, { size: px });
    return icons ? icons.svg('toolbox', { size: px }) : '';
  },

  // Family label for a tool (hand-built tools use the same family ids).
  _familyLabel(fam) {
    const F = (typeof ToolboxPacks !== 'undefined') ? ToolboxPacks.FAMILIES : {};
    return (F[fam] && F[fam].label) || fam;
  },

  // Search: every word must appear in the name, description, keywords or
  // family.
  _matches(t, q) {
    if (!q) return true;
    const hay = [t.name, t.desc, t.family, this._familyLabel(t.family), ...(t.keywords || [])].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  },

  // Launcher: search, family filter, your job's tools first, your links, then
  // everything by family.
  open() {
    document.getElementById('vex-toolbox')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-toolbox';
    m.style.cssText = 'position:fixed;inset:0;z-index:100053;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:\'Outfit\',sans-serif';
    m.innerHTML = `<div style="width:820px;max-width:95vw;height:84vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 18px 8px">
        <span style="font-size:15px;font-weight:700;color:var(--text);display:inline-flex;align-items:center;gap:7px">${this._svg('toolbox', 17)}Toolbox</span>
        <span id="tb-count" style="font-size:11.5px;color:var(--text-muted);flex:1"></span>
        <button id="tb-close" aria-label="Close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px">✕</button>
      </div>
      <div style="padding:0 18px 8px"><input id="tb-search" placeholder="Search tools — try “loan”, “json”, “bmi”, “convert”…" spellcheck="false" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:13px;font-family:inherit"></div>
      <div id="tb-fams" style="display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 10px"></div>
      <div id="tb-list" style="overflow:auto;padding:0 18px 18px;flex:1"></div>
    </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelector('#tb-close').addEventListener('click', close);
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const state = { q: '', fam: 'all' };
    const search = m.querySelector('#tb-search');
    search.addEventListener('input', () => { state.q = search.value.trim(); this._paintList(m, state); });
    this._paintFamilies(m, state);
    this._paintList(m, state);
    search.focus();
  },

  _paintFamilies(m, state) {
    const bar = m.querySelector('#tb-fams');
    const tools = this.all();
    const fams = [...new Set(tools.map(t => t.family))].sort((a, b) => this._familyLabel(a).localeCompare(this._familyLabel(b)));
    const chips = [['all', `All (${tools.length})`]];
    if (this.enabledIds()) chips.push(['job', 'For your job']);
    if (!this.linksInRail()) chips.push(['links', 'Your links']);
    for (const f of fams) chips.push([f, `${this._familyLabel(f)} (${tools.filter(t => t.family === f).length})`]);
    bar.innerHTML = '';
    for (const [id, label] of chips) {
      const b = document.createElement('button');
      b.textContent = label;
      const on = state.fam === id;
      b.style.cssText = `padding:5px 10px;border-radius:999px;cursor:pointer;font-size:11.5px;font-family:inherit;border:1px solid ${on ? 'var(--primary,var(--accent))' : 'var(--border)'};background:${on ? 'color-mix(in srgb, var(--primary,var(--accent)) 16%, var(--bg))' : 'var(--bg)'};color:var(--text)`;
      b.addEventListener('click', () => { state.fam = id; this._paintFamilies(m, state); this._paintList(m, state); });
      bar.appendChild(b);
    }
  },

  // `iconHtml` is markup (an <svg> from VexIcons, or escaped typographic text),
  // not a plain glyph — build it with iconMarkup() rather than passing a string.
  _card(label, iconHtml, desc, onClick) {
    const b = document.createElement('button');
    b.className = 'tb-tool';
    b.style.cssText = "text-align:left;padding:11px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:'Outfit',sans-serif;min-width:0";
    const i = document.createElement('div'); i.style.cssText = 'font-size:15px;line-height:1;height:18px;color:var(--text)'; i.innerHTML = iconHtml;
    const n = document.createElement('div'); n.style.cssText = 'font-size:12.5px;font-weight:600;color:var(--text);margin-top:4px'; n.textContent = label;
    const d = document.createElement('div'); d.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px;line-height:1.35'; d.textContent = desc;
    b.append(i, n, d);
    b.addEventListener('click', onClick);
    return b;
  },

  _section(list, title, cards) {
    if (!cards.length) return;
    const h = document.createElement('div');
    h.style.cssText = 'margin:14px 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);font-weight:700';
    h.textContent = title;
    const g = document.createElement('div');
    g.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px';
    g.append(...cards);
    list.append(h, g);
  },

  _paintList(m, state) {
    const list = m.querySelector('#tb-list');
    list.innerHTML = '';
    const toolCard = (t) => this._card(t.name, this.iconMarkup(t), t.desc, () => { m.remove(); this.openTool(t.id); });
    const all = this.all().filter(t => this._matches(t, state.q));
    const enabled = this.enabledIds() || [];
    let shown = 0;

    // Your links (the user's own tools, js/tools.js) — unless kept on the rail.
    const links = () => {
      if (this.linksInRail() || typeof VexTools === 'undefined') return;
      const mine = VexTools.tools.filter(t => this._matches({ name: t.name, desc: t.desc || t.url, family: 'links' }, state.q));
      const cards = mine.map(t => {
        const c = this._card(t.name, this._linkIcon(t.icon), t.desc || t.url, () => { m.remove(); VexTools.openTool(t); });
        c.title = t.url + '  (right-click to edit or remove)';
        c.addEventListener('contextmenu', (e) => { e.preventDefault(); VexTools.showContextMenu(e, t); });
        return c;
      });
      if (!state.q) cards.push(this._card('Add a link', this._svg('plus'), 'Any site you use as a tool — it opens in a tab', () => { m.remove(); VexTools.showEditModal(); }));
      this._section(list, 'Your links', cards);
      shown += mine.length;
      const opt = document.createElement('label');
      opt.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--text-muted);cursor:pointer';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => { this.setLinksInRail(cb.checked); window.showToast?.('Your links are on the sidebar now'); m.remove(); });
      opt.append(cb, document.createTextNode('Show my links on the sidebar instead of here'));
      list.appendChild(opt);
    };

    if (state.fam === 'links') { links(); }
    else if (state.fam === 'job') {
      const jobTools = all.filter(t => enabled.includes(t.id));
      this._section(list, 'For your job', jobTools.map(toolCard));
      shown = jobTools.length;
    } else if (state.fam !== 'all') {
      const famTools = all.filter(t => t.family === state.fam);
      this._section(list, this._familyLabel(state.fam), famTools.map(toolCard));
      shown = famTools.length;
    } else if (state.q) {
      links();
      this._section(list, 'Tools', all.map(toolCard));
      shown += all.length;
    } else {
      const jobTools = all.filter(t => enabled.includes(t.id));
      this._section(list, 'For your job', jobTools.map(toolCard));
      links();
      const fams = [...new Set(all.map(t => t.family))].sort((a, b) => this._familyLabel(a).localeCompare(this._familyLabel(b)));
      for (const f of fams) this._section(list, this._familyLabel(f), all.filter(t => t.family === f).map(toolCard));
      shown = all.length;
    }
    m.querySelector('#tb-count').textContent = state.q ? `${shown} match${shown === 1 ? '' : 'es'}` : `${this.all().length} tools`;
    if (!list.children.length) {
      const none = document.createElement('div');
      none.style.cssText = 'padding:30px 0;text-align:center;color:var(--text-muted);font-size:13px';
      none.textContent = 'No tools match that.';
      list.appendChild(none);
    }
  },

  openTool(id) {
    const fn = this['_' + id];
    if (typeof fn === 'function') { fn.call(this); return; }
    const spec = (typeof ToolboxPacks !== 'undefined') && ToolboxPacks.specs.find(s => s.id === id);
    if (!spec) throw new Error(`Toolbox has no tool "${id}"`);
    this._runSpec(spec);
  },

  // The shared screen for declarative tools: a field per input, the result
  // recomputed on every change, and Copy.
  _runSpec(spec) {
    const { body } = this._modal(this._modalTitle(spec), '');
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:10px';
    desc.textContent = spec.desc;
    body.appendChild(desc);
    const inputs = {};
    const box = 'width:100%;box-sizing:border-box;padding:9px 11px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;font-family:inherit';
    for (const f of spec.fields) {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:block;margin-bottom:9px';
      const lab = document.createElement('div');
      lab.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:4px';
      lab.textContent = f.label;
      let el;
      if (f.type === 'textarea') {
        el = document.createElement('textarea');
        el.style.cssText = box + ";min-height:90px;resize:vertical;font-family:'JetBrains Mono',monospace";
        el.spellcheck = false;
      } else if (f.type === 'select') {
        el = document.createElement('select');
        el.style.cssText = box;
        for (const [val, text] of f.options) { const o = document.createElement('option'); o.value = val; o.textContent = text; el.appendChild(o); }
      } else {
        el = document.createElement('input');
        el.type = f.type || 'text';
        if (f.type === 'checkbox') el.style.cssText = 'width:16px;height:16px'; else el.style.cssText = box;
        for (const k of ['min', 'max', 'step']) if (f[k] !== undefined) el[k] = f[k];
      }
      if (f.placeholder) el.placeholder = f.placeholder;
      if (f.type === 'checkbox') el.checked = !!f.value;
      else if (f.value !== undefined) el.value = f.value;
      inputs[f.id] = el;
      if (f.type === 'checkbox') { wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:9px;cursor:pointer'; wrap.append(el, lab); lab.style.marginBottom = '0'; }
      else wrap.append(lab, el);
      body.appendChild(wrap);
    }
    const out = document.createElement('div');
    out.style.cssText = "margin-top:6px;padding:10px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--border);font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--text);white-space:pre-wrap;word-break:break-word;min-height:20px";
    body.appendChild(out);
    let lastText = '';
    const run = () => {
      const raw = {};
      for (const f of spec.fields) raw[f.id] = f.type === 'checkbox' ? inputs[f.id].checked : inputs[f.id].value;
      out.replaceChildren();
      try {
        const res = spec.run(ToolboxPacks.coerce(spec, raw));
        lastText = ToolboxPacks.asText(res);
        out.style.color = 'var(--text)';
        if (Array.isArray(res)) {
          const t = document.createElement('table');
          t.style.cssText = 'border-collapse:collapse';
          for (const [k, v] of res) {
            const tr = document.createElement('tr');
            const a = document.createElement('td'); a.style.cssText = 'padding:3px 12px 3px 0;color:var(--text-muted);vertical-align:top;white-space:nowrap'; a.textContent = k;
            const b = document.createElement('td'); b.style.cssText = 'padding:3px 0'; b.textContent = v;
            tr.append(a, b); t.appendChild(tr);
          }
          out.appendChild(t);
        } else out.textContent = lastText;
      } catch (e) {
        lastText = '';
        out.style.color = 'var(--danger,#ef4444)';
        out.textContent = (e && e.message) || String(e);
      }
    };
    Object.values(inputs).forEach(el => { el.addEventListener('input', run); el.addEventListener('change', run); });
    body.appendChild(this._copyBtn(() => lastText));
    run();
    const first = spec.fields.length && inputs[spec.fields[0].id];
    if (first) setTimeout(() => { try { first.focus(); } catch {} }, 30);
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
    const { body } = this._modal(this._title('clock', 'Timestamp'), `
      <label style="font-size:11px;color:var(--text-muted)">Unix timestamp → date</label>${this._inp('ts-in', String(now), String(now))}${this._out('ts-out')}
      <label style="font-size:11px;color:var(--text-muted);display:block;margin-top:12px">Date → Unix timestamp</label>${this._inp('ts-din', '2026-08-31 14:00')}${this._out('ts-dout')}`);
    const tin = body.querySelector('#ts-in'), tout = body.querySelector('#ts-out');
    const din = body.querySelector('#ts-din'), dout = body.querySelector('#ts-dout');
    const r1 = () => { const d = ToolboxLib.tsToDate(tin.value); tout.textContent = d ? d.toString() + '\n' + d.toISOString() : '—'; };
    const r2 = () => { const t = ToolboxLib.dateToTs(din.value); dout.textContent = t == null ? '—' : String(t); };
    tin.addEventListener('input', r1); din.addEventListener('input', r2); r1();
  },

  _cron() {
    const { body } = this._modal(this._title('timer', 'Cron'), `${this._inp('cr-in', '*/15 9-17 * * 1-5', '*/15 9-17 * * 1-5')}${this._out('cr-out')}`);
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
    const { body } = this._modal(this._title('fingerprint', 'UUID v4'), `${this._out('uu-out')}<div style="margin-top:8px"><button id="uu-gen" style="padding:7px 14px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Generate 5 more</button></div>`);
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
    const { body } = this._modal(this._title('palette', 'Color &amp; Contrast'), `
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
  _jwt() {
    const { body } = this._modal(this._title('key', 'JWT Decoder'), this._ta('jw-in', 'paste a JWT (eyJ...)') + this._out('jw-out'));
    const inEl = body.querySelector('#jw-in'), out = body.querySelector('#jw-out');
    const run = () => {
      const d = ToolboxLib.jwtDecode(inEl.value);
      if (!d) { out.style.color = 'var(--danger,#ef4444)'; out.textContent = inEl.value.trim() ? 'Not a valid JWT' : ''; return; }
      out.style.color = 'var(--text)';
      out.textContent = 'HEADER\n' + JSON.stringify(d.header, null, 2) + '\n\nPAYLOAD\n' + JSON.stringify(d.payload, null, 2) + (d.payload && d.payload.exp ? '\n\nExpires: ' + new Date(d.payload.exp * 1000).toLocaleString() : '');
    };
    inEl.addEventListener('input', run);
  },
  _urlencode() {
    const { body } = this._modal('% URL Encode', this._ta('ue-in', 'text or an encoded URL') + `<div style="display:flex;gap:6px;margin-top:8px"><button id="ue-enc" style="padding:7px 12px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Encode</button><button id="ue-dec" style="padding:7px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Decode</button></div>` + this._out('ue-out'));
    const inEl = body.querySelector('#ue-in'), out = body.querySelector('#ue-out');
    body.querySelector('#ue-enc').addEventListener('click', () => { try { out.style.color = 'var(--text)'; out.textContent = encodeURIComponent(inEl.value); } catch (e) { out.textContent = 'Error'; } });
    body.querySelector('#ue-dec').addEventListener('click', () => { try { out.style.color = 'var(--text)'; out.textContent = decodeURIComponent(inEl.value); } catch (e) { out.style.color = 'var(--danger,#ef4444)'; out.textContent = 'Malformed URL encoding'; } });
    body.appendChild(this._copyBtn(() => out.textContent));
  },
  _caseconvert() {
    const modes = [['upper','UPPER'],['lower','lower'],['title','Title'],['sentence','Sentence'],['camel','camelCase'],['snake','snake_case'],['kebab','kebab-case'],['constant','CONSTANT']];
    const { body } = this._modal('Aa Case Convert', this._ta('cc-in', 'type or paste text') + `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">` + modes.map(m => `<button class="cc-m" data-m="${m[0]}" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:11.5px;font-family:'Outfit',sans-serif">${m[1]}</button>`).join('') + `</div>` + this._out('cc-out'));
    const inEl = body.querySelector('#cc-in'), out = body.querySelector('#cc-out');
    body.querySelectorAll('.cc-m').forEach(b => b.addEventListener('click', () => { out.textContent = ToolboxLib.caseConvert(inEl.value, b.dataset.m); }));
    body.appendChild(this._copyBtn(() => out.textContent));
  },
  _passgen() {
    const { body } = this._modal(this._title('lock', 'Password Generator'), `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><label style="font-size:12px;color:var(--text-muted)">Length</label><input id="pg-len" type="range" min="6" max="48" value="16" style="flex:1"><span id="pg-lenv" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text);width:24px;text-align:right">16</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--text);margin-bottom:12px">
        <label style="cursor:pointer"><input type="checkbox" id="pg-upper" checked> A-Z</label>
        <label style="cursor:pointer"><input type="checkbox" id="pg-lower" checked> a-z</label>
        <label style="cursor:pointer"><input type="checkbox" id="pg-digits" checked> 0-9</label>
        <label style="cursor:pointer"><input type="checkbox" id="pg-symbols"> !@#$</label>
      </div>` + this._out('pg-out') + `<div style="margin-top:8px"><button id="pg-gen" style="padding:8px 16px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">↻ Generate</button></div>`);
    const out = body.querySelector('#pg-out'), len = body.querySelector('#pg-len'), lenv = body.querySelector('#pg-lenv');
    const gen = () => { out.style.fontSize = '15px'; out.textContent = ToolboxLib.passGen(parseInt(len.value, 10), { upper: body.querySelector('#pg-upper').checked, lower: body.querySelector('#pg-lower').checked, digits: body.querySelector('#pg-digits').checked, symbols: body.querySelector('#pg-symbols').checked }); };
    len.addEventListener('input', () => { lenv.textContent = len.value; gen(); });
    body.querySelectorAll('#pg-upper,#pg-lower,#pg-digits,#pg-symbols').forEach(c => c.addEventListener('change', gen));
    body.querySelector('#pg-gen').addEventListener('click', gen); gen();
    body.appendChild(this._copyBtn(() => out.textContent));
  },
  _markdown() {
    const { body } = this._modal(this._title('file', 'Markdown Preview'), this._ta('md-in', '# Hello\n\n**bold**, *italic*, `code`, [link](https://example.com)\n\n- one\n- two') + `<div id="md-out" style="margin-top:10px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;line-height:1.6;overflow:auto;max-height:42vh"></div>`);
    const inEl = body.querySelector('#md-in'), out = body.querySelector('#md-out');
    const run = () => { out.innerHTML = ToolboxLib.mdToHtml(inEl.value); };
    inEl.addEventListener('input', run); run();
  },
};

if (typeof window !== 'undefined') { window.Toolbox = Toolbox; window.ToolboxLib = ToolboxLib; }
if (typeof module !== 'undefined' && module.exports) module.exports = { Toolbox, ToolboxLib };
