// Wave 5, T3-120: a userscript's first run comes after a look at what each @grant lets it do.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../src/main/userscripts.js');
const { createUserscripts, grantReview, hasHighPower, gainsHighPower, parseMetadata, describe: describeScript } = core;

const HEADER = (lines) => '// ==UserScript==\n' + lines.map(l => '// ' + l).join('\n') + '\n// ==/UserScript==\nconsole.log(1);\n';
const SAFE = HEADER(['@name Safe', '@match https://example.com/*', '@grant GM_getValue', '@grant GM_setValue']);
const RISKY = HEADER(['@name Risky', '@match https://example.com/*', '@grant GM_xmlhttpRequest', '@grant GM_setClipboard', '@connect *']);
const meta = (src) => parseMetadata(src).meta;

function memoryStore() {
  const files = new Map();
  return { async read(k) { return files.has(k) ? JSON.parse(files.get(k)) : null; }, async write(k, d) { files.set(k, JSON.stringify(d)); return true; } };
}
async function manager() {
  const m = createUserscripts({ store: memoryStore(), log: { warn() {}, error() {} }, flushDelayMs: 5 });
  await m.load();
  return m;
}

describe('the plain-language review', () => {
  it('says what each permission does and grades it', () => {
    const r = grantReview(meta(RISKY));
    const by = Object.fromEntries(r.map(x => [x.id, x]));
    expect(by.GM_xmlhttpRequest).toMatchObject({ risk: 'high' });
    expect(by.GM_xmlhttpRequest.says).toMatch(/ANY site/);
    expect(by.GM_setClipboard.says).toMatch(/replaces what is on your clipboard/);
    expect(grantReview(meta(SAFE)).every(x => x.risk === 'low')).toBe(true);
  });
  it('a request grant with no @connect cannot reach anything and is not high', () => {
    const r = grantReview(meta(HEADER(['@name N', '@match https://a.com/*', '@grant GM_xmlhttpRequest'])));
    expect(r[0].risk).toBe('low');
  });
  it('names the sites a scoped request may reach', () => {
    const r = grantReview(meta(HEADER(['@name N', '@match https://a.com/*', '@grant GM_xmlhttpRequest', '@connect api.a.com'])));
    expect(r[0]).toMatchObject({ risk: 'high' });
    expect(r[0].says).toMatch(/only to: api\.a\.com/);
  });
  it('puts the review into the install preview lines', () => {
    const lines = describeScript(parseMetadata(RISKY)).join('\n');
    expect(lines).toMatch(/What each permission lets it do:/);
    expect(lines).toMatch(/\[high\] GM_setClipboard/);
  });
  it('knows when an update brings a new high power', () => {
    expect(hasHighPower(meta(SAFE))).toBe(false);
    expect(gainsHighPower(meta(RISKY), null)).toBe(true);
    expect(gainsHighPower(meta(RISKY), meta(RISKY))).toBe(false);
    expect(gainsHighPower(meta(RISKY), meta(SAFE))).toBe(true);
  });
});

describe('first run only after a look', () => {
  it('installs a script with a high power switched OFF unless it was reviewed', async () => {
    const m = await manager();
    const held = await m.install({ source: RISKY });
    expect(held.held).toBe(true);
    expect(m.matching('https://example.com/x', { eligible: true })).toHaveLength(0);
    const row = m.list().scripts[0];
    expect(row.enabled).toBe(false);
    expect(row.review.some(r => r.risk === 'high')).toBe(true);
    await m.setEnabled(row.id, true);
    expect(m.matching('https://example.com/x', { eligible: true })).toHaveLength(1);
  });
  it('runs a reviewed install at once, and never holds a script without a high power', async () => {
    const m = await manager();
    expect((await m.install({ source: RISKY, reviewed: true })).held).toBe(false);
    expect((await m.install({ source: SAFE })).held).toBe(false);
    expect(m.matching('https://example.com/x', { eligible: true })).toHaveLength(2);
  });
  it('holds an update that brings a new high power in, but not one that only changes the code', async () => {
    const m = await manager();
    const { id } = await m.install({ source: SAFE });
    const risky = SAFE.replace('@grant GM_setValue', '@grant GM_setValue\n// @grant GM_setClipboard');
    const u = await m.install({ source: risky, replaceId: id });
    expect(u.held).toBe(true);
    expect(m.list().scripts[0].enabled).toBe(false);
    await m.setEnabled(id, true);
    const same = await m.install({ source: risky.replace('console.log(1)', 'console.log(2)'), replaceId: id });
    expect(same.held).toBe(false);
    expect(m.list().scripts[0].enabled).toBe(true);
  });
});
