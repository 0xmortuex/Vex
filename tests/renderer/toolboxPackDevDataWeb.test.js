// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
const PACK = require('../../src/renderer/js/toolbox-pack-dev-data-web.js');
const crypto = require('crypto');

const HAND_BUILT = ['regex', 'json', 'csv', 'base64', 'hash', 'timestamp', 'cron', 'uuid', 'wordcount', 'color', 'jwt', 'urlencode', 'caseconvert', 'passgen', 'markdown'];

beforeAll(() => {
  ToolboxPacks.specs = [];
  ToolboxPacks.add(PACK);
});

const spec = (id) => {
  const s = PACK.find(t => t.id === id);
  if (!s) throw new Error(`no spec ${id}`);
  return s;
};

// Field defaults (as the form would hold them) overlaid with `input`, coerced.
function run(id, input = {}) {
  const s = spec(id);
  const raw = {};
  for (const f of s.fields) raw[f.id] = f.value !== undefined ? f.value : (f.type === 'checkbox' ? false : (f.type === 'select' && f.options ? f.options[0][0] : ''));
  Object.assign(raw, input);
  return s.run(ToolboxPacks.coerce(s, raw));
}
const rowsOf = (out) => Object.fromEntries(out);

describe('dev/data/web/security/design pack — contract', () => {
  it('registers with ToolboxPacks and uses only its own families', () => {
    expect(ToolboxPacks.specs.length).toBe(PACK.length);
    expect(PACK.length).toBeGreaterThanOrEqual(55);
    for (const s of PACK) expect(['dev', 'data', 'web', 'security', 'design']).toContain(s.family);
  });

  it('does not reuse hand-built tool ids', () => {
    for (const s of PACK) expect(HAND_BUILT).not.toContain(s.id);
  });

  it('every select default and field id is well-formed', () => {
    for (const s of PACK) {
      const ids = s.fields.map(f => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const f of s.fields) if (f.type === 'select') expect(Array.isArray(f.options) && f.options.length).toBeTruthy();
    }
  });
});

describe('every example produces its documented result', () => {
  for (const s of PACK) {
    s.examples.forEach((ex, i) => {
      it(`${s.id} example ${i + 1}`, () => {
        const out = run(s.id, ex.in);
        if ('out' in ex) expect(out).toEqual(ex.out);
        else expect(ToolboxPacks.asText(out)).toMatch(ex.match);
      });
    });
  }
});

describe('every tool is synchronous with its default values', () => {
  for (const s of PACK) {
    it(`${s.id} defaults`, () => {
      let out;
      try {
        out = s.run(ToolboxPacks.defaults(s));
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e.message.length).toBeGreaterThan(0);
        return;
      }
      expect(out && typeof out.then).not.toBe('function');
      expect(typeof out === 'string' || Array.isArray(out)).toBe(true);
      if (Array.isArray(out)) for (const r of out) { expect(r).toHaveLength(2); expect(typeof r[1]).toBe('string'); }
    });
  }
});

describe('HMAC / SHA against Node crypto', () => {
  const rnd = (n) => crypto.randomBytes(n);
  it('matches crypto.createHmac for many key and message lengths', () => {
    for (const algo of ['sha1', 'sha256']) {
      for (const keyLen of [0, 1, 20, 63, 64, 65, 131]) {
        for (const msgLen of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
          const key = rnd(keyLen), msg = rnd(msgLen).toString('base64');
          const want = crypto.createHmac(algo, key).update(msg, 'utf8').digest('hex');
          const got = keyLen === 0 ? null : run('sec-hmac', { msg, key: key.toString('hex'), keyFormat: 'hex', algo });
          if (got !== null) expect(got).toBe(want);
        }
      }
    }
  });
  it('handles non-ASCII messages as UTF-8', () => {
    const msg = 'héllo 😀 — ✓';
    expect(run('sec-hmac', { msg, key: 'k' })).toBe(crypto.createHmac('sha256', 'k').update(msg, 'utf8').digest('hex'));
  });
  it('rejects an empty key and bad hex', () => {
    expect(() => run('sec-hmac', { key: '' })).toThrow(/secret key/);
    expect(() => run('sec-hmac', { key: 'abc', keyFormat: 'hex' })).toThrow(/even number/);
  });
});

describe('TOTP — RFC 6238 appendix B', () => {
  const SHA1_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  const SHA256_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA'; // "12345678901234567890123456789012"
  const VECTORS = [
    ['59', '94287082', '46119246'], ['1111111109', '07081804', '68084774'], ['1111111111', '14050471', '67062674'],
    ['1234567890', '89005924', '91819424'], ['2000000000', '69279037', '90698825'], ['20000000000', '65353130', '77737706'],
  ];
  for (const [t, sha1, sha256] of VECTORS) {
    it(`T=${t}`, () => {
      expect(rowsOf(run('sec-totp', { secret: SHA1_SEED, time: t, digits: '8', algo: 'sha1' })).Code).toBe(sha1);
      expect(rowsOf(run('sec-totp', { secret: SHA256_SEED, time: t, digits: '8', algo: 'sha256' })).Code).toBe(sha256);
      expect(rowsOf(run('sec-totp', { secret: SHA1_SEED.toLowerCase().replace(/(.{4})/g, '$1 '), time: t, digits: '6' })).Code).toBe(sha1.slice(2));
    });
  }
  it('rejects bad secrets and times', () => {
    expect(() => run('sec-totp', { secret: 'ABC1' })).toThrow(/"1" is not a Base32/);
    expect(() => run('sec-totp', { time: '12.5' })).toThrow(/whole number/);
    expect(() => run('sec-totp', { secret: '' })).toThrow(/Base32 secret/);
  });
});

describe('Base32 / checksums', () => {
  it('RFC 4648 vectors and round trip', () => {
    const V = { '': '', f: 'MY======', fo: 'MZXQ====', foo: 'MZXW6===', foob: 'MZXW6YQ=', fooba: 'MZXW6YTB', foobar: 'MZXW6YTBOI======' };
    for (const [plain, enc] of Object.entries(V)) {
      expect(run('sec-base32', { mode: 'encode', text: plain })).toBe(enc);
      if (plain) expect(rowsOf(run('sec-base32', { mode: 'decode', text: enc })).Text).toBe(plain);
    }
    const s = 'Ünïcødé ✓ 😀';
    expect(rowsOf(run('sec-base32', { mode: 'decode', text: run('sec-base32', { mode: 'encode', text: s }) })).Text).toBe(s);
  });
  it('hex/base64 agree with Buffer', () => {
    const b = crypto.randomBytes(37);
    expect(run('sec-hex-base64', { mode: 'toB64', text: b.toString('hex') })).toBe(b.toString('base64'));
    expect(run('sec-hex-base64', { mode: 'toHex', text: b.toString('base64') })).toBe(b.toString('hex'));
    expect(() => run('sec-hex-base64', { mode: 'toHex', text: 'abc$' })).toThrow(/Base64 may only/);
  });
  it('CRC-32 of hex input', () => {
    expect(rowsOf(run('sec-crc32', { format: 'hex', text: '31 32 33 34 35 36 37 38 39' })).Hex).toBe('CBF43926');
  });
});

describe('CSV edge cases', () => {
  it('keeps delimiters, doubled quotes and newlines inside quoted fields', () => {
    const csv = 'a,b\n"x, ""y""","multi\r\nline"\n,""';
    expect(JSON.parse(run('data-csv-json', { csv, types: false }))).toEqual([{ a: 'x, "y"', b: 'multi\r\nline' }, { a: '', b: '' }]);
  });
  it('JSON → CSV → JSON round trips awkward values', () => {
    const rows = [{ a: 'x,y', b: 'q"t', c: 'l1\nl2' }, { a: ' lead', b: '', c: '=1' }];
    const csv = run('data-json-csv', { json: JSON.stringify(rows) });
    expect(JSON.parse(run('data-csv-json', { csv, types: false }))).toEqual(rows);
  });
  it('reports malformed CSV clearly', () => {
    expect(() => run('data-csv-json', { csv: 'a,b\n"open,2' })).toThrow(/never closed/);
    expect(() => run('data-csv-json', { csv: 'a,b\n"x"y,2' })).toThrow(/after a closing quote/);
    expect(() => run('data-csv-json', { csv: 'a,b\n1,2,3' })).toThrow(/Row 2 has 3 field/);
    expect(() => run('data-csv-sort', { col: 'missing' })).toThrow(/No column named/);
    expect(() => run('data-csv-column', { cols: '9' })).toThrow(/Column 9 does not exist/);
  });
});

describe('IPv4 subnet edge cases', () => {
  it('/0 covers everything', () => {
    const r = rowsOf(run('web-subnet', { cidr: '1.2.3.4/0' }));
    expect(r.Network).toBe('0.0.0.0/0');
    expect(r.Broadcast).toBe('255.255.255.255');
    expect(r['Usable hosts']).toBe('4,294,967,294');
  });
  it('/31 and /32 have no broadcast and correct host counts', () => {
    expect(rowsOf(run('web-subnet', { cidr: '192.168.0.1/31' }))).toMatchObject({ Network: '192.168.0.0/31', 'First host': '192.168.0.0', 'Last host': '192.168.0.1', 'Usable hosts': '2' });
    expect(rowsOf(run('web-subnet', { cidr: '203.0.113.9/32' }))).toMatchObject({ 'Usable hosts': '1', 'Total addresses': '1', Type: 'Documentation' });
  });
  it('/30 has two usable hosts', () => {
    expect(rowsOf(run('web-subnet', { cidr: '10.1.1.6/30' }))).toMatchObject({ Network: '10.1.1.4/30', Broadcast: '10.1.1.7', 'First host': '10.1.1.5', 'Last host': '10.1.1.6', 'Usable hosts': '2' });
  });
  it('rejects bad input', () => {
    expect(() => run('web-subnet', { cidr: '10.0.0.1/33' })).toThrow(/0-32/);
    expect(() => run('web-subnet', { cidr: '10.0.0.1 255.0.255.0' })).toThrow(/contiguous/);
    expect(() => run('web-subnet', { cidr: '10.0.0.256/8' })).toThrow(/0-255/);
    expect(() => run('web-subnet', { cidr: '010.0.0.1/8' })).toThrow(/Leading zeros/);
  });
});

describe('IPv6', () => {
  it('compresses per RFC 5952', () => {
    const c = (ip) => rowsOf(run('web-ipv6', { ip })).Compressed;
    expect(c('0:0:0:0:0:0:0:0')).toBe('::');
    expect(c('0:0:0:0:0:0:0:1')).toBe('::1');
    expect(c('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1'); // a single zero group is not compressed
    expect(c('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1'); // longest run wins
    expect(c('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1'); // first of equal runs
    expect(c('[FE80::A]')).toBe('fe80::a');
  });
  it('rejects malformed addresses', () => {
    expect(() => run('web-ipv6', { ip: '1::2::3' })).toThrow(/only once/);
    expect(() => run('web-ipv6', { ip: '1:2:3:4:5:6:7:8:9' })).toThrow(/8 groups/);
    expect(() => run('web-ipv6', { ip: '12345::' })).toThrow(/not a valid IPv6 group/);
    expect(() => run('web-ipv6', { ip: 'fe80::1%eth0' })).toThrow(/Zone/);
  });
});

describe('YAML', () => {
  const back = (value) => JSON.parse(run('dev-yaml-json', { yaml: run('dev-json-yaml', { json: JSON.stringify(value) }) }));
  it('round trips values that need quoting', () => {
    const v = {
      s: ['yes', 'No', 'null', '~', '', ' lead', 'trail ', '1.0', '0x1F', '-x', '#hash', 'a: b', 'c #d', 'multi\nline', 'tab\there', 'ünï ✓', "it's", '"q"', '[x]', '{y}', '*z', '&w', '!t', '|p', '>f', '%d', '@a', '`b'],
      n: [0, -1, 2.5, 1e21], b: [true, false], z: null, e: {}, a: [], nest: [[1, [2]], [{ k: { j: [] } }]], 'key: colon': 1, '': 'empty key',
    };
    expect(back(v)).toEqual(v);
  });
  it('throws clearly on unsupported or broken YAML', () => {
    const bad = (yaml, re) => expect(() => run('dev-yaml-json', { yaml })).toThrow(re);
    bad('a: &x 1', /anchors/);
    bad('a: *x', /aliases/);
    bad('a: !!str 1', /tags/);
    bad('a: |\n  text', /block scalars/);
    bad('a:\n\tb: 1', /tabs/);
    bad('a: 1\na: 2', /duplicate key "a"/);
    bad('a: 1\n   b: 2', /Line 2/);
    bad('a: 1\n---\nb: 2', /multiple documents/);
    bad('a: "open', /never closed/);
    bad('a: [1, [2]]', /nested flow/);
    bad('a: [1, 2', /not closed/);
    bad('a: .nan', /no JSON equivalent/);
    bad('a: "bad \\q"', /unknown escape/);
    bad('just: fine\nno colon here', /expected "key: value"/);
    bad('', /Enter some YAML/);
    bad('# only a comment\n\n', /empty/);
  });
});

describe('XML', () => {
  it('rejects malformed XML with a line number', () => {
    const bad = (xml, re) => expect(() => run('data-xml-json', { xml })).toThrow(re);
    bad('<a><b></a>', /expected <\/b> but found <\/a>/);
    bad('<a>', /never closed/);
    bad('<a/><b/>', /only one root/);
    bad('<a x=1/>', /must be quoted/);
    bad('<a>&nbsp;</a>', /unknown entity/);
    bad('<a>fish & chips</a>', /must start an entity/);
    bad('<a x="1" x="2"/>', /duplicate attribute/);
    bad('<a/>text', /only one root/);
    bad('<a>\n<b>\n</c></a>', /Line 3/);
    bad('<!DOCTYPE a [<!ENTITY x "y">]><a/>', /internal subset/);
    bad('   ', /some XML/);
  });
  it('JSON → XML → JSON round trips', () => {
    const v = { cfg: { '@version': '2', item: [{ '@id': 'a', '#text': 'x & y' }, 'plain <b>'], nested: { deep: 'ok' } } };
    const xml = run('data-json-xml', { json: JSON.stringify(v) });
    expect(JSON.parse(run('data-xml-json', { xml }))).toEqual(v);
  });
  it('rejects JSON keys that cannot be element names', () => {
    expect(() => run('data-json-xml', { json: '{"a b":1}' })).toThrow(/not a valid XML element name/);
  });
});

describe('other tricky tools', () => {
  it('JSON path reports where it failed', () => {
    expect(() => run('dev-json-path', { path: 'store.nope' })).toThrow(/No "nope" at \$\.store/);
    expect(() => run('dev-json-path', { path: 'store.book[5]' })).toThrow(/out of range/);
    expect(() => run('dev-json-path', { path: 'store..book' })).toThrow(/Recursive/);
  });
  it('semver rejects non-semver and orders prereleases per spec', () => {
    expect(() => run('dev-semver', { a: '1.2' })).toThrow(/semantic versioning/);
    const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 0; i < order.length - 1; i++) expect(rowsOf(run('dev-semver', { a: order[i], b: order[i + 1] })).Compare).toBe(`${order[i]} < ${order[i + 1]}`);
  });
  it('number base range checks', () => {
    expect(() => run('dev-number-base', { value: '256', bits: '8' })).toThrow(/does not fit/);
    expect(() => run('dev-number-base', { value: '-129', bits: '8' })).toThrow(/does not fit/);
    expect(rowsOf(run('dev-number-base', { value: '-9223372036854775808', bits: '64' }))['64-bit pattern (hex)']).toBe('8000000000000000');
  });
  it('SQL formatter leaves strings and comments alone', () => {
    expect(run('dev-sql-format', { sql: "select 'and or' -- where\nfrom t" })).toBe("SELECT 'and or' -- where\nFROM t");
    expect(() => run('dev-sql-format', { sql: "select 'open" })).toThrow(/never closed/);
    expect(run('dev-sql-format', { sql: 'select 1; select 2' })).toBe('SELECT 1;\n\nSELECT 2');
  });
  it('CSS minify keeps strings and fails on unclosed comments', () => {
    expect(run('dev-css-format', { mode: 'minify', css: 'a::after { content: " /* not a comment */ " }' })).toBe('a::after{content:" /* not a comment */ "}');
    expect(() => run('dev-css-format', { mode: 'minify', css: 'a{} /* open' })).toThrow(/never closed/);
    expect(() => run('dev-css-format', { mode: 'beautify', css: 'a{color:red' })).toThrow(/never closed/);
  });
  it('curl converter rejects unknown options', () => {
    expect(() => run('dev-curl-fetch', { cmd: 'curl --proxy x https://a' })).toThrow(/Unsupported curl option "--proxy"/);
    expect(() => run('dev-curl-fetch', { cmd: 'wget https://a' })).toThrow(/start with "curl"/);
    expect(run('dev-curl-fetch', { cmd: 'curl -k -XPUT https://a' })).toBe('// Note: -k (skip TLS certificate checks) has no fetch() equivalent\nfetch("https://a", {\n  method: "PUT"\n});');
  });
  it('IBAN mod-97 catches a transposition', () => {
    expect(rowsOf(run('sec-iban', { iban: 'GB82 WEST 1234 5698 7654 23' })).Valid).toBe('No');
  });
});
