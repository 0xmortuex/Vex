// @vitest-environment node
// Time travel, main side: what the journal keeps, for how long, and what it
// refuses to keep.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStateJournal, redactSnapshot, diffSnapshots, hashText, cleanUrl } = require('../../src/main/state-journal.js');

const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const fakeSafe = {
  isEncryptionAvailable: () => true,
  seal: (s) => Buffer.from(s, 'utf8').toString('base64'),
  unseal: (s) => Buffer.from(s, 'base64').toString('utf8'),
};

function build({ limits = {}, encrypted = true, paused = { v: false } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-journal-'));
  const clock = { now: T0 };
  const j = createStateJournal({
    dir, now: () => clock.now, isPaused: () => paused.v, limits,
    encryptionAvailable: () => encrypted, seal: fakeSafe.seal, unseal: fakeSafe.unseal,
  });
  return { dir, j, clock, paused };
}
const tab = (url, extra = {}) => ({ url, title: 'T ' + url, partition: 'persist:main', ...extra });
const snap = (tabs, extra = {}) => ({ tabs, notes: [], reminders: [], workspace: { id: 'ws1', name: 'Home' }, focus: { on: false }, ...extra });

describe('redaction', () => {
  it('drops private, Tor, routed, temporary and onion tabs, and non-web addresses', () => {
    const { snap: s } = redactSnapshot(snap([
      tab('https://ok.example/a'),
      tab('https://priv.example/', { private: true }),
      tab('https://tor.example/', { tor: true }),
      tab('https://routed.example/', { routed: true }),
      tab('https://route.example/', { partition: 'persist:route-3' }),
      tab('https://torc.example/', { partition: 'persist:container-tor-1' }),
      tab('https://otr.example/', { partition: 'otr-123' }),
      tab('http://abc.onion/'),
      tab('file:///C:/secret.txt'),
      tab('javascript:alert(1)'),
      tab('vex://settings'),
    ]));
    expect(s.tabs.map(t => t.u)).toEqual(['https://ok.example/a']);
  });

  it('strips credentials and fragments from an address', () => {
    expect(cleanUrl('https://user:pw@site.example/p?q=1#frag')).toBe('https://site.example/p?q=1');
    expect(cleanUrl('x'.repeat(5000))).toBeNull();
  });

  it('bounds tabs, notes and reminders, and de-duplicates tabs', () => {
    const many = Array.from({ length: 300 }, (_, i) => tab('https://s.example/' + (i % 150)));
    const { snap: s } = redactSnapshot({
      tabs: many,
      notes: Array.from({ length: 900 }, (_, i) => ({ id: 'n' + i, title: 't', h: '00000000-1' })),
      reminders: Array.from({ length: 200 }, (_, i) => ({ title: 'r', due: i })),
    });
    expect(s.tabs.length).toBe(80);
    expect(s.notes.length).toBe(400);
    expect(s.reminders.length).toBe(60);
    expect(new Set(s.tabs.map(t => t.u)).size).toBe(s.tabs.length);
  });

  it('never keeps a private tab even if every other field looks normal', async () => {
    const { dir, j } = build();
    await j.append(snap([tab('https://visible.example/'), tab('https://secret.example/', { incognito: true })]));
    const raw = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8');
    const text = require('zlib').inflateSync(Buffer.from(raw.trim(), 'base64')).toString();
    expect(text).toContain('visible.example');
    expect(text).not.toContain('secret.example');
  });
});

describe('journal retention and caps', () => {
  it('skips an unchanged snapshot and one closer than the minimum gap', async () => {
    const { j, clock } = build();
    expect((await j.append(snap([tab('https://a.example/')]))).stored).toBe(true);
    clock.now += 5 * MIN;
    expect((await j.append(snap([tab('https://a.example/')]))).reason).toBe('unchanged');
    clock.now += 10 * 1000;
    expect((await j.append(snap([tab('https://a.example/'), tab('https://b.example/')]))).stored).toBe(true);
    clock.now += 10 * 1000;
    expect((await j.append(snap([tab('https://a.example/'), tab('https://c.example/')]))).reason).toBe('too-soon');
    clock.now += 2 * MIN;
    await j.append(snap([tab('https://a.example/'), tab('https://c.example/')]));
    clock.now += 2 * MIN;
    expect((await j.append(snap([tab('https://a.example/'), tab('https://d.example/')]))).stored).toBe(true);
    expect((await j.stats()).count).toBe(4);
  });

  it('drops snapshots older than the retention window but never the newest', async () => {
    const { j, clock } = build();
    await j.append(snap([tab('https://old.example/')]));
    clock.now += 10 * DAY;
    await j.append(snap([tab('https://mid.example/')]));
    clock.now += 25 * DAY;                 // old is now 35 days back
    await j.append(snap([tab('https://new.example/')]));
    const list = await j.list();
    expect(list.length).toBe(2);
    expect((await j.at(T0)) ).toBeNull();
    expect((await j.at(clock.now)).snap.tabs[0].u).toBe('https://new.example/');
    // everything expired but the newest survives
    clock.now += 400 * DAY;
    await j.prune();
    expect((await j.stats()).count).toBe(1);
  });

  it('enforces the byte cap by dropping the oldest, and reports the size', async () => {
    const { dir, j, clock } = build({ limits: { maxBytes: 2500, minGapMs: 0 } });
    for (let i = 0; i < 40; i++) {
      clock.now += MIN;
      await j.append(snap(Array.from({ length: 12 }, (_, k) => tab('https://s' + i + '.example/page' + k + '?x=' + 'q'.repeat(30)))));
    }
    const st = await j.stats();
    expect(st.bytes).toBeLessThanOrEqual(2500);
    expect(st.count).toBeGreaterThan(0);
    expect(st.count).toBeLessThan(40);
    expect(st.newest).toBe(clock.now);
    expect(fs.statSync(path.join(dir, 'journal.jsonl')).size).toBe(st.bytes);
  });

  it('changing retention prunes at once, and the setting persists', async () => {
    const { dir, j, clock } = build();
    await j.append(snap([tab('https://a.example/')]));
    clock.now += 10 * DAY;
    await j.append(snap([tab('https://b.example/')]));
    expect((await j.stats()).count).toBe(2);
    const st = await j.configure({ retentionDays: 7 });
    expect(st.retentionDays).toBe(7);
    expect(st.count).toBe(1);
    const again = createStateJournal({ dir, now: () => clock.now });
    expect((await again.stats()).retentionDays).toBe(7);
    await expect(j.configure({ retentionDays: 'x' })).rejects.toThrow(/number/);
  });

  it('writes nothing while paused (a game is running) and nothing when switched off', async () => {
    const { j, paused } = build();
    paused.v = true;
    expect((await j.append(snap([tab('https://a.example/')]))).reason).toBe('paused');
    expect((await j.stats()).count).toBe(0);
    paused.v = false;
    await j.configure({ enabled: false });
    expect((await j.append(snap([tab('https://a.example/')]))).reason).toBe('off');
  });

  it('forget removes the journal and every note version', async () => {
    const { dir, j } = build();
    await j.append(snap([tab('https://a.example/')], { notes: [{ id: 'n1', title: 'A', content: 'hello' }] }));
    expect(fs.existsSync(path.join(dir, 'journal.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'note-versions.vex'))).toBe(true);
    const st = await j.forget();
    expect(st.count).toBe(0);
    expect(fs.existsSync(path.join(dir, 'journal.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'note-versions.vex'))).toBe(false);
    expect(await j.noteVersions('n1')).toEqual([]);
  });
});

describe('moments and diffs', () => {
  it('at() returns the snapshot in force, and a diff names what changed', async () => {
    const { j, clock } = build();
    await j.append(snap([tab('https://a.example/'), tab('https://b.example/')], { notes: [{ id: 'n1', title: 'N', content: 'one' }] }));
    const t1 = clock.now;
    clock.now += 5 * MIN;
    await j.append(snap([tab('https://b.example/'), tab('https://c.example/')], { workspace: { id: 'ws2', name: 'Work' }, notes: [{ id: 'n1', title: 'N', content: 'two' }], focus: { on: true } }));
    const t2 = clock.now;
    expect((await j.at(t1 + MIN)).snap.tabs.length).toBe(2);
    const d = await j.diff(t1, t2);
    expect(d.tabs.removed.map(t => t.u)).toEqual(['https://a.example/']);
    expect(d.tabs.added.map(t => t.u)).toEqual(['https://c.example/']);
    expect(d.notes.changed.map(n => n.id)).toEqual(['n1']);
    expect(d.workspace.to.name).toBe('Work');
    expect(d.focus).toEqual({ from: false, to: true });
    expect(d.empty).toBe(false);
    expect((await j.diff(t2, t2)).empty).toBe(true);
    expect(await j.at(T0 - MIN)).toBeNull();
  });

  it('diffSnapshots of nothing against nothing is empty', () => {
    expect(diffSnapshots(null, null).empty).toBe(true);
  });
});

describe('note versions', () => {
  it('keeps versions per note, de-duplicated, capped per note, newest never dropped', async () => {
    const { j, clock } = build({ limits: { noteRevisionsPerNote: 3, minGapMs: 0 } });
    for (const text of ['v1', 'v2', 'v2', 'v3', 'v4', 'v5']) {
      clock.now += MIN;
      await j.append(snap([tab('https://a.example/')], { notes: [{ id: 'n1', title: 'N', content: text }] }));
    }
    const v = await j.noteVersions('n1');
    expect(v.length).toBe(3);
    expect(v.map(x => x.chars)).toEqual([2, 2, 2]);
    const newest = await j.noteVersionAt('n1', clock.now);
    expect(newest.content).toBe('v5');
    expect((await j.noteVersionAt('n1', v[0].ts)).content).toBe('v3');
  });

  it('keeps all notes inside the total byte cap but each note keeps its newest version', async () => {
    const { j, clock } = build({ limits: { noteRevisionBytes: 3000, minGapMs: 0 } });
    for (let r = 0; r < 4; r++) {
      for (const id of ['a', 'b', 'c']) {
        clock.now += MIN;
        await j.append(snap([tab('https://a.example/')], { notes: [{ id, title: id, content: id.repeat(400) + r }] }));
      }
    }
    for (const id of ['a', 'b', 'c']) {
      const v = await j.noteVersions(id);
      expect(v.length).toBeGreaterThanOrEqual(1);
      expect((await j.noteVersionAt(id, clock.now)).content.endsWith('3')).toBe(true);
    }
    expect((await j.stats()).noteBytes).toBeLessThanOrEqual(3000 * 2);
  });

  it('without OS encryption no note text is stored, and restore says so', async () => {
    const { dir, j } = build({ encrypted: false });
    await j.append(snap([tab('https://a.example/')], { notes: [{ id: 'n1', title: 'Secret', content: 'the text' }] }));
    expect(fs.existsSync(path.join(dir, 'note-versions.vex'))).toBe(false);
    expect((await j.stats()).noteRestore).toBe(false);
    expect(await j.noteVersions('n1')).toEqual([]);
    const at = await j.at(T0 + MIN);
    expect(at.snap.notes[0]).toEqual({ id: 'n1', t: 'Secret', h: hashText('the text') });
  });

  it('note text is never in the journal file itself', async () => {
    const { dir, j } = build();
    await j.append(snap([tab('https://a.example/')], { notes: [{ id: 'n1', title: 'T', content: 'DISTINCTIVE-BODY-TEXT' }] }));
    const raw = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8');
    expect(require('zlib').inflateSync(Buffer.from(raw.trim(), 'base64')).toString()).not.toContain('DISTINCTIVE-BODY-TEXT');
  });
});
