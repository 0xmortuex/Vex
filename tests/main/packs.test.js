import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const packs = require('../../src/main/packs.js');
const { createPackStore } = require('../../src/main/packs-store.js');

const GOOD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g1"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><circle cx="12" cy="12" r="9" fill="url(#g1)" stroke="#222" stroke-width="2"/><path d="M4 4 L20 20" stroke="#fff"/></svg>';

const everyItem = () => ([
  { type: 'theme', id: 't1', name: 'Night owl', colors: { background: '#101820', surface: '#1b2733', text: '#e8eef4', primary: '#4ea1ff' } },
  { type: 'chain', id: 'c1', name: 'Read it', steps: ['reading-mode', 'read-aloud'] },
  { type: 'page-action', id: 'pa1', name: 'Accept cookies', origin: 'https://example.com', source: '# go\nclick "Accept all"\nscroll to "Comments"\nwait 500\nhide selector: .newsletter\ntype selector: #q = "hello"' },
  { type: 'brief-section', id: 'b1', title: 'Reading list', blocks: [
    { kind: 'text', text: 'Good things to read.' },
    { kind: 'link', label: 'Docs', url: 'https://example.com/docs' },
    { kind: 'url-template', label: 'Search it', template: 'https://example.com/s?q={query}&from={tab-host}' },
  ] },
  { type: 'readability-preset', id: 'r1', name: 'Comfy', host: 'example.com', font: 120, contrast: 110, width: 800 },
  { type: 'sticker', id: 's1', name: 'Orb', svg: GOOD_SVG },
  { type: 'medal-frame', id: 'm1', name: 'Ring', svg: GOOD_SVG },
  { type: 'aliases', id: 'a1', name: 'Short words', entries: [{ word: 'rd', command: 'reading-mode' }] },
  { type: 'quotes', id: 'q1', name: 'Wise', kind: 'quote', entries: [{ text: 'Less is more.', by: 'Someone' }, { text: 'Go slow.' }] },
]);
const ALL_PERMS = ['runs:commands', 'runs-on:origin', 'opens:links', 'reads:tabs', 'styles:pages'];

function base(over = {}) {
  return { format: 'vex-pack', version: 1, id: 'night-owl', name: 'Night owl pack', author: 'Ada', description: 'A little of everything.', items: everyItem(), permissions: ALL_PERMS.slice(), ...over };
}
const hashed = (p) => packs.withHash(p);
const text = (p) => JSON.stringify(hashed(p));
function keys() { return packs.generateKeyPair(); }
const signed = (p, kp) => JSON.stringify(packs.signPack(p, kp.privateKeyDer));

describe('a valid pack', () => {
  it('accepts every item type and lists each one and each permission in plain words', () => {
    const r = packs.parsePack(text(base()));
    expect(r.trust).toBe('unsigned');
    expect(r.summary.items.map(i => i.type).sort()).toEqual(['aliases', 'brief-section', 'chain', 'medal-frame', 'page-action', 'quotes', 'readability-preset', 'sticker', 'theme']);
    expect(r.summary.items.every(i => i.line.length > 10)).toBe(true);
    expect(r.summary.permissions.map(p => p.id).sort()).toEqual(ALL_PERMS.slice().sort());
    expect(r.summary.items.find(i => i.type === 'page-action').line).toContain('Click the button or link with the words "Accept all"');
  });
  it('knows exactly the documented item types and permissions', () => {
    expect(packs.ITEM_TYPE_NAMES.slice().sort()).toEqual(['aliases', 'brief-section', 'chain', 'medal-frame', 'page-action', 'quotes', 'readability-preset', 'sticker', 'theme']);
    expect(Object.keys(packs.PERMISSIONS).sort()).toEqual(ALL_PERMS.slice().sort());
  });
  it('a signed pack from an unknown key is "unknown-key", from a trusted key "trusted"', () => {
    const kp = keys();
    const t = signed(base(), kp);
    expect(packs.parsePack(t).trust).toBe('unknown-key');
    expect(packs.parsePack(t).fingerprint).toBe(kp.fingerprint);
    expect(packs.parsePack(t, { trustedKeys: new Set([kp.fingerprint]) }).trust).toBe('trusted');
  });
  it('serializePack output reads back to the same pack', () => {
    const r = packs.parsePack(text(base()));
    expect(packs.parsePack(packs.serializePack(r.pack)).hash).toBe(r.hash);
  });
  it('the canonical hash does not depend on key order', () => {
    const a = packs.contentHash(base());
    const b = packs.contentHash(Object.fromEntries(Object.entries(base()).reverse()));
    expect(a).toBe(b);
  });
  it('rebuilds the SVG from the allow-list', () => {
    expect(packs.sanitizeSvg(GOOD_SVG)).toContain('<circle');
  });
});

// The hostile corpus: every one of these must be refused with an explicit,
// coded error, and none may be accepted, swallowed or partly applied.
describe('hostile pack corpus', () => {
  const refuse = (t, code) => {
    let err;
    try { packs.parsePack(t); } catch (e) { err = e; }
    expect(err, 'was accepted').toBeTruthy();
    expect(err).toBeInstanceOf(packs.PackError);
    expect(err.message.length).toBeGreaterThan(5);
    if (code) expect(err.code).toBe(code);
  };
  const withItem = (item, perms = []) => text(base({ items: [item], permissions: perms }));
  const svgPack = (svg) => withItem({ type: 'sticker', id: 's1', name: 'x', svg });

  describe('script and active content in SVG', () => {
    const cases = {
      'script element': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'onload handler': '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="5"/></svg>',
      'onclick on a child': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" onclick="x()"/></svg>',
      'a href javascript': '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><circle r="5"/></a></svg>',
      'use with data href': '<svg xmlns="http://www.w3.org/2000/svg"><use href="data:image/svg+xml;base64,AAAA"/></svg>',
      'image element': '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
      'foreignObject': '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>',
      'style attribute': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" style="fill:url(https://evil.example)"/></svg>',
      'style element': '<svg xmlns="http://www.w3.org/2000/svg"><style>*{fill:red}</style></svg>',
      'xlink href': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" xlink:href="javascript:1"/></svg>',
      'doctype and entity': '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>',
      'cdata': '<svg xmlns="http://www.w3.org/2000/svg"><![CDATA[<script>]]></svg>',
      'comment': '<svg xmlns="http://www.w3.org/2000/svg"><!-- hi --></svg>',
      'processing instruction': '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      'external url in fill': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" fill="url(https://evil.example/x#a)"/></svg>',
      'fill points at nothing': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" fill="url(#missing)"/></svg>',
      'wrong namespace': '<svg xmlns="http://evil.example/ns"><circle r="5"/></svg>',
      'text content': '<svg xmlns="http://www.w3.org/2000/svg">hello</svg>',
      'nested svg': '<svg xmlns="http://www.w3.org/2000/svg"><svg><circle r="5"/></svg></svg>',
      'two roots': '<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>',
      'unquoted attribute': '<svg xmlns="http://www.w3.org/2000/svg"><circle r=5/></svg>',
      'mismatched tags': '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
      'upper-case SCRIPT': '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>1</SCRIPT></svg>',
      'namespaced script': '<svg xmlns="http://www.w3.org/2000/svg"><svg:script>1</svg:script></svg>',
      'entity in attribute': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="&#106;avascript:1"/></svg>',
      'javascript in a value': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" fill="javascript"/></svg>',
      'null byte': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5\u0000"/></svg>',
      'animate element': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"><animate attributeName="href" to="javascript:1"/></circle></svg>',
      'set element': '<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="onmouseover" to="x"/></svg>',
    };
    for (const [name, svg] of Object.entries(cases)) it(name, () => refuse(svgPack(svg)));
    it('an SVG over 16 KB', () => refuse(svgPack('<svg xmlns="http://www.w3.org/2000/svg">' + '<g/>'.repeat(5000) + '</svg>'), 'svg-too-large'));
    it('too many elements', () => refuse(svgPack('<svg xmlns="http://www.w3.org/2000/svg">' + '<g/>'.repeat(401) + '</svg>'), 'svg-too-large'));
    it('too deeply nested', () => refuse(svgPack('<svg xmlns="http://www.w3.org/2000/svg">' + '<g>'.repeat(14) + '</g>'.repeat(14) + '</svg>'), 'svg-too-deep'));
  });

  describe('prototype pollution and forbidden keys', () => {
    it('__proto__ at the top level', () => refuse('{"__proto__":{"polluted":true},' + text(base()).slice(1), 'forbidden-key'));
    it('constructor in an item', () => refuse(text(base()).replace('"type":"theme"', '"constructor":{"prototype":{"x":1}},"type":"theme"'), 'forbidden-key'));
    it('prototype key in colours', () => refuse(text(base()).replace('"background":', '"prototype":"#fff","background":'), 'forbidden-key'));
    it('__proto__ written as an escape', () => refuse(text(base()).replace('"theme"', '"theme","\\u005f_proto__":1'), 'forbidden-key'));
    it('does not pollute Object.prototype even while refusing', () => {
      try { packs.parsePack('{"__proto__":{"polluted":"yes"}}'); } catch { /* expected */ }
      expect({}.polluted).toBeUndefined();
    });
    it('an unknown top-level field', () => refuse(text(base()).replace('"format"', '"extra":1,"format"'), 'unknown-field'));
    it('an unknown item field', () => refuse(text(base()).replace('"type":"theme"', '"onload":"x","type":"theme"'), 'unknown-field'));
  });

  describe('size and nesting', () => {
    it('huge array nesting', () => refuse('{"format":"vex-pack","version":1,"x":' + '['.repeat(20000) + ']'.repeat(20000) + '}', 'too-deep'));
    it('huge object nesting', () => refuse('{"a":'.repeat(5000) + '1' + '}'.repeat(5000), 'too-deep'));
    it('over 256 KB', () => refuse(text(base({ description: 'x' })) + ' '.repeat(262144), 'too-large'));
    it('a long string field', () => refuse(withItem({ type: 'quotes', id: 'q', name: 'x', kind: 'quote', entries: [{ text: 'a'.repeat(281) }] }), 'too-long'));
    it('over 200 items', () => {
      const items = Array.from({ length: 201 }, (_, i) => ({ type: 'quotes', id: 'q' + i, name: 'x', kind: 'quote', entries: [{ text: 'hi' }] }));
      refuse(text(base({ items, permissions: [] })), 'too-many-items');
    });
    it('too many values overall', () => refuse('{"a":[' + '1,'.repeat(25000) + '1]}', 'too-complex'));
    it('not an object', () => refuse('[1,2,3]', 'bad-json'));
    it('trailing garbage', () => refuse(text(base()) + 'x', 'bad-json'));
    it('NaN and Infinity', () => refuse('{"a":NaN}', 'bad-json'));
  });

  describe('unicode tricks', () => {
    it('right-to-left override in the name', () => refuse(text(base({ name: 'Safe\u202Efdp.exe' })), 'bad-text'));
    it('bidi isolate in an item name', () => refuse(withItem({ type: 'quotes', id: 'q', name: 'a\u2066b', kind: 'quote', entries: [{ text: 'hi' }] }), 'bad-text'));
    it('zero-width space in the author', () => refuse(text(base({ author: 'Ad\u200Ba' })), 'bad-text'));
    it('zero-width joiner / BOM inside', () => refuse(text(base({ name: 'a\uFEFFb' })), 'bad-text'));
    it('control character', () => refuse(text(base({ name: 'a\u0007b' })), 'bad-text'));
    it('lone surrogate', () => refuse(text(base({ name: 'a\uD800b' })), 'bad-text'));
    it('language tag characters', () => refuse(text(base({ name: 'a\u{E0041}b' })), 'bad-text'));
    it('a newline in a one-line field', () => refuse(text(base({ name: 'a\nb' })), 'bad-text'));
    it('leading space', () => refuse(text(base({ name: ' padded' })), 'bad-text'));
    it('line separator in a quote', () => refuse(withItem({ type: 'quotes', id: 'q', name: 'x', kind: 'quote', entries: [{ text: 'a\u2028b' }] }), 'bad-text'));
    it('a bidi override smuggled into a page-action origin', () => refuse(withItem({ type: 'page-action', id: 'p', name: 'x', origin: 'https://example.com\u202E', source: 'wait 10' }, ['runs-on:origin'])));
  });

  describe('ids and path traversal', () => {
    for (const id of ['../evil', '..', 'a/b', 'a\\b', '..\\..\\x', 'a..b', 'con', 'CON', 'nul.txt', 'aux', 'x', 'a'.repeat(65), 'UPPER', 'sp ace', '%2e%2e%2f', '.hidden', 'trailing.', 'c:evil', '']) {
      it('pack id ' + JSON.stringify(id.slice(0, 20)), () => refuse(text(base({ id })), 'bad-id'));
    }
    for (const id of ['../x', 'a/b', 'A', '', 'x'.repeat(49), '__proto__x', 'a b']) {
      it('item id ' + JSON.stringify(id.slice(0, 20)), () => refuse(withItem({ type: 'quotes', id, name: 'x', kind: 'quote', entries: [{ text: 'hi' }] }), 'bad-id'));
    }
  });

  describe('signatures', () => {
    it('a flipped signature byte', () => {
      const kp = keys();
      const o = JSON.parse(signed(base(), kp));
      const sig = Buffer.from(o.signature.sig, 'base64'); sig[0] ^= 1; o.signature.sig = sig.toString('base64');
      refuse(JSON.stringify(o), 'bad-signature');
    });
    it('a signature of different content (hash recomputed, signature spliced)', () => {
      const kp = keys();
      const a = JSON.parse(signed(base(), kp));
      const b = hashed(base({ name: 'Evil twin' }));
      refuse(JSON.stringify({ ...b, signature: a.signature }), 'bad-signature');
    });
    it('content edited after signing (hash left alone)', () => {
      const kp = keys();
      const o = JSON.parse(signed(base(), kp));
      o.name = 'Changed after signing';
      refuse(JSON.stringify(o), 'hash-mismatch');
    });
    it('content edited and hash fixed, signature left alone', () => {
      const kp = keys();
      const o = JSON.parse(signed(base(), kp));
      o.description = 'sneaky';
      const fixed = packs.withHash(o);
      refuse(JSON.stringify({ ...fixed, signature: o.signature }), 'bad-signature');
    });
    it('a different key claims the same signature', () => {
      const a = keys(), b = keys();
      const o = JSON.parse(signed(base(), a));
      o.signature.key = b.publicKey;
      refuse(JSON.stringify(o), 'bad-signature');
    });
    it('a wrong algorithm', () => {
      const kp = keys();
      const o = JSON.parse(signed(base(), kp)); o.signature.alg = 'none';
      refuse(JSON.stringify(o), 'bad-signature');
    });
    it('a short key and a non-base64 signature', () => {
      const kp = keys();
      const o = JSON.parse(signed(base(), kp)); o.signature.key = 'AAAA';
      refuse(JSON.stringify(o), 'bad-signature');
      const p = JSON.parse(signed(base(), kp)); p.signature.sig = '!!!';
      refuse(JSON.stringify(p), 'bad-signature');
    });
    it('a missing hash', () => { const o = hashed(base()); delete o.hash; refuse(JSON.stringify(o), 'missing-field'); });
    it('a wrong hash on an unsigned pack', () => refuse(JSON.stringify({ ...hashed(base()), hash: '0'.repeat(64) }), 'hash-mismatch'));
  });

  describe('duplicates', () => {
    it('two items with the same id and type', () => {
      const q = { type: 'quotes', id: 'q', name: 'x', kind: 'quote', entries: [{ text: 'hi' }] };
      refuse(text(base({ items: [q, { ...q, name: 'y' }], permissions: [] })), 'duplicate-id');
    });
    it('a repeated JSON key', () => refuse(text(base()).replace('"version":1', '"version":1,"version":1'), 'duplicate-key'));
    it('a repeated permission', () => refuse(text(base({ permissions: [...ALL_PERMS, 'opens:links'] })), 'duplicate-id'));
    it('a repeated alias word', () => refuse(withItem({ type: 'aliases', id: 'a', name: 'x', entries: [{ word: 'rd', command: 'reading-mode' }, { word: 'rd', command: 'zoom-in' }] }, ['runs:commands']), 'duplicate-id'));
  });

  describe('item type confusion', () => {
    it('an item type that is code', () => { for (const type of ['script', 'js', 'eval', 'userscript', 'extension', 'html', 'constructor', 'toString', 'hasOwnProperty']) refuse(withItem({ type, id: 'x', name: 'n', code: 'alert(1)' }), 'unknown-item-type'); });
    it('type is not a string', () => { refuse(withItem({ type: { a: 1 }, id: 'x' }), 'unknown-item-type'); refuse(withItem({ type: ['theme'], id: 'x' }), 'unknown-item-type'); });
    it('a theme carrying steps', () => refuse(withItem({ type: 'theme', id: 't', name: 'x', colors: { background: '#000', surface: '#111', text: '#fff', primary: '#08f' }, steps: ['x'] }), 'unknown-field'));
    it('a chain whose steps are a string', () => refuse(withItem({ type: 'chain', id: 'c', name: 'x', steps: 'reading-mode' }, ['runs:commands']), 'bad-type'));
    it('a quote entry that is an object with extra fields', () => refuse(withItem({ type: 'quotes', id: 'q', name: 'x', kind: 'quote', entries: [{ text: 'a', html: '<b>' }] }), 'unknown-field'));
    it('a sticker with a script source field', () => refuse(withItem({ type: 'sticker', id: 's', name: 'x', svg: GOOD_SVG, script: 'alert(1)' }), 'unknown-field'));
    it('a colour that is a CSS expression', () => refuse(withItem({ type: 'theme', id: 't', name: 'x', colors: { background: 'expression(alert(1))', surface: '#111', text: '#fff', primary: '#08f' } }), 'bad-colour'));
    it('a colour with a url()', () => refuse(withItem({ type: 'theme', id: 't', name: 'x', colors: { background: 'url(https://evil.example/a)', surface: '#111', text: '#fff', primary: '#08f' } }), 'bad-colour'));
    it('a theme missing a required colour', () => refuse(withItem({ type: 'theme', id: 't', name: 'x', colors: { background: '#000' } }), 'missing-field'));
    it('readability numbers as strings, out of range, fractional', () => {
      const r = { type: 'readability-preset', id: 'r', name: 'x', host: 'example.com', font: 120, contrast: 110, width: 800 };
      refuse(withItem({ ...r, font: '120' }, ['styles:pages']), 'bad-number');
      refuse(withItem({ ...r, font: 5000 }, ['styles:pages']), 'bad-number');
      refuse(withItem({ ...r, contrast: 110.5 }, ['styles:pages']), 'bad-number');
      refuse(withItem({ ...r, width: 5 }, ['styles:pages']), 'bad-number');
      refuse(withItem({ ...r, host: 'example.com/path' }, ['styles:pages']), 'bad-host');
      refuse(withItem({ ...r, host: 'localhost' }, ['styles:pages']), 'bad-host');
    });
    it('quote kind that is not quote or fortune', () => refuse(withItem({ type: 'quotes', id: 'q', name: 'x', kind: 'html', entries: [{ text: 'hi' }] }), 'bad-type'));
  });

  describe('page actions', () => {
    const pa = (over) => withItem({ type: 'page-action', id: 'p', name: 'x', origin: 'https://example.com', source: 'wait 10', ...over }, ['runs-on:origin']);
    it('a javascript: origin', () => refuse(pa({ origin: 'javascript:alert(1)' }), 'bad-origin'));
    it('a data: origin', () => refuse(pa({ origin: 'data:text/html,hi' }), 'bad-origin'));
    it('an http origin', () => refuse(pa({ origin: 'http://example.com' }), 'bad-origin'));
    it('an origin with a path', () => refuse(pa({ origin: 'https://example.com/a' }), 'bad-origin'));
    it('an origin with credentials', () => refuse(pa({ origin: 'https://user:pw@example.com' }), 'bad-origin'));
    it('a wildcard origin', () => refuse(pa({ origin: 'https://*.example.com' }), 'bad-origin'));
    it('an origin with a port above 65535', () => refuse(pa({ origin: 'https://example.com:99999' }), 'bad-origin'));
    it('JavaScript in the script', () => refuse(pa({ source: 'fetch("https://evil.example")' }), 'bad-step'));
    it('eval in the script', () => refuse(pa({ source: 'eval("1")' }), 'bad-step'));
    it('a javascript: link click', () => refuse(pa({ source: 'navigate "javascript:alert(1)"' }), 'bad-step'));
    it('a wait over 5 s', () => refuse(pa({ source: 'wait 6000' }), 'bad-step'));
    it('41 steps', () => refuse(pa({ source: 'wait 1\n'.repeat(41) }), 'bad-step'));
    it('an empty script', () => refuse(pa({ source: '# nothing\n' }), 'bad-step'));
    it('a script over 4000 characters', () => refuse(pa({ source: '# ' + 'a'.repeat(4000) }), 'too-long'));
    it('a carriage return in the script', () => refuse(pa({ source: 'wait 1\r\nwait 2' }), 'bad-text'));
  });

  describe('commands, links and templates', () => {
    for (const cmd of ['clear-browsing-data', 'vault-export', 'install-extension', 'sync-now', 'app-quit', 'restart', 'passkeys-list', 'download-pack', 'delete-all']) {
      it('a chain that runs ' + cmd, () => refuse(withItem({ type: 'chain', id: 'c', name: 'x', steps: ['reading-mode', cmd] }, ['runs:commands']), 'dangerous-command'));
    }
    it('an alias for a dangerous command', () => refuse(withItem({ type: 'aliases', id: 'a', name: 'x', entries: [{ word: 'go', command: 'reset-everything' }] }, ['runs:commands']), 'dangerous-command'));
    it('a command id with a script in it', () => refuse(withItem({ type: 'chain', id: 'c', name: 'x', steps: ['a;alert(1)'] }, ['runs:commands']), 'bad-command'));
    it('more than 20 steps', () => refuse(withItem({ type: 'chain', id: 'c', name: 'x', steps: Array(21).fill('zoom-in') }, ['runs:commands']), 'bad-type'));
    const block = (b, perms = ['opens:links']) => withItem({ type: 'brief-section', id: 'b', title: 'x', blocks: [b] }, perms);
    it('a javascript: link', () => refuse(block({ kind: 'link', label: 'x', url: 'javascript:alert(1)' }), 'bad-url'));
    it('a data: link', () => refuse(block({ kind: 'link', label: 'x', url: 'data:text/html,<script>1</script>' }), 'bad-url'));
    it('an http: link', () => refuse(block({ kind: 'link', label: 'x', url: 'http://example.com' }), 'bad-url'));
    it('a link with credentials', () => refuse(block({ kind: 'link', label: 'x', url: 'https://user:pw@example.com' }), 'bad-url'));
    it('a file: link', () => refuse(block({ kind: 'link', label: 'x', url: 'file:///C:/Windows/win.ini' }), 'bad-url'));
    it('a template where a placeholder picks the site', () => refuse(block({ kind: 'url-template', label: 'x', template: 'https://{query}/x' }), 'bad-template'));
    it('a template with an unknown placeholder', () => refuse(block({ kind: 'url-template', label: 'x', template: 'https://example.com/{cookie}' }), 'bad-template'));
    it('a template with a stray brace', () => refuse(block({ kind: 'url-template', label: 'x', template: 'https://example.com/{' }), 'bad-template'));
    it('a block kind that is html', () => refuse(block({ kind: 'html', html: '<b>x</b>' }), 'unknown-block'));
    it('a text block with extra fields', () => refuse(block({ kind: 'text', text: 'hi', html: '<b>' }, []), 'unknown-field'));
  });

  describe('permissions', () => {
    it('an item needs a permission the pack did not declare', () => refuse(withItem({ type: 'chain', id: 'c', name: 'x', steps: ['zoom-in'] }, []), 'missing-permission'));
    it('a permission declared but unused', () => refuse(withItem({ type: 'quotes', id: 'q', name: 'x', kind: 'quote', entries: [{ text: 'hi' }] }, ['runs-on:origin']), 'unused-permission'));
    it('an unknown permission', () => refuse(withItem({ type: 'quotes', id: 'q', name: 'x', kind: 'quote', entries: [{ text: 'hi' }] }, ['full-access']), 'unknown-permission'));
    it('a tab placeholder without reads:tabs', () => refuse(withItem({ type: 'brief-section', id: 'b', title: 'x', blocks: [{ kind: 'url-template', label: 'x', template: 'https://example.com/?u={tab-url}' }] }, ['opens:links']), 'missing-permission'));
  });

  describe('envelope', () => {
    it('the wrong format', () => refuse(text(base({ format: 'vex-theme' })), 'bad-format'));
    it('a future version', () => refuse(text(base({ version: 2 })), 'bad-version'));
    it('no items', () => refuse(text(base({ items: [], permissions: [] })), 'empty'));
    it('items that are not a list', () => refuse(text(base({ items: { a: 1 }, permissions: [] })), 'bad-type'));
  });
});

describe('the pack store', () => {
  let dir, kp;
  const memFs = () => fs;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-packs-')); kp = keys(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const make = async (opts = {}) => {
    const s = createPackStore({
      dir, fs: opts.fs || memFs(), log: { error() {}, warn() {} },
      seal: (b) => Buffer.from(b).reverse(), unseal: (b) => Buffer.from(b).reverse(),
    });
    await s.load();
    return s;
  };
  const small = (over = {}) => base({ items: [{ type: 'quotes', id: 'q1', name: 'Wise', kind: 'quote', entries: [{ text: 'Less is more.' }] }, { type: 'theme', id: 't1', name: 'Night', colors: { background: '#101820', surface: '#1b2733', text: '#e8eef4', primary: '#4ea1ff' } }], permissions: [], ...over });

  it('previews, installs, lists and applies only enabled items', async () => {
    const s = await make();
    const pv = await s.preview(text(small()), 'file');
    expect(pv.trust).toBe('unsigned');
    expect(s.list().packs).toHaveLength(0);
    const row = await s.install(pv.token);
    expect(row.enabled).toBe(true);
    expect(s.enabledItems().map(x => x.item.id).sort()).toEqual(['q1', 't1']);
    await s.setEnabled('night-owl', false);
    expect(s.enabledItems()).toEqual([]);
    await s.setEnabled('night-owl', true);
    await s.setGlobalEnabled(false);
    expect(s.enabledItems()).toEqual([]);
    await s.setGlobalEnabled(true);
    expect(s.enabledItems()).toHaveLength(2);
  });
  it('an install token works once and the window cannot install content it did not preview', async () => {
    const s = await make();
    const pv = await s.preview(text(small()));
    await s.install(pv.token);
    await expect(s.install(pv.token)).rejects.toThrow(/no longer waiting/);
    await expect(s.install('0'.repeat(32))).rejects.toThrow(/no longer waiting/);
  });
  it('survives a restart and applies nothing from a tampered file', async () => {
    let s = await make();
    await s.install((await s.preview(text(small()))).token);
    s = await make();
    expect(s.list().packs).toHaveLength(1);
    const f = path.join(dir, 'installed', 'night-owl.json');
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    rec.pack.items[0].entries[0].text = 'Evil';
    fs.writeFileSync(f, JSON.stringify(rec));
    s = await make();
    expect(s.list().packs).toHaveLength(0);
    expect(s.list().damaged[0].error).toMatch(/hash/);
    expect(s.enabledItems()).toEqual([]);
  });
  it('uninstall removes exactly the pack file', async () => {
    const s = await make();
    await s.install((await s.preview(text(small()))).token);
    await s.install((await s.preview(text(small({ id: 'other-pack' })))).token);
    await s.uninstall('night-owl');
    expect(fs.readdirSync(path.join(dir, 'installed'))).toEqual(['other-pack.json']);
    expect(s.list().packs.map(p => p.id)).toEqual(['other-pack']);
  });
  it('a failed log write rolls an install back to nothing', async () => {
    const failing = { ...fs, promises: { ...fs.promises, writeFile: async (f, d, e) => { if (String(f).includes('log.json')) throw new Error('disk full'); return fs.promises.writeFile(f, d, e); } } };
    const s = await make({ fs: failing });
    const pv = await s.preview(text(small()));
    await expect(s.install(pv.token)).rejects.toThrow(/not installed.*disk full/);
    expect(fs.readdirSync(path.join(dir, 'installed'))).toEqual([]);
    expect(s.list().packs).toHaveLength(0);
  });
  it('a failed log write rolls an uninstall back to the same bytes', async () => {
    let s = await make();
    await s.install((await s.preview(text(small()))).token);
    const f = path.join(dir, 'installed', 'night-owl.json');
    const before = fs.readFileSync(f);
    const failing = { ...fs, promises: { ...fs.promises, writeFile: async (p, d, e) => { if (String(p).includes('log.json')) throw new Error('disk full'); return fs.promises.writeFile(p, d, e); } } };
    s = await make({ fs: failing });
    await expect(s.uninstall('night-owl')).rejects.toThrow(/not removed/);
    expect(fs.readFileSync(f).equals(before)).toBe(true);
    expect(s.list().packs).toHaveLength(1);
  });
  it('a failed log write on a replace restores the old pack exactly', async () => {
    let s = await make();
    await s.install((await s.preview(text(small()))).token);
    const f = path.join(dir, 'installed', 'night-owl.json');
    const before = fs.readFileSync(f);
    const failing = { ...fs, promises: { ...fs.promises, writeFile: async (p, d, e) => { if (String(p).includes('log.json')) throw new Error('disk full'); return fs.promises.writeFile(p, d, e); } } };
    s = await make({ fs: failing });
    const pv = await s.preview(text(small({ name: 'Replacement' })));
    await expect(s.install(pv.token)).rejects.toThrow(/disk full/);
    expect(fs.readFileSync(f).equals(before)).toBe(true);
  });
  it('refuses to replace a signed pack with another key or with an unsigned one', async () => {
    const s = await make();
    await s.install((await s.preview(signed(small(), kp))).token);
    const other = keys();
    const pv1 = await s.preview(signed(small({ name: 'Hijack' }), other));
    await expect(s.install(pv1.token)).rejects.toThrow(/different key/);
    const pv2 = await s.preview(text(small({ name: 'Unsigned hijack' })));
    await expect(s.install(pv2.token)).rejects.toThrow(/different key|unsigned/);
    expect(s.list().packs[0].name).toBe('Night owl pack');
  });
  it('trust: unknown-key until trusted, then trusted for a later pack; untrust demotes', async () => {
    const s = await make();
    const pv = await s.preview(signed(small(), kp));
    expect(pv.trust).toBe('unknown-key');
    const row = await s.install(pv.token, { trustKey: true });
    expect(row.trust).toBe('trusted');
    expect((await s.preview(signed(small({ id: 'second-pack' }), kp))).trust).toBe('trusted');
    await s.untrustKey(kp.fingerprint);
    expect(s.list().packs[0].trust).toBe('unknown-key');
  });
  it('trustKey is refused for an unsigned pack', async () => {
    const s = await make();
    const pv = await s.preview(text(small()));
    await expect(s.install(pv.token, { trustKey: true })).rejects.toThrow(/not trusted yet|signed/);
  });
  it('a refused preview is logged with its code and thrown', async () => {
    const s = await make();
    await expect(s.preview('{"a":1}')).rejects.toThrow(/unknown field/i);
    expect(s.list().log.some(e => e.event === 'refused')).toBe(true);
  });
  it('authoring: export signed with your own key installs as trusted, unsigned installs as unsigned', async () => {
    const s = await make();
    await expect(s.exportPack({ id: 'my-pack', name: 'Mine', authorName: 'Me', items: small().items, sign: true })).rejects.toThrow(/signing key/);
    await s.generateAuthorKey();
    await expect(s.generateAuthorKey()).rejects.toThrow(/already have/);
    const out = await s.exportPack({ id: 'my-pack', name: 'Mine', authorName: 'Me', items: small().items, sign: true });
    expect(out.trust).toBe('trusted');
    const pv = await s.preview(out.text);
    expect(pv.trust).toBe('trusted');
    const plain = await s.exportPack({ id: 'my-plain', name: 'Plain', authorName: 'Me', items: small().items, sign: false });
    expect(JSON.parse(plain.text).signature).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, 'author.json'), 'utf8')).not.toMatch(/PRIVATE|MC4CAQAw/);
  });
  it('authoring validates what the window sends', async () => {
    const s = await make();
    await expect(s.exportPack({ id: 'my-pack', name: 'x', authorName: 'Me', items: [{ type: 'script', id: 'x', name: 'x' }], sign: false })).rejects.toThrow(/unknown type/);
    await expect(s.exportPack({ id: '../x', name: 'x', authorName: 'Me', items: small().items, sign: false })).rejects.toThrow(/lowercase/);
  });
  it('keeps at most 50 packs', async () => {
    const s = await make();
    for (let i = 0; i < 50; i++) await s.install((await s.preview(text(small({ id: 'pack-' + String(i).padStart(2, '0') })))).token);
    const pv = await s.preview(text(small({ id: 'pack-extra' })));
    await expect(s.install(pv.token)).rejects.toThrow(/at most 50/);
  });
  it('the author key without OS sealing is refused, never stored bare', async () => {
    const s = createPackStore({ dir, fs, log: { error() {} } });
    await s.load();
    await expect(s.generateAuthorKey()).rejects.toThrow(/no OS encryption/);
    expect(fs.existsSync(path.join(dir, 'author.json'))).toBe(false);
  });
  it('sticker art that reaches consumers is rebuilt from the allow-list', async () => {
    const s = await make();
    await s.install((await s.preview(text(base({ items: [{ type: 'sticker', id: 's1', name: 'Orb', svg: GOOD_SVG }], permissions: [] })))).token);
    const it1 = s.enabledItems()[0].item;
    expect(it1.svg.startsWith('<svg')).toBe(true);
    expect(it1.svg).not.toMatch(/script|onload|href/i);
  });
});

describe('sizes', () => {
  it('a 255 KB valid pack of quotes is accepted and one byte over the limit is not', () => {
    const items = [];
    let size = 0, n = 0;
    while (items.length < 190 && size < 235 * 1024) {
      const entries = Array.from({ length: 20 }, (_, i) => ({ text: ('word ' + n + '-' + i + ' ').repeat(50).slice(0, 270).trim() }));
      items.push({ type: 'quotes', id: 'q' + n, name: 'List ' + n, kind: 'quote', entries }); n++;
      size += JSON.stringify(entries).length;
    }
    const t = text(base({ items, permissions: [] }));
    const bytes = Buffer.byteLength(t);
    expect(bytes).toBeLessThanOrEqual(256 * 1024);
    expect(() => packs.parsePack(t)).not.toThrow();
    expect(() => packs.parsePack(t + ' '.repeat(256 * 1024 - bytes + 1))).toThrow(/larger than/);
  });
});
void crypto;
