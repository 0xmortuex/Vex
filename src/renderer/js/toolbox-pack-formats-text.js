// === Toolbox pack — formats, text and reference ===========================
//
// The second half of the gaps: configuration formats people convert by hand,
// text transforms that are fiddly to get right, and the reference tables that
// send you to a search engine mid-task.
//
// The parsers here are written out rather than approximated with a regex,
// because "nearly right" on a config file is worse than no tool at all — it
// produces something that looks correct and is not.
(function registerFormatsTextPack() {
  const packs = (typeof window !== 'undefined' && window.ToolboxPacks)
    || (typeof ToolboxPacks !== 'undefined' ? ToolboxPacks : null);
  if (!packs) return;

  const need = (v, what) => {
    const s = String(v == null ? '' : v).trim();
    if (!s) throw new Error(`Enter ${what}.`);
    return s;
  };

  // A small, honest YAML writer: the subset that round-trips cleanly from JSON.
  const toYaml = (value, indent = 0) => {
    const pad = '  '.repeat(indent);
    if (value === null) return 'null';
    if (Array.isArray(value)) {
      if (!value.length) return '[]';
      return value.map(v => {
        const inner = toYaml(v, indent + 1);
        return (v && typeof v === 'object' && !Array.isArray(v))
          ? `${pad}-\n${inner}`
          : `${pad}- ${inner.trimStart()}`;
      }).join('\n');
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (!keys.length) return '{}';
      return keys.map(k => {
        const v = value[k];
        if (v && typeof v === 'object' && Object.keys(v).length) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        return `${pad}${k}: ${toYaml(v, indent + 1)}`;
      }).join('\n');
    }
    if (typeof value === 'string') {
      // Quote anything that YAML would otherwise read as another type.
      const risky = /^(\s|$)|[:#{}[\],&*?|>%@`"']|^(true|false|null|yes|no|on|off|~)$/i.test(value)
        || /^-?\d/.test(value);
      return risky ? JSON.stringify(value) : value;
    }
    return String(value);
  };

  // TOML, for the flat-plus-one-level shape that covers most config files.
  const toToml = (obj) => {
    const scalar = (v) => {
      if (typeof v === 'string') return JSON.stringify(v);
      if (typeof v === 'boolean' || typeof v === 'number') return String(v);
      if (Array.isArray(v)) return '[' + v.map(scalar).join(', ') + ']';
      return JSON.stringify(String(v));
    };
    const top = [];
    const tables = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        tables.push(`\n[${k}]\n` + Object.entries(v).map(([k2, v2]) => `${k2} = ${scalar(v2)}`).join('\n'));
      } else top.push(`${k} = ${scalar(v)}`);
    }
    return (top.join('\n') + tables.join('\n')).trim();
  };

  const HTTP = {
    100: 'Continue — keep sending the body.',
    101: 'Switching Protocols — usually a WebSocket upgrade.',
    200: 'OK.',
    201: 'Created — the Location header says where.',
    202: 'Accepted — queued, not finished.',
    204: 'No Content — success, and deliberately no body.',
    206: 'Partial Content — a range request, as used by video seeking.',
    301: 'Moved Permanently — caches and search engines will remember.',
    302: 'Found — a temporary redirect. Method may change to GET.',
    303: 'See Other — redirect and switch to GET. The POST-redirect-GET pattern.',
    304: 'Not Modified — your cached copy is still good.',
    307: 'Temporary Redirect — like 302 but the method is preserved.',
    308: 'Permanent Redirect — like 301 but the method is preserved.',
    400: 'Bad Request — malformed. The client cannot simply retry.',
    401: 'Unauthorized — actually means unauthenticated. Send credentials.',
    403: 'Forbidden — authenticated, but not allowed. Retrying will not help.',
    404: 'Not Found.',
    405: 'Method Not Allowed — the Allow header lists what is permitted.',
    409: 'Conflict — state clash, such as an edit against a stale version.',
    410: 'Gone — deliberately deleted, unlike 404 which may be temporary.',
    413: 'Payload Too Large.',
    415: 'Unsupported Media Type — the Content-Type was refused.',
    418: "I'm a teapot — an April Fools joke from 1998, still implemented.",
    422: 'Unprocessable Content — syntax fine, meaning wrong. Validation failures.',
    429: 'Too Many Requests — check Retry-After before trying again.',
    500: 'Internal Server Error — the catch-all for an unhandled fault.',
    501: 'Not Implemented.',
    502: 'Bad Gateway — a proxy got nonsense from upstream.',
    503: 'Service Unavailable — overloaded or down for maintenance.',
    504: 'Gateway Timeout — a proxy gave up waiting upstream.',
  };

  packs.add([
    {
      id: 'fmt-json-yaml',
      name: 'JSON to YAML',
      icon: 'braces',
      family: 'data',
      desc: 'Convert JSON to YAML or TOML, quoting anything that would otherwise change meaning.',
      keywords: ['yaml', 'toml', 'convert', 'config', 'json'],
      fields: [
        { id: 'json', label: 'JSON', type: 'textarea', placeholder: '{"name":"vex","ports":[80,443]}' },
        { id: 'to', label: 'Convert to', type: 'select', value: 'yaml', options: [['yaml', 'YAML'], ['toml', 'TOML']] },
      ],
      run(v) {
        const raw = need(v.json, 'some JSON');
        let data;
        try { data = JSON.parse(raw); }
        catch (err) { throw new Error('That is not valid JSON: ' + err.message); }
        if (v.to === 'toml') {
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('TOML needs an object at the top level — an array or a bare value has nowhere to go.');
          }
          return toToml(data);
        }
        return toYaml(data);
      },
      examples: [
        { in: { json: '{"name":"vex","port":443}', to: 'yaml' }, out: 'name: vex\nport: 443' },
        { in: { json: '{"name":"vex","port":443}', to: 'toml' }, out: 'name = "vex"\nport = 443' },
        { in: { json: '{"version":"1.0"}', to: 'yaml' }, out: 'version: "1.0"' },
      ],
    },

    {
      id: 'web-http-status',
      name: 'HTTP status codes',
      icon: 'globe',
      family: 'web',
      desc: 'What a status code means in practice — including the ones routinely used wrongly.',
      keywords: ['http', 'status', '404', '401', '403', '429', 'response code'],
      fields: [{ id: 'code', label: 'Code or search', type: 'text', value: '401', placeholder: '404, or "redirect"' }],
      run(v) {
        const q = need(v.code, 'a status code or a word to search for').toLowerCase();
        if (/^\d{3}$/.test(q)) {
          const n = Number(q);
          const known = HTTP[n];
          const klass = n < 200 ? 'Informational' : n < 300 ? 'Success' : n < 400 ? 'Redirect' : n < 500 ? 'Client error' : 'Server error';
          if (!known) return [['Code', q], ['Class', klass], ['Meaning', 'Not a registered code. The class still applies, and clients treat it as the generic x00 of its class.']];
          const rows = [['Code', q], ['Class', klass], ['Meaning', known]];
          if (n === 401) rows.push(['Note', 'If the user IS logged in and still may not do it, 403 is the correct code.']);
          if (n === 302) rows.push(['Note', 'Use 307 to keep the method, or 303 to force GET. 302 is ambiguous by history.']);
          return rows;
        }
        const hits = Object.entries(HTTP).filter(([c, t]) => t.toLowerCase().includes(q) || c.includes(q));
        if (!hits.length) throw new Error(`Nothing matches "${v.code}". Try a code like 404, or a word like "redirect".`);
        return hits.map(([c, t]) => [c, t]);
      },
      examples: [
        { in: { code: '404' }, out: [['Code', '404'], ['Class', 'Client error'], ['Meaning', 'Not Found.']] },
        { in: { code: '401' }, match: /unauthenticated[\s\S]*403 is the correct code/ },
      ],
    },

    {
      id: 'text-dedupe',
      name: 'Deduplicate lines',
      icon: 'filter',
      family: 'text',
      desc: 'Remove repeats, keep only repeats, or count them — with or without regard to case and order.',
      keywords: ['duplicate', 'unique', 'dedupe', 'distinct', 'count'],
      fields: [
        { id: 'text', label: 'Lines', type: 'textarea', placeholder: 'one per line' },
        { id: 'mode', label: 'Keep', type: 'select', value: 'unique', options: [['unique', 'First of each'], ['dupes', 'Only the repeated ones'], ['counts', 'Each with a count'], ['once', 'Only lines appearing exactly once']] },
        { id: 'ci', label: 'Ignore case', type: 'checkbox', value: false },
        { id: 'sort', label: 'Sort the result', type: 'checkbox', value: false },
      ],
      run(v) {
        const lines = need(v.text, 'some lines').split('\n').map(l => l.trim()).filter(Boolean);
        const key = (l) => v.ci ? l.toLowerCase() : l;
        const counts = new Map();
        for (const l of lines) counts.set(key(l), (counts.get(key(l)) || 0) + 1);
        const firstSeen = [];
        const seen = new Set();
        for (const l of lines) if (!seen.has(key(l))) { seen.add(key(l)); firstSeen.push(l); }

        let out;
        if (v.mode === 'counts') out = firstSeen.map(l => `${String(counts.get(key(l))).padStart(4)}  ${l}`);
        else if (v.mode === 'dupes') out = firstSeen.filter(l => counts.get(key(l)) > 1);
        else if (v.mode === 'once') out = firstSeen.filter(l => counts.get(key(l)) === 1);
        else out = firstSeen;
        if (v.sort) out = out.slice().sort();
        if (!out.length) return 'Nothing matched that filter.';
        return out.join('\n') + `\n\n${lines.length} lines in, ${out.length} out`;
      },
      examples: [
        { in: { text: 'a\nb\na', mode: 'unique', ci: false, sort: false }, out: 'a\nb\n\n3 lines in, 2 out' },
        { in: { text: 'a\nb\na', mode: 'dupes', ci: false, sort: false }, out: 'a\n\n3 lines in, 1 out' },
      ],
    },

    {
      id: 'text-slug',
      name: 'Slug',
      icon: 'link',
      family: 'web',
      desc: 'Turn a title into a URL slug — accents folded, punctuation dropped, length capped at a word boundary.',
      keywords: ['slug', 'url', 'permalink', 'seo', 'kebab'],
      fields: [
        { id: 'text', label: 'Title', type: 'text', placeholder: 'Crème brûlée: the 10 best recipes!' },
        { id: 'sep', label: 'Separator', type: 'select', value: '-', options: [['-', 'Hyphen'], ['_', 'Underscore']] },
        { id: 'max', label: 'Maximum length', type: 'number', value: 60, min: 10, max: 200 },
      ],
      run(v) {
        const title = need(v.text, 'a title');
        const sep = v.sep === '_' ? '_' : '-';
        let slug = title
          .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
          .replace(/[ß]/g, 'ss')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, sep)
          .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
        const max = Number(v.max) || 60;
        if (slug.length > max) {
          slug = slug.slice(0, max);
          const cut = slug.lastIndexOf(sep);
          if (cut > max * 0.5) slug = slug.slice(0, cut);   // do not end mid-word
        }
        return [
          ['Slug', slug],
          ['Length', String(slug.length)],
          ['Words', String(slug.split(sep).filter(Boolean).length)],
        ];
      },
      examples: [
        { in: { text: 'Crème brûlée: the best!', sep: '-', max: 60 }, out: [['Slug', 'creme-brulee-the-best'], ['Length', '21'], ['Words', '4']] },
      ],
    },

    {
      id: 'text-lorem',
      name: 'Placeholder text',
      icon: 'type',
      family: 'write',
      desc: 'Lorem ipsum, or plain English filler when Latin would be mistaken for a bug.',
      keywords: ['lorem', 'ipsum', 'placeholder', 'filler', 'dummy text'],
      fields: [
        { id: 'count', label: 'How many', type: 'number', value: 3, min: 1, max: 50 },
        { id: 'unit', label: 'Of', type: 'select', value: 'paragraphs', options: [['paragraphs', 'Paragraphs'], ['sentences', 'Sentences'], ['words', 'Words']] },
        { id: 'style', label: 'Style', type: 'select', value: 'lorem', options: [['lorem', 'Lorem ipsum'], ['english', 'Plain English']] },
      ],
      run(v) {
        const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');
        const ENGLISH = 'the quick design team shipped a small change that made the page load faster for everyone on a slow connection and nobody noticed until someone looked at the numbers which is usually how good work goes unremarked while the loud rewrite gets the credit and the meeting'.split(' ');
        const words = v.style === 'english' ? ENGLISH : LOREM;
        const n = Math.max(1, Math.min(50, Number(v.count) || 3));
        // Deterministic, so the same request twice gives the same text — a
        // random generator makes a layout jump about while you compare.
        let seed = 7;
        const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const sentence = () => {
          const len = 8 + Math.floor(next() * 10);
          const ws = Array.from({ length: len }, () => words[Math.floor(next() * words.length)]);
          return ws[0][0].toUpperCase() + ws[0].slice(1) + ' ' + ws.slice(1).join(' ') + '.';
        };
        if (v.unit === 'words') {
          return Array.from({ length: n }, () => words[Math.floor(next() * words.length)]).join(' ');
        }
        if (v.unit === 'sentences') return Array.from({ length: n }, sentence).join(' ');
        return Array.from({ length: n }, () => Array.from({ length: 3 + Math.floor(next() * 3) }, sentence).join(' ')).join('\n\n');
      },
      examples: [
        { in: { count: 5, unit: 'words', style: 'lorem' }, match: /^\w+( \w+){4}$/ },
        { in: { count: 1, unit: 'sentences', style: 'english' }, match: /^[A-Z].*\.$/ },
      ],
    },

    {
      id: 'text-ascii',
      name: 'Character inspector',
      icon: 'search',
      family: 'text',
      desc: 'Every character in a string: code point, name category, UTF-8 bytes, and the invisible ones you cannot see.',
      keywords: ['ascii', 'unicode', 'codepoint', 'utf-8', 'invisible', 'zero width'],
      fields: [{ id: 'text', label: 'Text', type: 'text', placeholder: 'paste anything, including what looks wrong' }],
      run(v) {
        const s = need(v.text, 'some text');
        const INVISIBLE = {
          0x200B: 'zero-width space', 0x200C: 'zero-width non-joiner', 0x200D: 'zero-width joiner',
          0x00A0: 'non-breaking space', 0xFEFF: 'byte order mark', 0x202E: 'right-to-left override',
          0x2028: 'line separator', 0x2029: 'paragraph separator', 0x00AD: 'soft hyphen',
        };
        const rows = [];
        for (const ch of s) {
          const cp = ch.codePointAt(0);
          const bytes = [...new TextEncoder().encode(ch)].map(b => b.toString(16).padStart(2, '0')).join(' ');
          const label = INVISIBLE[cp] ? `INVISIBLE — ${INVISIBLE[cp]}`
            : cp < 32 ? 'control'
              : /\p{L}/u.test(ch) ? 'letter' : /\p{N}/u.test(ch) ? 'number'
                : /\p{P}/u.test(ch) ? 'punctuation' : /\p{S}/u.test(ch) ? 'symbol'
                  : /\s/.test(ch) ? 'space' : 'other';
          rows.push([INVISIBLE[cp] || cp < 32 ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : ch,
            `U+${cp.toString(16).toUpperCase().padStart(4, '0')}  ${String(cp).padStart(6)}  ${bytes.padEnd(11)} ${label}`]);
        }
        const hidden = [...s].filter(c => INVISIBLE[c.codePointAt(0)]).length;
        if (hidden) rows.push(['Warning', `${hidden} invisible character${hidden === 1 ? '' : 's'} — these are why a string can look identical and not compare equal.`]);
        return rows;
      },
      examples: [
        { in: { text: 'A' }, out: [['A', 'U+0041      65  41          letter']] },
      ],
    },

    {
      id: 'dev-semver-range',
      name: 'Version ranges (^ and ~)',
      icon: 'git',
      family: 'dev',
      desc: 'What ^1.2.3 and ~1.2.3 actually allow, and whether a given version satisfies a range.',
      keywords: ['semver', 'version', 'caret', 'tilde', 'npm', 'range'],
      fields: [
        { id: 'range', label: 'Range', type: 'text', value: '^1.2.3' },
        { id: 'version', label: 'Check a version (optional)', type: 'text', placeholder: '1.9.0' },
      ],
      run(v) {
        const range = need(v.range, 'a range like ^1.2.3');
        const m = range.match(/^([\^~]?)(\d+)\.(\d+)\.(\d+)/);
        if (!m) throw new Error('Write the range as ^1.2.3, ~1.2.3 or 1.2.3.');
        const [, op, MA, MI, PA] = m;
        const [maj, min, pat] = [Number(MA), Number(MI), Number(PA)];
        let lo, hi, explain;
        if (op === '^') {
          lo = `${maj}.${min}.${pat}`;
          hi = maj === 0 ? `0.${min + 1}.0` : `${maj + 1}.0.0`;
          explain = maj === 0
            ? 'Below 1.0.0 a caret only allows patch-level changes, because 0.x is treated as unstable.'
            : 'A caret allows anything that does not change the leftmost non-zero number.';
        } else if (op === '~') {
          lo = `${maj}.${min}.${pat}`; hi = `${maj}.${min + 1}.0`;
          explain = 'A tilde allows patch updates only.';
        } else {
          lo = `${maj}.${min}.${pat}`; hi = `${maj}.${min}.${pat}`;
          explain = 'An exact version. Nothing else satisfies it.';
        }
        const rows = [
          ['Range', range],
          ['Allows', op ? `>= ${lo} and < ${hi}` : `= ${lo}`],
          ['Meaning', explain],
        ];
        if (v.version) {
          const vm = String(v.version).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
          if (!vm) throw new Error(`"${v.version}" is not a version like 1.9.0.`);
          const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
          const tv = [Number(vm[1]), Number(vm[2]), Number(vm[3])];
          const loA = lo.split('.').map(Number), hiA = hi.split('.').map(Number);
          const ok = op ? (cmp(tv, loA) >= 0 && cmp(tv, hiA) < 0) : cmp(tv, loA) === 0;
          rows.push([v.version, ok ? 'satisfies this range' : 'does NOT satisfy this range']);
        }
        return rows;
      },
      examples: [
        { in: { range: '^1.2.3', version: '1.9.0' }, match: />= 1\.2\.3 and < 2\.0\.0[\s\S]*satisfies this range/ },
        { in: { range: '^0.2.3', version: '0.3.0' }, match: /does NOT satisfy/ },
      ],
    },
  ]);
})();
