// Every request Vex makes must name its own feature in "what left this computer".
// The public-only fetch used to carry a default label ('Vex Agent page reads'), so ~776 AI-news polls
// showed up as the AI agent reading pages. There is no default now: a caller names itself, or the
// ledger works the label out from the host, or it says 'Other Vex request'.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEgressLedger, OTHER_FEATURE } = require('../../src/main/egress-ledger.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('no misleading default label', () => {
  it('boundedPublicFetch is built without a feature default', () => {
    const line = read('src/main.js').split(/\r?\n/).find(l => /^const boundedPublicFetch = /.test(l));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/feature\s*:/);
    expect(line).not.toContain('Vex Agent page reads');
  });

  it('a request that names nothing gets a host-derived or generic label, never the agent label', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-egl-'));
    try {
      const ledger = createEgressLedger({ file: path.join(dir, 'l.json'), fs });
      const f = ledger.wrap(async () => ({ ok: true, status: 200, headers: new Headers() }), {});
      await f('https://raw.githubusercontent.com/0xmortuex/ai-news-tracker/main/x.json');
      await f('https://news.example.org/feed');
      const rows = ledger.list();
      expect(rows.map(r => r.feature)).toEqual([OTHER_FEATURE, 'GitHub download']);
      expect(rows.every(r => r.feature !== 'Vex Agent page reads')).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('every caller names its feature', () => {
  // Every main-side module that calls a public-only fetch passes an egress label with the request.
  it.each(['dev-feeds', 'status-check', 'maker-repos', 'threat-list'])('src/main/%s.js labels each public fetch', (name) => {
    const src = read('src/main/' + name + '.js');
    const re = /\b(?:publicFetch|fetch)\(([^;]{0,700})/g;
    let m, seen = 0;
    while ((m = re.exec(src))) {
      if (!/timeoutMs|maxBytes/.test(m[1].slice(0, 500))) continue;   // a call that builds a bounded request
      seen++;
      expect(m[1], name + ': ' + m[1].slice(0, 80)).toMatch(/egress/);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('every renderer apiRequest names an egress label (or is the API viewer, labelled in main)', () => {
    const dir = path.join(root, 'src', 'renderer', 'js');
    const bad = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) check(p); } };
    const check = (p) => {
      const src = fs.readFileSync(p, 'utf8');
      const re = /\bapiRequest\(\{([^\n]*)/g;
      let m;
      while ((m = re.exec(src))) if (!/egress|viewer:\s*true/.test(m[1])) bad.push(path.relative(root, p) + ': ' + m[1].slice(0, 70));
    };
    walk(dir);
    expect(bad).toEqual([]);
  });

  it('the shared page reader and the AI-news poll label themselves', () => {
    expect(read('src/renderer/js/agent-tools.js')).toMatch(/egress: egress \|\| 'Vex Agent page reads'/);
    expect(read('src/renderer/js/ai-news.js')).toMatch(/egress: 'AI news'/);
    expect(read('src/renderer/js/page-watch.js')).toMatch(/'Page watch'/);
    expect(read('src/renderer/js/dev-shortcuts.js')).toMatch(/egress: 'Developer shortcuts'/);
    expect(read('src/renderer/js/mcp-client.js')).toMatch(/egress: 'MCP server'/);
    expect(read('src/main.js')).toMatch(/feature: 'API viewer'/);
    expect(read('src/main.js')).toMatch(/signal: ctrl\.signal, egress: \{ feature: 'Search suggestions'/);
  });
});
