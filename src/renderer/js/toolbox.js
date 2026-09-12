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
    { id: 'base64', name: 'Base64', icon: 'braces', family: 'dev', desc: 'Standard, URL, IMAP or custom alphabets — to and from text, hex or bytes', keywords: ['b64','encode','decode','base64url','jwt','mime','atob','btoa'] },
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
  // Every declarative pack tool, on the workbench.
  //
  // A pack tool is a list of typed fields and a pure run(). That maps onto the
  // workbench directly: the field you actually type into becomes the input
  // pane, every other field becomes a setting in the column, and the result
  // goes to the output pane. So all ~300 of them gain what the hand-built ones
  // got — live re-running, remembered options, copy, swap, two sizes and a
  // reference panel — without each one being rewritten.
  //
  // The reference is built from what the spec already carries: its description,
  // its family, its search terms, and its worked examples. An example that only
  // sets the main field is clickable, because loading it is the fastest way to
  // see what the tool wants.
  _specPrimaryField(spec) {
    const fields = spec.fields || [];
    return fields.find(f => f.type === 'textarea')
      || fields.find(f => !f.type || f.type === 'text')
      || fields[0]
      || null;
  },

  _specToWorkbench(spec) {
    const fields = spec.fields || [];
    const primary = this._specPrimaryField(spec);
    const rest = fields.filter(f => f !== primary);

    const options = rest.map(f => {
      if (f.type === 'checkbox') return { id: f.id, label: f.label, type: 'toggle', default: !!f.value };
      if (f.type === 'select') {
        return { id: f.id, label: f.label, type: 'select', default: f.value != null ? String(f.value) : String((f.options[0] || [''])[0]), options: f.options };
      }
      return {
        id: f.id, label: f.label, type: 'text',
        default: f.value != null ? String(f.value) : '',
        placeholder: f.placeholder || (f.type === 'number' ? 'a number' : ''),
        hint: f.type === 'number' && (f.min !== undefined || f.max !== undefined)
          ? `between ${f.min !== undefined ? f.min : '−∞'} and ${f.max !== undefined ? f.max : '∞'}` : undefined,
      };
    });

    const details = [];
    if (spec.desc) details.push({ title: 'What this does', text: spec.desc });
    const fam = ToolboxPacks.FAMILIES[spec.family];
    if (fam) details.push({ title: 'Family', text: fam.label });
    // An example is only offered as a one-click load when the main field is all
    // it sets — otherwise clicking it would silently ignore half the example.
    const simple = (spec.examples || []).filter(e => primary && e.in && Object.keys(e.in).length === 1 && e.in[primary.id] !== undefined);
    if (simple.length) {
      details.push({
        title: 'Try one', examples: true,
        rows: simple.slice(0, 4).map(e => [String(e.in[primary.id]), 'Example input']),
      });
    }
    const complex = (spec.examples || []).filter(e => !simple.includes(e) && e.in);
    if (complex.length) {
      details.push({
        title: 'Worked examples',
        rows: complex.slice(0, 4).map(e => [
          Object.entries(e.in).map(([k, v]) => `${k}=${v}`).join(', '),
          typeof e.out === 'string' ? e.out.slice(0, 90) : (Array.isArray(e.out) ? e.out.map(r => r.join(': ')).join(' · ').slice(0, 90) : 'see result'),
        ]),
      });
    }
    // keywords is an array in most specs and a plain string in a few, so
    // accept either rather than throwing on the ones that differ.
    const kw = Array.isArray(spec.keywords) ? spec.keywords
      : (typeof spec.keywords === 'string' && spec.keywords ? spec.keywords.split(/[,s]+/).filter(Boolean) : []);
    if (kw.length) details.push({ title: 'Also known as', text: kw.join(', ') });

    return {
      id: 'pack-' + spec.id,
      title: spec.name,
      icon: (spec.icon && window.VexIcons && VexIcons.has(spec.icon)) ? spec.icon : (fam ? fam.icon : 'toolbox'),
      blurb: spec.desc || '',
      inputLabel: primary ? primary.label : 'Input',
      outputLabel: 'Result',
      placeholder: (primary && primary.placeholder) || '',
      sample: simple.length ? String(simple[0].in[primary.id]) : undefined,
      runLabel: 'Run',
      options,
      details,
      run: ({ input, opt }) => {
        const raw = {};
        for (const f of fields) {
          raw[f.id] = (f === primary) ? input
            : (f.type === 'checkbox' ? !!opt[f.id] : (opt[f.id] != null ? opt[f.id] : (f.value != null ? f.value : '')));
        }
        const res = spec.run(ToolboxPacks.coerce(spec, raw));
        if (Array.isArray(res)) {
          // Rows render as an aligned two-column block, which stays readable
          // when copied out as text.
          const width = Math.max(0, ...res.map(([k]) => String(k).length));
          return {
            output: res.map(([k, v]) => `${String(k).padEnd(width)}   ${v}`).join('\n'),
            note: `${res.length} value${res.length === 1 ? '' : 's'}`,
          };
        }
        return { output: ToolboxPacks.asText(res) };
      },
    };
  },

  _runSpec(spec) {
    // A tool with no inputs at all (a generator) still needs somewhere to put
    // its result, so it goes through the same shell with an empty input.
    if (!window.ToolboxWorkbench) throw new Error('The tool shell did not load.');
    return window.ToolboxWorkbench.open(this._specToWorkbench(spec));
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

  // ---- JSON ---------------------------------------------------------------
  _json() {
    return window.ToolboxWorkbench.open({
      id: 'json',
      details: [
            {
                  "title": "What it checks",
                  "text": "Strict JSON: double quotes only, no trailing commas, no comments. A syntax error is reported with the line and column so you can go straight to it."
            },
            {
                  "title": "Sort keys",
                  "text": "Ordering keys alphabetically at every level makes two documents comparable in a diff. It changes the text, never the meaning."
            },
            {
                  "title": "Try one",
                  "examples": true,
                  "rows": [
                        [
                              "{\"b\":2,\"a\":{\"d\":4,\"c\":[3,1,2]}}",
                              "Nested, unsorted."
                        ],
                        [
                              "{\"a\":1,,}",
                              "Broken, to see the error."
                        ]
                  ]
            }
      ],
      title: 'JSON',
      icon: 'braces',
      blurb: 'Format, minify, sort keys or validate — with the line and column of a syntax error.',
      placeholder: '{"paste":"json here"}',
      runLabel: 'Format',
      sample: '{"b":2,"a":{"d":4,"c":[3,1,2]}}',
      options: [
        { id: 'mode', label: 'Operation', type: 'select', default: 'pretty',
          options: [['pretty', 'Format'], ['minify', 'Minify'], ['validate', 'Validate only']] },
        { id: 'indent', label: 'Indent', type: 'select', default: '2',
          options: [['2', '2 spaces'], ['4', '4 spaces'], ['\t', 'Tabs']], when: (s) => s.mode === 'pretty' },
        { id: 'sort', label: 'Sort keys', type: 'toggle', default: false, when: (s) => s.mode !== 'validate' },
      ],
      run({ input, opt }) {
        let data;
        try { data = JSON.parse(input); }
        catch (err) {
          // Turn "position 42" into something you can actually navigate to.
          const at = /position (\d+)/.exec(err.message);
          if (at) {
            const pos = Number(at[1]);
            const before = input.slice(0, pos);
            const line = before.split('\n').length;
            const col = pos - before.lastIndexOf('\n');
            throw new Error(`${err.message.replace(/ in JSON.*$/, '')} — line ${line}, column ${col}`);
          }
          throw new Error(err.message);
        }
        const sorter = (k, v) => {
          if (!opt.sort || v === null || typeof v !== 'object' || Array.isArray(v)) return v;
          return Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]]));
        };
        const count = (o) => (o && typeof o === 'object') ? Object.keys(o).length : 0;
        if (opt.mode === 'validate') {
          return { output: 'Valid JSON.', note: `${Array.isArray(data) ? `array of ${data.length}` : `object with ${count(data)} keys`}` };
        }
        const indent = opt.mode === 'minify' ? 0 : (opt.indent === '\t' ? '\t' : Number(opt.indent));
        const out = JSON.stringify(data, sorter, indent);
        return { output: out, note: `${input.length.toLocaleString()} -> ${out.length.toLocaleString()} characters` };
      },
    });
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

  // Base64, properly.
  //
  // The old version did one thing: standard Base64 of a UTF-8 string, encode or
  // decode, and "Not valid Base64" when anything else arrived. Real Base64 in
  // the wild is not one format — a JWT is Base64URL and unpadded, a mail header
  // is MIME with wrapped lines, an IMAP mailbox name uses a modified alphabet
  // with a different 62nd and 63rd character, and plenty of encoders simply
  // leave the padding off. Decoding those should work, not fail.
  _base64() {
    const ALPHABETS = {
      standard: { name: 'Standard (RFC 4648)', c62: '+', c63: '/' },
      url: { name: 'Base64URL (RFC 4648 §5)', c62: '-', c63: '_' },
      imap: { name: 'IMAP mailbox (RFC 3501)', c62: '+', c63: ',' },
      custom: { name: 'Custom 62nd/63rd', c62: '+', c63: '/' },
    };

    const bytesToB64 = (bytes) => {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    };
    const b64ToBytes = (b64) => {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    const hexOf = (bytes) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join(' ');

    const decodeText = (bytes, charset) => {
      if (charset === 'hex') return hexOf(bytes);
      if (charset === 'bytes') return [...bytes].join(' ');
      if (charset === 'latin1') return [...bytes].map(b => String.fromCharCode(b)).join('');
      // `fatal` so mis-decoded bytes are reported rather than silently turned
      // into replacement characters that look like a successful decode.
      return new TextDecoder(charset || 'utf-8', { fatal: true }).decode(bytes);
    };

    const encodeText = (text, charset) => {
      if (charset === 'hex') {
        const clean = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
        if (clean.length % 2) throw new Error('Hex input has an odd number of digits.');
        const out = new Uint8Array(clean.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
        return out;
      }
      if (charset === 'bytes') {
        const nums = text.split(/[\s,]+/).filter(Boolean).map(Number);
        if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Byte values must be whole numbers from 0 to 255.');
        return new Uint8Array(nums);
      }
      if (charset === 'latin1') {
        const out = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
          const c = text.charCodeAt(i);
          if (c > 255) throw new Error(`"${text[i]}" cannot be written in Latin-1. Use UTF-8.`);
          out[i] = c;
        }
        return out;
      }
      return new TextEncoder().encode(text);
    };

    return window.ToolboxWorkbench.open({
      id: 'base64',
      details: [
            {
                  "title": "What the alphabets differ on",
                  "rows": [
                        [
                              "Standard  + /",
                              "RFC 4648 §4. The everyday one. Padded with = to a multiple of four."
                        ],
                        [
                              "Base64URL  - _",
                              "RFC 4648 §5. Safe inside a URL or filename. JWTs use it, unpadded."
                        ],
                        [
                              "IMAP  + ,",
                              "RFC 3501 modified Base64 for mailbox names, where / is a path separator."
                        ],
                        [
                              "Custom",
                              "Anything else: set the 62nd and 63rd characters yourself."
                        ]
                  ]
            },
            {
                  "title": "Try one",
                  "examples": true,
                  "rows": [
                        [
                              "aG93IGFyZSB5b3UgYnJv",
                              "Standard, padded."
                        ],
                        [
                              "eyJhbGciOiJIUzI1NiJ9",
                              "A JWT header — unpadded."
                        ],
                        [
                              "SGVsbG8tX3dvcmxk",
                              "Base64URL, using - and _."
                        ]
                  ]
            },
            {
                  "title": "Padding",
                  "text": "The = signs only exist to round the length up to a multiple of four. Vex puts them back when they are missing, which is why unpadded input decodes here and fails in most tools."
            },
            {
                  "title": "Size",
                  "text": "Base64 is 4 characters for every 3 bytes — about 33% larger than the data it carries. MIME wraps at 76 columns; a URL never should."
            }
      ],
      title: 'Base64',
      icon: 'braces',
      blurb: 'Standard, Base64URL, IMAP or a custom alphabet — padded or not — to and from text, hex or raw bytes.',
      inputLabel: 'Input',
      outputLabel: 'Output',
      placeholder: 'Paste Base64 to decode, or text to encode…',
      sample: 'aG93IGFyZSB5b3UgYnJv',
      runLabel: 'Convert',
      options: [
        { id: 'mode', label: 'Operation', type: 'select', default: 'decode',
          options: [['decode', 'Decode'], ['encode', 'Encode']] },
        { id: 'variant', label: 'Alphabet', type: 'select', default: 'auto',
          options: [['auto', 'Detect automatically'], ...Object.entries(ALPHABETS).map(([k, v]) => [k, v.name])],
          hint: 'Detection reads the 62nd/63rd characters actually present.' },
        { id: 'c62', label: '62nd character', type: 'text', default: '+', when: (s) => s.variant === 'custom' },
        { id: 'c63', label: '63rd character', type: 'text', default: '/', when: (s) => s.variant === 'custom' },
        { id: 'charset', label: 'Text encoding', type: 'select', default: 'utf-8',
          options: [['utf-8', 'UTF-8'], ['latin1', 'Latin-1 / binary'], ['utf-16le', 'UTF-16 LE'], ['hex', 'Hex bytes'], ['bytes', 'Decimal bytes']] },
        { id: 'pad', label: 'Add = padding', type: 'toggle', default: true, when: (s) => s.mode === 'encode' },
        { id: 'wrap', label: 'Wrap at 76 columns (MIME)', type: 'toggle', default: false, when: (s) => s.mode === 'encode' },
        { id: 'lenient', label: 'Ignore stray characters', type: 'toggle', default: true, when: (s) => s.mode === 'decode',
          hint: 'Whitespace, quotes and newlines from a copy/paste.' },
      ],

      // Decoding then swapping should offer to encode it back, not decode the
      // plain text it just produced.
      swap: (_input, output, opt) => ({ input: output, opt: { mode: opt.mode === 'decode' ? 'encode' : 'decode' } }),

      run({ input, opt }) {
        const alpha = opt.variant === 'custom'
          ? { c62: (opt.c62 || '+')[0], c63: (opt.c63 || '/')[0] }
          : ALPHABETS[opt.variant] || null;

        if (opt.mode === 'encode') {
          const bytes = encodeText(input, opt.charset);
          let b64 = bytesToB64(bytes);
          const a = alpha || ALPHABETS.standard;
          if (a.c62 !== '+') b64 = b64.split('+').join(a.c62);
          if (a.c63 !== '/') b64 = b64.split('/').join(a.c63);
          if (!opt.pad) b64 = b64.replace(/=+$/, '');
          if (opt.wrap) b64 = b64.replace(/.{76}/g, '$&\n');
          const variantName = (alpha && alpha.name) || 'Standard (RFC 4648)';
          return { output: b64, note: `${bytes.length.toLocaleString()} bytes in · ${b64.length.toLocaleString()} characters out · ${variantName}` };
        }

        // ---- decode ----
        let s = input;
        if (opt.lenient) s = s.replace(/[\s"'`,]+/g, '');
        if (!s) throw new Error('Nothing to decode once the stray characters were removed.');

        let used = alpha;
        if (opt.variant === 'auto') {
          // Pick by what is actually in the string, rather than assuming.
          if (/[-_]/.test(s) && !/[+/]/.test(s)) used = ALPHABETS.url;
          else if (/,/.test(s) && !/\//.test(s)) used = ALPHABETS.imap;
          else used = ALPHABETS.standard;
        }
        let norm = s;
        if (used.c62 !== '+') norm = norm.split(used.c62).join('+');
        if (used.c63 !== '/') norm = norm.split(used.c63).join('/');

        const bad = norm.replace(/=+$/, '').match(/[^A-Za-z0-9+/]/);
        if (bad) {
          throw new Error(`"${bad[0]}" is not part of the ${used.name || 'selected'} alphabet. `
            + (opt.lenient ? 'Try a different alphabet.' : 'Turn on "Ignore stray characters" if this was pasted.'));
        }

        // Unpadded is extremely common (JWTs, URLs). Put the padding back.
        const padded = norm + '='.repeat((4 - (norm.replace(/=+$/, '').length % 4)) % 4);
        let bytes;
        try { bytes = b64ToBytes(padded); }
        catch { throw new Error('That is not valid Base64 — the length is wrong even after padding.'); }

        let text;
        try { text = decodeText(bytes, opt.charset); }
        catch {
          throw new Error(`Decoded ${bytes.length} bytes, but they are not valid ${String(opt.charset).toUpperCase()} text. `
            + 'Try "Hex bytes" to see what they actually are.');
        }
        const wasPadded = /=+$/.test(s);
        return {
          output: text,
          note: `${bytes.length.toLocaleString()} bytes · ${used.name || 'custom alphabet'}${wasPadded ? '' : ' · padding was missing and has been restored'}`,
        };
      },
    });
  },
  // ---- Hash ---------------------------------------------------------------
  _hash() {
    const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    return window.ToolboxWorkbench.open({
      id: 'hash',
      details: [
            {
                  "title": "Choosing one",
                  "rows": [
                        [
                              "SHA-256",
                              "The default for almost everything. 64 hex characters."
                        ],
                        [
                              "SHA-512",
                              "Longer digest, faster than SHA-256 on 64-bit machines."
                        ],
                        [
                              "SHA-384",
                              "SHA-512 truncated. Used by some TLS suites."
                        ],
                        [
                              "SHA-1",
                              "Collisions are practical since 2017. Legacy checks only."
                        ]
                  ]
            },
            {
                  "title": "HMAC",
                  "text": "A plain hash proves the data has not changed. HMAC proves it came from someone holding the key — use it for signing webhooks and API requests, never a bare hash."
            },
            {
                  "title": "Not for passwords",
                  "text": "These are built to be fast, which is exactly wrong for storing a password. Use bcrypt, scrypt or Argon2 for that."
            }
      ],
      title: 'Hash',
      icon: 'fingerprint',
      blurb: 'SHA-1 through SHA-512, plain or HMAC, as hex, Base64 or Base64URL.',
      placeholder: 'Text to hash…',
      runLabel: 'Hash',
      sample: 'how are you bro',
      options: [
        { id: 'alg', label: 'Algorithm', type: 'select', default: 'SHA-256',
          options: [['SHA-256', 'SHA-256'], ['SHA-1', 'SHA-1 (broken — legacy only)'], ['SHA-384', 'SHA-384'], ['SHA-512', 'SHA-512']] },
        { id: 'hmac', label: 'HMAC (keyed)', type: 'toggle', default: false },
        { id: 'key', label: 'Key', type: 'text', default: '', placeholder: 'shared secret', when: (s) => s.hmac },
        { id: 'enc', label: 'Output as', type: 'select', default: 'hex',
          options: [['hex', 'Hex'], ['base64', 'Base64'], ['base64url', 'Base64URL']] },
        { id: 'upper', label: 'Upper case hex', type: 'toggle', default: false, when: (s) => s.enc === 'hex' },
        { id: 'input', label: 'Read input as', type: 'select', default: 'text',
          options: [['text', 'Text (UTF-8)'], ['hex', 'Hex bytes']] },
      ],
      run({ input, opt }) {
        let bytes;
        if (opt.input === 'hex') {
          const clean = input.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
          if (clean.length % 2) throw new Error('Hex input has an odd number of digits.');
          bytes = new Uint8Array(clean.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
        } else bytes = new TextEncoder().encode(input);

        // crypto.subtle is async; the workbench wants a value, so the promise is
        // resolved into the pane when it settles.
        const finish = (buf) => {
          let s = opt.enc === 'hex' ? hex(buf) : b64(buf);
          if (opt.enc === 'base64url') s = s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          if (opt.enc === 'hex' && opt.upper) s = s.toUpperCase();
          return s;
        };
        const p = opt.hmac
          ? (async () => {
            if (!opt.key) throw new Error('HMAC needs a key.');
            const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(opt.key), { name: 'HMAC', hash: opt.alg }, false, ['sign']);
            return crypto.subtle.sign('HMAC', k, bytes);
          })()
          : crypto.subtle.digest(opt.alg, bytes);

        const out = document.getElementById('wb-out');
        const note = document.getElementById('wb-note');
        p.then(buf => {
          out.textContent = finish(buf);
          out.classList.remove('wb-error');
          note.textContent = `${bytes.length.toLocaleString()} bytes in · ${opt.hmac ? 'HMAC-' : ''}${opt.alg}`;
        }).catch(err => {
          out.textContent = (err && err.message) || 'Could not hash that.';
          out.classList.add('wb-error');
        });
        return { output: 'Hashing…', note: '' };
      },
    });
  },
  // ---- Timestamp ----------------------------------------------------------
  _timestamp() {
    return window.ToolboxWorkbench.open({
      id: 'timestamp',
      details: [
            {
                  "title": "Seconds or milliseconds",
                  "text": "Unix time in seconds is 10 digits until the year 2286; in milliseconds it is 13. Vex guesses by magnitude unless you say which."
            },
            {
                  "title": "Try one",
                  "examples": true,
                  "rows": [
                        [
                              "1760000000",
                              "Unix seconds."
                        ],
                        [
                              "2026-03-10T13:00:00Z",
                              "ISO 8601, UTC."
                        ]
                  ]
            },
            {
                  "title": "Leave it empty",
                  "text": "An empty input gives you the current time in every format at once."
            }
      ],
      title: 'Timestamp',
      icon: 'clock',
      blurb: 'Unix seconds or milliseconds to a real date and back, in your zone or UTC.',
      placeholder: 'Leave empty for now, or paste 1760000000 / an ISO date…',
      runLabel: 'Convert',
      options: [
        { id: 'zone', label: 'Show in', type: 'select', default: 'local', options: [['local', 'This computer’s zone'], ['utc', 'UTC']] },
        { id: 'unit', label: 'Assume numbers are', type: 'select', default: 'auto',
          options: [['auto', 'Detect by magnitude'], ['s', 'Seconds'], ['ms', 'Milliseconds']] },
      ],
      run({ input, opt }) {
        const raw = input.trim();
        let d;
        if (!raw) d = new Date();
        else if (/^-?\d+$/.test(raw)) {
          const n = Number(raw);
          const ms = opt.unit === 'ms' ? n : opt.unit === 's' ? n * 1000 : (Math.abs(n) < 1e11 ? n * 1000 : n);
          d = new Date(ms);
        } else {
          d = new Date(raw);
        }
        if (isNaN(d.getTime())) throw new Error('That is not a timestamp or a date this can read.');
        const utc = opt.zone === 'utc';
        const pad = (n, w = 2) => String(n).padStart(w, '0');
        const Y = utc ? d.getUTCFullYear() : d.getFullYear();
        const Mo = pad((utc ? d.getUTCMonth() : d.getMonth()) + 1);
        const D = pad(utc ? d.getUTCDate() : d.getDate());
        const h = pad(utc ? d.getUTCHours() : d.getHours());
        const mi = pad(utc ? d.getUTCMinutes() : d.getMinutes());
        const se = pad(utc ? d.getUTCSeconds() : d.getSeconds());
        const diff = Math.round((d.getTime() - Date.now()) / 1000);
        const ago = Math.abs(diff) < 60 ? `${Math.abs(diff)}s` : Math.abs(diff) < 3600 ? `${Math.round(Math.abs(diff) / 60)}m`
          : Math.abs(diff) < 86400 ? `${Math.round(Math.abs(diff) / 3600)}h` : `${Math.round(Math.abs(diff) / 86400)}d`;
        return {
          output: [
            `unix (s)    ${Math.floor(d.getTime() / 1000)}`,
            `unix (ms)   ${d.getTime()}`,
            `ISO 8601    ${d.toISOString()}`,
            `${utc ? 'UTC        ' : 'local      '} ${Y}-${Mo}-${D} ${h}:${mi}:${se}`,
            `readable    ${utc ? d.toUTCString() : d.toString()}`,
          ].join('\n'),
          note: diff === 0 ? 'right now' : diff < 0 ? `${ago} ago` : `in ${ago}`,
        };
      },
    });
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

  // ---- Word count ---------------------------------------------------------
  _wordcount() {
    return window.ToolboxWorkbench.open({
      id: 'wordcount',
      details: [
            {
                  "title": "Reading speed",
                  "text": "The average adult reads prose at around 238 words per minute. Technical material is slower; skimming is much faster."
            },
            {
                  "title": "What counts as a word",
                  "text": "Anything separated by whitespace. Hyphenated compounds count once, which is how most word counters behave."
            }
      ],
      title: 'Word count',
      icon: 'list',
      blurb: 'Words, characters, sentences, paragraphs, reading time and the most frequent words.',
      placeholder: 'Paste your text…',
      runLabel: 'Count',
      options: [
        { id: 'wpm', label: 'Reading speed', type: 'select', default: '238',
          options: [['150', 'Slow — 150 wpm'], ['238', 'Average — 238 wpm'], ['300', 'Fast — 300 wpm']] },
        { id: 'top', label: 'Show most frequent words', type: 'toggle', default: true },
      ],
      run({ input, opt }) {
        const words = input.trim() ? input.trim().split(/\s+/) : [];
        const sentences = input.split(/[.!?]+(?:\s|$)/).filter(s => s.trim()).length;
        const paras = input.split(/\n\s*\n/).filter(s => s.trim()).length;
        const mins = words.length / Number(opt.wpm || 238);
        const lines = [
          `words           ${words.length.toLocaleString()}`,
          `characters      ${input.length.toLocaleString()}`,
          `without spaces  ${input.replace(/\s/g, '').length.toLocaleString()}`,
          `sentences       ${sentences.toLocaleString()}`,
          `paragraphs      ${paras.toLocaleString()}`,
          `lines           ${input.split('\n').length.toLocaleString()}`,
          `reading time    ${mins < 1 ? 'under a minute' : Math.round(mins) + ' min'}`,
        ];
        if (opt.top && words.length) {
          const stop = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'is', 'it', 'that', 'for', 'on', 'with', 'as', 'was', 'are', 'be', 'this', 'at', 'by']);
          const freq = new Map();
          for (const w of words) {
            const k = w.toLowerCase().replace(/[^a-z0-9']/g, '');
            if (!k || stop.has(k)) continue;
            freq.set(k, (freq.get(k) || 0) + 1);
          }
          const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
          if (top.length) lines.push('', 'most frequent', ...top.map(([w, n]) => `  ${String(n).padStart(4)}  ${w}`));
        }
        return { output: lines.join('\n'), note: `${words.length.toLocaleString()} words` };
      },
    });
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
  // ---- JWT ----------------------------------------------------------------
  _jwt() {
    const seg = (s) => {
      const norm = s.replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(escape(atob(norm + '='.repeat((4 - norm.length % 4) % 4))));
    };
    return window.ToolboxWorkbench.open({
      id: 'jwt',
      details: [
            {
                  "title": "The three parts",
                  "rows": [
                        [
                              "header",
                              "Which algorithm signed it, and sometimes a key id."
                        ],
                        [
                              "payload",
                              "The claims. Readable by anyone — a JWT is signed, not encrypted."
                        ],
                        [
                              "signature",
                              "Proves the first two were not altered. Needs the key to check."
                        ]
                  ]
            },
            {
                  "title": "Decoding is not verifying",
                  "text": "This shows you what a token says. It cannot tell you whether it is genuine — that needs the signing key. Never trust a claim on the strength of having decoded it."
            },
            {
                  "title": "Common claims",
                  "rows": [
                        [
                              "exp",
                              "Expires at (unix seconds). Past means the token is dead."
                        ],
                        [
                              "iat",
                              "Issued at."
                        ],
                        [
                              "nbf",
                              "Not valid before."
                        ],
                        [
                              "sub",
                              "Subject — usually the user id."
                        ],
                        [
                              "aud",
                              "Audience — who the token is for."
                        ]
                  ]
            }
      ],
      title: 'JWT',
      icon: 'key',
      blurb: 'Decode header and payload, with expiry and issued-at read as real dates. Never verifies — decoding is not validation.',
      placeholder: 'eyJhbGciOi…',
      runLabel: 'Decode',
      options: [
        { id: 'part', label: 'Show', type: 'select', default: 'both', options: [['both', 'Header and payload'], ['header', 'Header only'], ['payload', 'Payload only']] },
        { id: 'dates', label: 'Read timestamps as dates', type: 'toggle', default: true },
      ],
      run({ input, opt }) {
        const parts = input.trim().split('.');
        if (parts.length < 2) throw new Error('A JWT has at least two dot-separated parts. This has ' + parts.length + '.');
        let header, payload;
        try { header = JSON.parse(seg(parts[0])); } catch { throw new Error('The header is not valid Base64URL JSON.'); }
        try { payload = JSON.parse(seg(parts[1])); } catch { throw new Error('The payload is not valid Base64URL JSON.'); }

        const lines = [];
        if (opt.part !== 'payload') lines.push('── header ──', JSON.stringify(header, null, 2));
        if (opt.part !== 'header') {
          if (lines.length) lines.push('');
          lines.push('── payload ──', JSON.stringify(payload, null, 2));
        }
        if (opt.dates) {
          const stamps = [['exp', 'expires'], ['iat', 'issued'], ['nbf', 'not before']]
            .filter(([k]) => typeof payload[k] === 'number')
            .map(([k, label]) => `${label.padEnd(11)} ${new Date(payload[k] * 1000).toLocaleString()}`);
          if (stamps.length) lines.push('', '── times ──', ...stamps);
        }
        const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : null;
        const state = exp ? (exp < Date.now() ? 'EXPIRED' : 'valid until ' + new Date(exp).toLocaleString()) : 'no expiry claim';
        return { output: lines.join('\n'), note: `alg ${header.alg || '?'} · ${state} · signature NOT checked` };
      },
    });
  },
  _urlencode() {
    return window.ToolboxWorkbench.open({
      id: 'urlencode',
      details: [
            {
                  "title": "Component or whole URI",
                  "rows": [
                        [
                              "Component",
                              "Encodes / ? & = # — for one value you are putting INTO a URL."
                        ],
                        [
                              "Whole URI",
                              "Leaves the structural characters alone so the URL still works."
                        ]
                  ]
            },
            {
                  "title": "Spaces",
                  "text": "A space is %20 in a path and may be + in a query string, because form encoding predates the URL standard. Use the + toggle when you are handling form data."
            },
            {
                  "title": "Try one",
                  "examples": true,
                  "rows": [
                        [
                              "https://example.com/search?q=how are you&lang=en",
                              "Spaces in a query."
                        ],
                        [
                              "caf%C3%A9%20%2B%20cr%C3%A8me",
                              "Percent-encoded UTF-8, to decode."
                        ]
                  ]
            }
      ],
      title: 'URL encode',
      icon: 'link',
      blurb: 'Percent-encoding for a whole URL or a single component, with +-for-space and a query breakdown.',
      placeholder: 'Text or URL…',
      runLabel: 'Convert',
      sample: 'https://example.com/search?q=how are you&lang=en',
      options: [
        { id: 'mode', label: 'Operation', type: 'select', default: 'encode', options: [['encode', 'Encode'], ['decode', 'Decode'], ['parse', 'Break a URL apart']] },
        { id: 'scope', label: 'Scope', type: 'select', default: 'component',
          options: [['component', 'Component (encodes / ? & =)'], ['uri', 'Whole URI (keeps them)']], when: (s) => s.mode !== 'parse' },
        { id: 'plus', label: 'Use + for spaces (form style)', type: 'toggle', default: false, when: (s) => s.mode !== 'parse' },
      ],
      swap: (_i, out, opt) => ({ input: out, opt: { mode: opt.mode === 'encode' ? 'decode' : 'encode' } }),
      run({ input, opt }) {
        if (opt.mode === 'parse') {
          let u;
          try { u = new URL(input.trim()); } catch { throw new Error('That is not a complete URL (it needs a scheme, like https://).'); }
          const lines = [
            `scheme    ${u.protocol.replace(':', '')}`,
            `host      ${u.hostname}`,
            u.port ? `port      ${u.port}` : null,
            `path      ${u.pathname}`,
            u.hash ? `fragment  ${u.hash.slice(1)}` : null,
          ].filter(Boolean);
          const params = [...u.searchParams.entries()];
          if (params.length) {
            lines.push('', `query (${params.length})`);
            for (const [k, v] of params) lines.push(`  ${k} = ${v}`);
          }
          return { output: lines.join('\n'), note: `${u.hostname} · ${params.length} query parameter${params.length === 1 ? '' : 's'}` };
        }
        if (opt.mode === 'encode') {
          let s = opt.scope === 'uri' ? encodeURI(input) : encodeURIComponent(input);
          if (opt.plus) s = s.replace(/%20/g, '+');
          return { output: s, note: `${input.length} in · ${s.length} out` };
        }
        let s = opt.plus ? input.replace(/\+/g, '%20') : input;
        try { return { output: opt.scope === 'uri' ? decodeURI(s) : decodeURIComponent(s) }; }
        catch { throw new Error('That contains a broken percent-escape (a % not followed by two hex digits).'); }
      },
    });
  },
  // ---- Case ---------------------------------------------------------------
  _caseconvert() {
    const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/).filter(Boolean);
    const CASES = {
      lower: (s) => s.toLowerCase(),
      upper: (s) => s.toUpperCase(),
      title: (s) => words(s).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' '),
      sentence: (s) => { const t = s.toLowerCase(); return t.replace(/(^\s*\w|[.!?]\s+\w)/g, c => c.toUpperCase()); },
      camel: (s) => words(s).map((w, i) => i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join(''),
      pascal: (s) => words(s).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(''),
      snake: (s) => words(s).map(w => w.toLowerCase()).join('_'),
      constant: (s) => words(s).map(w => w.toUpperCase()).join('_'),
      kebab: (s) => words(s).map(w => w.toLowerCase()).join('-'),
      dot: (s) => words(s).map(w => w.toLowerCase()).join('.'),
      path: (s) => words(s).map(w => w.toLowerCase()).join('/'),
      alternating: (s) => [...s].map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join(''),
      inverted: (s) => [...s].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(''),
    };
    return window.ToolboxWorkbench.open({
      id: 'caseconvert',
      details: [
            {
                  "title": "Where each is used",
                  "rows": [
                        [
                              "camelCase",
                              "JavaScript variables, JSON keys."
                        ],
                        [
                              "PascalCase",
                              "Class and component names."
                        ],
                        [
                              "snake_case",
                              "Python, SQL columns, Rust."
                        ],
                        [
                              "CONSTANT_CASE",
                              "Environment variables, constants."
                        ],
                        [
                              "kebab-case",
                              "URLs, CSS classes, file names."
                        ]
                  ]
            },
            {
                  "title": "How words are found",
                  "text": "Splitting happens at spaces, underscores, hyphens, dots and at a lower-to-upper boundary — so \"parseHTTPResponse\" and \"parse_http_response\" give the same words."
            }
      ],
      title: 'Change case',
      icon: 'type',
      blurb: 'camelCase, snake_case, kebab-case, CONSTANT_CASE, Title Case and more — one at a time or all at once.',
      placeholder: 'some text to convert',
      runLabel: 'Convert',
      sample: 'the quick brown fox',
      options: [
        { id: 'target', label: 'Convert to', type: 'select', default: 'all',
          options: [['all', 'Show every case'], ...Object.keys(CASES).map(k => [k, k])] },
      ],
      run({ input, opt }) {
        if (opt.target !== 'all') return { output: CASES[opt.target](input) };
        const width = Math.max(...Object.keys(CASES).map(k => k.length));
        return {
          output: Object.entries(CASES).map(([k, fn]) => `${k.padEnd(width)}  ${fn(input)}`).join('\n'),
          note: `${Object.keys(CASES).length} forms`,
        };
      },
    });
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
