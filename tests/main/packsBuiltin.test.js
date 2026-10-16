// The packs that ship inside Vex (main/packs-builtin.js, scripts/build-builtin-packs.js), the four
// content item types they use (skills, playbook, snippets, dates), and the rule that nothing a
// person opens can pose as a built-in.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packs = require('../../src/main/packs.js');
const { createPackStore } = require('../../src/main/packs-store.js');
const { loadBuiltinPacks } = require('../../src/main/packs-builtin.js');
const { build } = require('../../scripts/build-builtin-packs.js');
const pins = require('../../src/main/builtin-packs/pins.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dirOf = path.join(root, 'src', 'main', 'builtin-packs');

const IDS = ['vex-builtin.prompts', 'vex-builtin.incident-extra', 'vex-builtin.mun-phrases', 'vex-builtin.tr-holidays'];
const loaded = () => loadBuiltinPacks({ fs });

describe('the built-in packs', () => {
  it('the files on disk are exactly what the build script makes from its data', () => {
    const files = build();
    for (const [name, text] of Object.entries(files)) {
      const have = fs.readFileSync(path.join(dirOf, name), 'utf8').replace(/\r\n/g, '\n');
      expect(have, name + ' is out of date: run node scripts/build-builtin-packs.js').toBe(text);
    }
    // And nothing else sits in the folder that the loader could be pointed at.
    expect(fs.readdirSync(dirOf).sort()).toEqual([...Object.keys(files)].sort());
  });

  it('load, are unsigned, carry the reserved ids and match their pinned hashes', () => {
    const all = loaded();
    expect(all.map(p => p.pack.id).sort()).toEqual(IDS.slice().sort());
    for (const p of all) {
      expect(p.trust).toBe('unsigned');
      expect(p.pack.signature).toBeUndefined();
      expect(p.hash).toBe(pins[p.pack.id]);
    }
  });

  it('a changed file is refused (the pin no longer matches)', () => {
    const fake = { readFileSync: (f, enc) => {
      const t = fs.readFileSync(f, enc);
      return f.endsWith('vex-builtin.mun-phrases.vexpack') ? t.replace('Point of order', 'Point of disorder') : t;
    } };
    // The content changed but the hash field still says the old thing: the pack itself is invalid.
    expect(() => loadBuiltinPacks({ fs: fake })).toThrow(/mun-phrases is not valid|hash/);
  });

  it('a file that was edited AND re-hashed still fails the pinned hash', () => {
    const real = packs.parsePack(fs.readFileSync(path.join(dirOf, 'vex-builtin.mun-phrases.vexpack'), 'utf8'), { builtin: true }).pack;
    const edited = { ...real, description: 'Something else entirely.' };
    const text = JSON.stringify(packs.withHash(edited));
    const fake = { readFileSync: (f, enc) => (f.endsWith('vex-builtin.mun-phrases.vexpack') ? text : fs.readFileSync(f, enc)) };
    expect(() => loadBuiltinPacks({ fs: fake })).toThrow(/pinned hash/);
  });

  it('a signed file, a file holding another pack and a pin outside the folder are refused', () => {
    const kp = packs.generateKeyPair();
    const real = packs.parsePack(fs.readFileSync(path.join(dirOf, 'vex-builtin.mun-phrases.vexpack'), 'utf8'), { builtin: true }).pack;
    const signed = JSON.stringify(packs.signPack(real, kp.privateKeyDer));
    const fakeSigned = { readFileSync: (f, enc) => (f.endsWith('vex-builtin.mun-phrases.vexpack') ? signed : fs.readFileSync(f, enc)) };
    expect(() => loadBuiltinPacks({ fs: fakeSigned })).toThrow(/must be unsigned/);
    const other = fs.readFileSync(path.join(dirOf, 'vex-builtin.prompts.vexpack'), 'utf8');
    const fakeOther = { readFileSync: (f, enc) => (f.endsWith('vex-builtin.mun-phrases.vexpack') ? other : fs.readFileSync(f, enc)) };
    expect(() => loadBuiltinPacks({ fs: fakeOther })).toThrow(/holds the pack/);
    expect(() => loadBuiltinPacks({ fs, pins: { 'not-reserved': 'x'.repeat(64) } })).toThrow(/does not start with/);
    expect(() => loadBuiltinPacks({ fs, pins: { 'vex-builtin.../../x': 'x' } })).toThrow();
  });
});

describe('nothing a person opens can pose as a built-in', () => {
  const asUserFile = () => {
    const real = packs.parsePack(fs.readFileSync(path.join(dirOf, 'vex-builtin.tr-holidays.vexpack'), 'utf8'), { builtin: true }).pack;
    return JSON.stringify(packs.withHash(real));
  };
  it('parsePack refuses a reserved id unless the built-in loader asks for it', () => {
    let err;
    try { packs.parsePack(asUserFile()); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(packs.PackError);
    expect(err.code).toBe('reserved-id');
  });
  it('and a built-in loader refuses an id that is not reserved', () => {
    const real = packs.parsePack(fs.readFileSync(path.join(dirOf, 'vex-builtin.tr-holidays.vexpack'), 'utf8'), { builtin: true }).pack;
    const renamed = JSON.stringify(packs.withHash({ ...real, id: 'my-holidays' }));
    expect(() => packs.parsePack(renamed, { builtin: true })).toThrow(/must start with/);
  });
  it('a signed copy with a reserved id is refused too', () => {
    const kp = packs.generateKeyPair();
    const real = packs.parsePack(fs.readFileSync(path.join(dirOf, 'vex-builtin.tr-holidays.vexpack'), 'utf8'), { builtin: true }).pack;
    expect(() => packs.parsePack(JSON.stringify(packs.signPack(real, kp.privateKeyDer)))).toThrow(/reserved/);
  });
  it('an export cannot produce one', () => {
    expect(() => packs.buildPack({ id: 'vex-builtin.mine', name: 'x', author: 'me', items: [{ type: 'quotes', id: 'q', name: 'q', kind: 'quote', entries: [{ text: 'hi' }] }] })).toThrow(/reserved/);
  });
});

describe('the store with built-in packs', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-bpacks-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const make = async () => {
    const s = createPackStore({ dir, fs, log: { error() {}, warn() {} }, builtins: loaded() });
    await s.load();
    return s;
  };

  it('lists them, all off, marked built in, with their permissions', async () => {
    const s = await make();
    const rows = s.list().packs.filter(p => p.builtin);
    expect(rows.map(r => r.id).sort()).toEqual(IDS.slice().sort());
    for (const r of rows) { expect(r.enabled).toBe(false); expect(r.trust).toBe('builtin'); }
    expect(rows.find(r => r.id === 'vex-builtin.incident-extra').permissions.map(p => p.id)).toEqual(['runs:checks']);
    expect(s.enabledItems()).toEqual([]);
  });

  it('switching one on hands its items to the consumers, the master switch and the pack switch both apply, and it survives a restart', async () => {
    let s = await make();
    await s.setEnabled('vex-builtin.mun-phrases', true);
    expect(s.enabledItems().map(x => x.item.type).sort()).toEqual(['snippets', 'snippets']);
    expect(s.enabledItems().every(x => x.trust === 'builtin')).toBe(true);
    await s.setGlobalEnabled(false);
    expect(s.enabledItems()).toEqual([]);
    await s.setGlobalEnabled(true);
    s = await make();
    expect(s.list().packs.find(p => p.id === 'vex-builtin.mun-phrases').enabled).toBe(true);
    expect(s.list().packs.find(p => p.id === 'vex-builtin.prompts').enabled).toBe(false);
    await s.setEnabled('vex-builtin.mun-phrases', false);
    expect(s.enabledItems()).toEqual([]);
    expect(s.list().log.map(e => e.event)).toContain('enable');
  });

  it('cannot be removed, replaced from a file, or written to the installed folder', async () => {
    const s = await make();
    await expect(s.uninstall('vex-builtin.prompts')).rejects.toThrow(/cannot be removed/);
    const real = packs.parsePack(fs.readFileSync(path.join(dirOf, 'vex-builtin.prompts.vexpack'), 'utf8'), { builtin: true }).pack;
    await expect(s.preview(JSON.stringify(packs.withHash(real)))).rejects.toThrow(/reserved/);
    expect(fs.readdirSync(path.join(dir, 'installed'))).toEqual([]);
  });

  it('a file with a reserved id dropped in the installed folder is reported as damaged and applies nothing', async () => {
    const real = packs.parsePack(fs.readFileSync(path.join(dirOf, 'vex-builtin.tr-holidays.vexpack'), 'utf8'), { builtin: true }).pack;
    fs.mkdirSync(path.join(dir, 'installed'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'installed', 'vex-builtin.tr-holidays.json'), JSON.stringify({ v: 1, pack: real, meta: { installedAt: 1, enabled: true, source: 'x' } }));
    const s = await make();
    expect(s.list().damaged.map(d => d.file)).toEqual(['vex-builtin.tr-holidays.json']);
    expect(s.enabledItems()).toEqual([]);
  });

  it('a store refuses a "built-in" that did not come from the loader', () => {
    expect(() => createPackStore({ dir, fs, builtins: [{ pack: { id: 'mine-now', items: [] } }] })).toThrow(/built-in loader/);
  });
});

describe('the content item types', () => {
  const wrap = (items, permissions = []) => JSON.stringify(packs.withHash({ format: 'vex-pack', version: 1, id: 'content-test', name: 'Content', author: 'T', description: '', items, permissions }));
  const refuse = (items, code, permissions = []) => {
    let err;
    try { packs.parsePack(wrap(items, permissions)); } catch (e) { err = e; }
    expect(err, 'was accepted').toBeInstanceOf(packs.PackError);
    if (code) expect(err.code).toBe(code);
  };
  const skill = (over = {}) => ({ type: 'skills', id: 'k', name: 'Quiz', icon: 'brain', prompt: 'Ask me about {{title}}.', output: 'text', sites: [], ...over });
  const playbook = (steps, over = {}) => ({ type: 'playbook', id: 'pb', title: 'T', sub: 'S', verified: '2026-10-16', steps, ...over });
  const step = (over = {}) => ({ id: 's1', title: 'T', text: 'Do it.', run: '', ...over });

  it('skills: a known variable passes; an unknown one, a missing question, a bad icon or output, a site that is not one are refused', () => {
    expect(() => packs.parsePack(wrap([skill({ prompt: 'On {{host}} at {{time}}: {{ask:Which part?}} {{selection}}' })]))).not.toThrow();
    refuse([skill({ prompt: 'Run {{shell}}' })], 'bad-template');
    refuse([skill({ prompt: 'Ask {{ask:}}' })], 'bad-template');
    refuse([skill({ prompt: 'Date {{date:now}}' })], 'bad-template');
    refuse([skill({ icon: 'skull' })], 'bad-type');
    refuse([skill({ output: 'script' })], 'bad-type');
    refuse([skill({ sites: ['not a site'] })], 'bad-host');
    refuse([skill({ sites: new Array(11).fill('a.example.com') })], 'bad-type');
    refuse([skill({ extra: 1 })], 'unknown-field');
  });

  it('playbook: only the fixed actions, the permission is needed exactly when a button exists, ids are unique, the date is real', () => {
    expect(() => packs.parsePack(wrap([playbook([step()])]))).not.toThrow();                                   // no button, no permission
    expect(() => packs.parsePack(wrap([playbook([step({ run: 'downloads' })])], ['runs:checks']))).not.toThrow();
    refuse([playbook([step({ run: 'downloads' })])], 'missing-permission');
    refuse([playbook([step()])], 'unused-permission', ['runs:checks']);
    refuse([playbook([step({ run: 'rm -rf /' })])], 'bad-action', ['runs:checks']);
    refuse([playbook([step({ run: 'powershell' })])], 'bad-action', ['runs:checks']);
    refuse([playbook([step(), step()])], 'duplicate-id');
    refuse([playbook([step()], { verified: '2026-02-30' })], 'bad-date');
    refuse([playbook([step()], { verified: 'yesterday' })], 'bad-date');
    refuse([playbook([])], 'bad-type');
    refuse([playbook([{ id: 's1', title: 'T', text: 'Do it.' }])], 'missing-field');
  });

  it('snippets: duplicate labels, overlong text and unknown fields are refused', () => {
    const sn = (entries) => ({ type: 'snippets', id: 'sn', name: 'P', entries });
    expect(() => packs.parsePack(wrap([sn([{ label: 'A', text: 'a' }, { label: 'B', text: 'b\nc' }])]))).not.toThrow();
    refuse([sn([{ label: 'A', text: 'a' }, { label: 'A', text: 'b' }])], 'duplicate-id');
    refuse([sn([{ label: 'A', text: 'x'.repeat(401) }])], 'too-long');
    refuse([sn([{ label: 'A', text: 'a', url: 'https://x.test' }])], 'unknown-field');
  });

  it('dates: real dates, known kinds and a boolean verify are required', () => {
    const d = (entries) => ({ type: 'dates', id: 'd', name: 'H', region: 'TR', entries });
    const e = (over = {}) => ({ date: '2026-10-29', name: 'Day', kind: 'fixed', verify: false, ...over });
    expect(() => packs.parsePack(wrap([d([e(), e({ date: '2026-03-20', kind: 'religious', verify: true }), e({ date: '2026-03-19', kind: 'half-day', verify: true })])]))).not.toThrow();
    refuse([d([e({ date: '2026-02-30' })])], 'bad-date');
    refuse([d([e({ date: '29/10/2026' })])], 'bad-date');
    refuse([d([e({ kind: 'party' })])], 'bad-type');
    refuse([d([e({ verify: 'yes' })])], 'bad-type');
    refuse([d([])], 'bad-type');
  });

  it('the lists the validator copies match the features that read them', () => {
    const skillsSrc = fs.readFileSync(path.join(root, 'src/renderer/js/skills.js'), 'utf8');
    const icons = /ICONS: \[([^\]]+)\]/.exec(skillsSrc)[1].replace(/\s+/g, ' ').split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
    expect(packs.SKILL_ICONS).toEqual(icons);
    expect(packs.SKILL_OUTPUTS).toEqual(/OUTPUTS: \[([^\]]+)\]/.exec(skillsSrc)[1].split(',').map(s => s.trim().replace(/'/g, '')));
    expect(packs.SKILL_VARS).toEqual(/VARS: \[([^\]]+)\]/.exec(skillsSrc)[1].split(',').map(s => s.trim().replace(/'/g, '')));
    const inc = fs.readFileSync(path.join(root, 'src/renderer/js/incident-playbooks.js'), 'utf8');
    for (const a of packs.PLAYBOOK_ACTIONS) expect(inc, a).toContain("name === '" + a + "'");
  });
});

describe('what the built-in packs say', () => {
  const pack = (id) => packs.parsePack(fs.readFileSync(path.join(dirOf, id + '.vexpack'), 'utf8'), { builtin: true }).pack;

  it('the holidays cover 2026 to 2028, every bayram day is marked "verify" and no fixed one is', () => {
    const entries = pack('vex-builtin.tr-holidays').items[0].entries;
    expect(new Set(entries.map(e => e.date.slice(0, 4)))).toEqual(new Set(['2026', '2027', '2028']));
    for (const e of entries) {
      expect(e.verify, e.date + ' ' + e.name).toBe(/Ramazan|Kurban/.test(e.name));
    }
    expect(new Set(entries.map(e => e.date + '|' + e.name)).size).toBe(entries.length);
    for (const y of ['2026', '2027', '2028']) {
      for (const md of ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29']) expect(entries.some(e => e.date === y + '-' + md && e.kind === 'fixed'), y + '-' + md).toBe(true);
      expect(entries.filter(e => e.date.startsWith(y) && /Ramazan Bayramı, day/.test(e.name))).toHaveLength(3);
      expect(entries.filter(e => e.date.startsWith(y) && /Kurban Bayramı, day/.test(e.name))).toHaveLength(4);
    }
    // The 2026 bayram dates this was written from (Diyanet): Ramazan 20-22 March, Kurban 27-30 May.
    expect(entries.find(e => e.name === 'Ramazan Bayramı, day 1' && e.date.startsWith('2026')).date).toBe('2026-03-20');
    expect(entries.find(e => e.name === 'Kurban Bayramı, day 1' && e.date.startsWith('2026')).date).toBe('2026-05-27');
    expect(pack('vex-builtin.tr-holidays').description).toMatch(/verify with Diyanet/i);
  });

  it('the Model UN phrases are generic: they say to check the conference rules, and name no conference', () => {
    const p = pack('vex-builtin.mun-phrases');
    expect(p.description).toMatch(/rules of procedure/);
    const all = JSON.stringify(p.items);
    expect(all).not.toMatch(/\b(THIMUN|NMUN|HMUN|BIMUN|MUN Turkey|ODTÜ|Harvard)\b/i);
    expect(p.items.flatMap(i => i.entries).length).toBeGreaterThanOrEqual(25);
  });

  it('the checklists carry a last-checked date and only fixed actions, and a button needs the permission', () => {
    const p = pack('vex-builtin.incident-extra');
    expect(p.items.map(i => i.id).sort()).toEqual(['discord-login-stolen', 'lost-phone', 'roblox-taken-over', 'sent-money-or-code']);
    for (const it of p.items) {
      expect(it.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const s of it.steps) expect(['', ...packs.PLAYBOOK_ACTIONS]).toContain(s.run);
    }
    expect(p.permissions).toEqual(['runs:checks']);
    expect(JSON.stringify(p)).not.toMatch(/https?:\/\//);   // no link a pack could send a person to
  });

  it('the prompt library only uses the variables and outputs AI Skills knows', () => {
    const p = pack('vex-builtin.prompts');
    expect(p.items.length).toBeGreaterThanOrEqual(8);
    for (const it of p.items) { expect(packs.SKILL_OUTPUTS).toContain(it.output); expect(packs.SKILL_ICONS).toContain(it.icon); }
    expect(p.permissions).toEqual([]);
  });
});
