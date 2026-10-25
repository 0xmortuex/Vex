// What a document is, from where it came and what it begins with. Pure functions: no page, no worker.
//
//   classify({ url, contentType, head, source }) -> { kind, lang, delimiter, tentative, name }
//
// kind     'json' | 'jsonl' | 'xml' | 'csv' | 'md' | 'text'
// lang     the language the text view colours ('plain' for none)
// tentative  true when the kind is only a guess from the first bytes (a server that sends text/plain for everything): if the
//            document then does not parse as that kind, the text view is shown without a complaint.

export const LANG_BY_EXT = Object.freeze({
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', json5: 'json', jsonc: 'json', json: 'json', geojson: 'json', webmanifest: 'json',
  css: 'css', scss: 'css', less: 'css', html: 'html', htm: 'html', xhtml: 'html', xml: 'xml', svg: 'xml', xsl: 'xml', xsd: 'xml', rss: 'xml', atom: 'xml', plist: 'xml',
  py: 'py', pyw: 'py', sh: 'sh', bash: 'sh', zsh: 'sh', ksh: 'sh', env: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', gitignore: 'ini', editorconfig: 'ini',
  toml: 'toml', yaml: 'yaml', yml: 'yaml', sql: 'sql', java: 'java', kt: 'java', cs: 'java', c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', hh: 'c',
  go: 'go', rs: 'rs', rb: 'rb', php: 'php', lua: 'lua', swift: 'java', r: 'plain', md: 'md', markdown: 'md', mdx: 'md', diff: 'diff', patch: 'diff',
  bat: 'bat', cmd: 'bat', ps1: 'ps', txt: 'plain', text: 'plain', log: 'log', out: 'log', csv: 'plain', tsv: 'plain', jsonl: 'json', ndjson: 'json',
});

// The languages the person can choose by hand, in the order of the list.
export const LANGUAGES = Object.freeze(['plain', 'log', 'js', 'ts', 'json', 'css', 'html', 'xml', 'md', 'py', 'sh', 'bat', 'ps', 'ini', 'toml', 'yaml', 'sql', 'java', 'c', 'go', 'rs', 'rb', 'php', 'lua', 'diff']);

const LANG_BY_TYPE = [
  [/^text\/css$/, 'css'], [/^(?:text|application)\/(?:x-)?(?:java|ecma)script$/, 'js'], [/^application\/typescript$/, 'ts'], [/^(?:text|application)\/(?:x-)?yaml$/, 'yaml'],
  [/^(?:text|application)\/(?:x-)?toml$/, 'toml'], [/^(?:text|application)\/(?:x-)?sql$/, 'sql'], [/^text\/x-(?:python|script\.python)$/, 'py'],
  [/^(?:text|application)\/x-(?:sh|shellscript|csh)$/, 'sh'], [/^text\/x-java-source$/, 'java'], [/^text\/x-c(?:src|hdr|\+\+)?$/, 'c'], [/^text\/x-go$/, 'go'], [/^text\/x-rust$/, 'rs'],
  [/^text\/x-(?:diff|patch)$/, 'diff'], [/^text\/(?:x-)?ini$/, 'ini'], [/^application\/(?:[a-z.+-]+\+)?json$/, 'json'], [/^(?:text|application)\/(?:[a-z.+-]+\+)?xml$/, 'xml'],
  [/^text\/(?:x-)?markdown$/, 'md'], [/^application\/x-httpd-php$/, 'php'],
];

export function extensionOf(path) {
  const clean = String(path || '').replace(/[?#].*$/, '');
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function nameOf(url) {
  const clean = String(url || '').replace(/[?#].*$/, '');
  let name = clean.slice(clean.lastIndexOf('/') + 1);
  try { name = decodeURIComponent(name); } catch { /* vex-allow-empty-catch: a name that is not valid percent-encoding is shown as it is */ }
  if (name) return name;
  try { return new URL(url).hostname; } catch { return String(url || ''); }
}

export function typeOf(contentType) { return String(contentType || '').split(';')[0].trim().toLowerCase(); }

export function charsetOf(contentType) {
  const m = /charset\s*=\s*"?([A-Za-z0-9_.:-]+)"?/i.exec(String(contentType || ''));
  return m ? m[1].toLowerCase() : '';
}

// First characters of the document as text (the page decodes a little of it just for this).
function sniffShebang(head) {
  if (!head.startsWith('#!')) return '';
  const parts = head.split(/\r?\n/, 1)[0].slice(2).trim().split(/\s+/);
  let cmd = parts[0] || '';
  if (/(?:^|\/)env$/.test(cmd)) cmd = parts.slice(1).find((p) => !p.startsWith('-')) || '';
  const name = cmd.split('/').pop();
  return { sh: 'sh', bash: 'sh', zsh: 'sh', python: 'py', python3: 'py', node: 'js', ruby: 'rb', php: 'php', lua: 'lua' }[name] || '';
}

export function langFor({ url, contentType, head }) {
  const type = typeOf(contentType);
  const ext = extensionOf(url);
  if (ext && LANG_BY_EXT[ext]) return LANG_BY_EXT[ext];
  const name = nameOf(url).toLowerCase();
  if (name === 'dockerfile' || name === 'makefile') return 'sh';
  for (const [re, lang] of LANG_BY_TYPE) if (re.test(type)) return lang;
  return sniffShebang(String(head || '')) || 'plain';
}

export function classify({ url, contentType, head, source }) {
  const type = typeOf(contentType);
  const ext = extensionOf(url);
  const text = String(head || '').replace(/^\uFEFF/, '');
  const name = nameOf(url);
  if (source) return { kind: 'text', lang: langFor({ url, contentType, head: text }) === 'plain' ? 'html' : langFor({ url, contentType, head: text }), tentative: false, name };
  const make = (kind, extra) => ({ kind, lang: kind === 'text' ? langFor({ url, contentType, head: text }) : kind, tentative: false, name, ...(extra || {}) });

  // The server said what it is.
  if (/^application\/(?:x-)?(?:ndjson|jsonl|jsonlines|json-seq)$/.test(type)) return make('jsonl');
  if (/^(?:application|text)\/(?:[a-z0-9.+-]+\+)?json$/.test(type)) return ext === 'jsonl' || ext === 'ndjson' ? make('jsonl') : make('json');
  if (/^(?:application|text)\/(?:[a-z0-9.+-]+\+)?xml$/.test(type)) return make('xml');
  if (type === 'text/csv') return make('csv', { delimiter: 'auto' });
  if (type === 'text/tab-separated-values' || type === 'text/tsv') return make('csv', { delimiter: 'tab' });
  if (/^text\/(?:x-)?markdown$/.test(type)) return make('md');

  // text/plain and application/octet-stream say little: the name, then the first bytes.
  if (ext === 'json' || ext === 'geojson') return make('json');
  if (ext === 'jsonl' || ext === 'ndjson') return make('jsonl');
  if (ext === 'xml' || ext === 'svg' || ext === 'xsl' || ext === 'plist') return make('xml');
  if (ext === 'csv') return make('csv', { delimiter: 'auto' });
  if (ext === 'tsv') return make('csv', { delimiter: 'tab' });
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return make('md');
  if (ext && LANG_BY_EXT[ext]) return make('text');
  const first = text.trimStart();
  if (/^<\?xml\b/i.test(first)) return { ...make('xml'), tentative: true };
  if (/^[{[]/.test(first)) {
    // JSON Lines: several lines, each a whole object
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
    if (lines.length >= 2 && lines.every((l) => /^\{.*\}\s*$/.test(l) || /^\[.*\]\s*$/.test(l)) && !/^[{[]\s*$/.test(lines[0])) return { ...make('jsonl'), tentative: true };
    return { ...make('json'), tentative: true };
  }
  return make('text');
}

// Whether `head` (decoded text) looks like HTML: a document the server called text/plain but that is a page.
export function looksLikeHtml(head) {
  return /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(String(head || ''));
}
