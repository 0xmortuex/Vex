// The catalogue that ships inside Vex (src/main/wallpaper-builtin.js): how its three data files are read,
// what is dropped and why, and what a missing file means (an empty list, never made-up pictures).
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBuiltin, hostAllowed, checkHosts } = require('../../src/main/wallpaper-builtin.js');
const { LICENCES } = require('../../src/main/wallpaper-catalogue.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'wallpaper-builtin');
const REAL = path.join(__dirname, '..', '..', 'src', 'main', 'data');

describe('reading the three files', () => {
  const b = loadBuiltin({ fs, path, dir: FIX });
  it('keeps the entries that pass the usual checks and sit on a listed host', () => {
    expect(b.entries.map(e => e.id)).toEqual(['art-wave', 'mist-valley']);
    expect(b.name).toBe('Fixture catalogue');
    expect(b.present).toEqual({ catalogue: true, categories: true, hosts: true });
  });
  it('drops a bad entry with a reason, never half using it', () => {
    expect(b.problems.some(p => /entry "bad-licence".*licence/.test(p))).toBe(true);
    expect(b.problems.some(p => /entry number 5 repeats an id/.test(p))).toBe(true);
    expect(b.entries.find(e => e.id === 'bad-licence')).toBeUndefined();
  });
  it('drops an entry whose picture is not on the host list, and says so', () => {
    expect(b.entries.find(e => e.id === 'elsewhere')).toBeUndefined();
    expect(b.problems.some(p => /entry "elsewhere".*not on the built-in host list/.test(p))).toBe(true);
  });
  it('reads the categories and the hosts (lowercased), dropping what is not valid', () => {
    expect(b.categories.map(c => c.id)).toEqual(['art-seascapes', 'nature']);
    expect(b.categories[0]).toEqual({ id: 'art-seascapes', title: 'Seascapes in art', blurb: 'Painted seas.' });
    expect(b.hosts).toEqual(['images.example.org', 'cdn.example.net']);
    expect(b.problems.some(p => /category "Bad Id"/.test(p))).toBe(true);
    expect(b.problems.some(p => /host "not a host"/.test(p))).toBe(true);
  });
});

describe('a missing file is an empty list', () => {
  it('no folder at all: nothing built in, no crash, no made-up entries', () => {
    const b = loadBuiltin({ fs, path, dir: path.join(os.tmpdir(), 'vex-no-such-folder-' + process.pid) });
    expect(b).toMatchObject({ entries: [], categories: [], hosts: [], problems: [], present: { catalogue: false, categories: false, hosts: false } });
  });
  it('the catalogue without a host list: every entry is dropped (nothing may be fetched from anywhere)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-wb-'));
    try {
      fs.copyFileSync(path.join(FIX, 'wallpaper-catalogue.json'), path.join(dir, 'wallpaper-catalogue.json'));
      const b = loadBuiltin({ fs, path, dir });
      expect(b.entries).toEqual([]);
      expect(b.present.hosts).toBe(false);
      expect(b.problems.some(p => /art-wave.*host list/.test(p))).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('a damaged file is an error that is raised, not an empty list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-wb-'));
    try {
      fs.writeFileSync(path.join(dir, 'wallpaper-catalogue.json'), '{ not json');
      expect(() => loadBuiltin({ fs, path, dir })).toThrow(/not valid JSON/);
      fs.writeFileSync(path.join(dir, 'wallpaper-catalogue.json'), JSON.stringify({ schema: 2, entries: [] }));
      expect(() => loadBuiltin({ fs, path, dir })).toThrow(/schema/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the host allow-list', () => {
  const hosts = ['images.example.org'];
  it.each([
    ['https://images.example.org/a.jpg', true],
    ['https://IMAGES.example.org/a.jpg', true],
    ['https://images.example.org:443/a.jpg', true],
    ['http://images.example.org/a.jpg', false],                 // not https
    ['https://images.example.org:8443/a.jpg', false],           // another port
    ['https://evil.example.org/a.jpg', false],                  // another host
    ['https://sub.images.example.org/a.jpg', false],            // a sub-domain is another host
    ['https://images.example.org.evil.com/a.jpg', false],
    ['https://user:pw@images.example.org/a.jpg', false],        // a login in the address
    ['https://127.0.0.1/a.jpg', false],
    ['not an address', false],
  ])('%s -> %s', (href, ok) => { expect(hostAllowed(href, hosts)).toBe(ok); });
  it('an empty or missing list allows nothing', () => {
    expect(hostAllowed('https://images.example.org/a.jpg', [])).toBe(false);
    expect(hostAllowed('https://images.example.org/a.jpg', undefined)).toBe(false);
  });
  it('the host file may also be { "hosts": [...] }', () => {
    expect(checkHosts({ hosts: ['A.example.org'] }).hosts).toEqual(['a.example.org']);
    expect(() => checkHosts('x')).toThrow(/list of host names/);
  });
});

describe('the IPC schemas of the new channels', () => {
  const { validate } = require('../../src/main/ipc-schemas.js');
  it('a download may carry a ticket, a save may carry the ids to keep, builtin and cancel are small', () => {
    expect(() => validate('wallpaper:download', ['https://a.example/x.jpg', 'full'])).not.toThrow();
    expect(() => validate('wallpaper:download', ['https://a.example/x.jpg', 'full', 'dl-abc-1'])).not.toThrow();
    expect(() => validate('wallpaper:download', ['https://a.example/x.jpg', 'full', '../x'])).toThrow(/Invalid payload/);
    expect(() => validate('wallpaper:cancel', ['dl-abc-1'])).not.toThrow();
    expect(() => validate('wallpaper:cancel', [])).toThrow(/Invalid payload/);
    expect(() => validate('wallpaper:builtin', [])).not.toThrow();
    expect(() => validate('wallpaper:save', ['photo-a1', 'full', new ArrayBuffer(8), ['photo-b2']])).not.toThrow();
    expect(() => validate('wallpaper:save', ['photo-a1', 'full', new ArrayBuffer(8), ['BAD ID']])).toThrow(/Invalid payload/);
  });
});

describe('the data that ships in src/main/data (when it is there)', () => {
  const there = fs.existsSync(path.join(REAL, 'wallpaper-catalogue.json'));
  it.runIf(there)('loads, every entry sits on a listed host, no id is repeated, and every licence is one Vex names', () => {
    const b = loadBuiltin({ fs, path, dir: REAL });
    expect(b.hosts.length).toBeGreaterThan(0);
    expect(b.entries.length).toBeGreaterThan(0);
    expect(new Set(b.entries.map(e => e.id)).size).toBe(b.entries.length);
    for (const e of b.entries) {
      expect(hostAllowed(e.thumbUrl, b.hosts)).toBe(true);
      expect(hostAllowed(e.fullUrl, b.hosts)).toBe(true);
      expect(Object.keys(LICENCES)).toContain(e.licence);
    }
    // An entry that was dropped is a data mistake the data owner should see.
    expect(b.problems).toEqual([]);
  });
});
