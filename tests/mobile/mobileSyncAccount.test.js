// @vitest-environment node
//
// The phone on a real Vex Sync account: the shipping worker, the shipping
// desktop engine and the phone's sync, all three in this process
// (sync-harness.mjs). What is proved here is what the account needs from the
// phone: it changes only bookmarks, the desktop's notes and its own marker,
// and every other record goes back byte for byte as it came.
import { describe, it, expect, beforeEach } from 'vitest';
import { standIn, desktop, phone, codeFor, accountDocument } from './sync-harness.mjs';

const EMAIL = 'someone@example.com';
const MINE = new Set(['preference:vex.bookmarks', 'preference:vex.notes']);
const sourceOf = key => JSON.parse(key)[0];

let stand, pc, recovery;

/** A desktop with an account and a spread of what desktops sync. */
async function desktopWithAccount() {
  pc = desktop(stand);
  pc.local.set('vex.bookmarks', JSON.stringify([
    { id: 'bmdesk1', url: 'https://desk.example/one', title: 'Desk one', folder: 'Work', at: 1700000000001 },
    { id: 'bmdesk2', url: 'https://desk.example/two', title: 'Desk two', folder: '', at: 1700000000002, ownSession: true }
  ]));
  pc.local.set('vex.notes', JSON.stringify([
    { id: 'note_1700000000000_abcde', title: 'Shopping', content: '- [ ] milk\n- [x] bread', pinned: true, tags: ['home'],
      sourceUrl: '', sourceTitle: '', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' }
  ]));
  pc.local.set('vex.theme', 'midnight');
  pc.local.set('vex.settings', JSON.stringify({ zoom: 1.25, nested: { b: 2, a: 1 } }));
  pc.local.set('vex.shortcuts', JSON.stringify([{ url: 'https://tile.example/', title: 'Tile' }]));
  pc.storage.set('tabs', [{ id: 't1', url: 'https://open.example/page', title: 'Open on the PC' }]);
  pc.storage.set('settings', { homepage: 'https://home.example/' });
  const code = await codeFor(pc, EMAIL);
  const made = await pc.engine.verifyCode(EMAIL, code, 'PC');
  recovery = made.recoveryCode;
  return pc;
}

async function joinedPhone() {
  const mobile = phone(stand);
  await mobile.sync.setWorkerUrl(stand.base);
  const code = await codeFor(mobile, EMAIL);
  const result = await mobile.sync.signIn(EMAIL, code, recovery);
  expect(result.ok).toBe(true);
  return mobile;
}

/** Every record, as text, keyed by record key. */
const recordTexts = doc => Object.fromEntries(Object.entries(doc.records).map(([key, record]) => [key, JSON.stringify(record)]));

beforeEach(() => { stand = standIn(); });

describe('joining', () => {
  it('reads the desktop’s bookmarks and notes, and shows its open tabs', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    expect(mobile.bookmarks.all().map(item => item.url)).toEqual(['https://desk.example/one', 'https://desk.example/two']);
    expect(mobile.notes()[0].title).toBe('Shopping');
    expect(mobile.sync.remoteTabs()).toEqual([expect.objectContaining({ url: 'https://open.example/page', title: 'Open on the PC', group: '' })]);
    expect(mobile.sync.state.enabled).toBe(true);
  });

  it('keeps the phone’s own bookmarks and adds them to the account, without doubling one the account has', async () => {
    await desktopWithAccount();
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    await mobile.bookmarks.add({ url: 'https://phone.example/', title: 'From the phone' });
    await mobile.bookmarks.add({ url: 'https://desk.example/one', title: 'Same page, phone id' });
    const code = await codeFor(mobile, EMAIL);
    await mobile.sync.signIn(EMAIL, code, recovery);
    const { doc } = await accountDocument(stand, recovery);
    const urls = Object.entries(doc.records).filter(([key, r]) => sourceOf(key) === 'preference:vex.bookmarks' && !r.deleted && r.value && r.value.item)
      .map(([, r]) => r.value.item.url).sort();
    expect(urls).toEqual(['https://desk.example/one', 'https://desk.example/two', 'https://phone.example/']);
  });

  it('asks for the recovery code when the account has data, and leaves no device behind if you walk away', async () => {
    await desktopWithAccount();
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    const code = await codeFor(mobile, EMAIL);
    const answer = await mobile.sync.signIn(EMAIL, code);
    expect(answer.needsRecoveryCode).toBe(true);
    await mobile.sync.abandon();
    const devices = await pc.engine.listDevices();
    expect(devices.map(device => device.deviceName)).toEqual(['PC']);
  });

  it('a wrong recovery code is refused and leaves no ghost device', async () => {
    await desktopWithAccount();
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    const code = await codeFor(mobile, EMAIL);
    const wrong = 'FFFFFFFF-'.repeat(7) + 'FFFFFFFF';
    await expect(mobile.sync.signIn(EMAIL, code, wrong)).rejects.toThrow(/doesn’t unlock/);
    expect(mobile.sync.state.enabled).toBe(false);
    expect(await mobile.vault.get('vex.syncKey')).toBeFalsy();
    const devices = await pc.engine.listDevices();
    expect(devices.map(device => device.deviceName)).toEqual(['PC']);
    // The account is exactly as the desktop left it.
    const after = await accountDocument(stand, recovery);
    expect(after.revision).toBe(1);
  });

  it('a wrong code asked for after the fact is refused the same way', async () => {
    await desktopWithAccount();
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    await mobile.sync.signIn(EMAIL, await codeFor(mobile, EMAIL));
    await expect(mobile.sync.join('0'.repeat(64))).rejects.toThrow(/doesn’t unlock/);
    expect((await pc.engine.listDevices()).length).toBe(1);
  });

  it('starts an account of its own when there is none, and a desktop joins it', async () => {
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    await mobile.bookmarks.add({ url: 'https://phone.example/', title: 'Phone first' });
    const made = await mobile.sync.signIn(EMAIL, await codeFor(mobile, EMAIL));
    expect(made.created).toBe(true);
    expect(made.recoveryCode).toMatch(/^([0-9A-F]{8}-){7}[0-9A-F]{8}$/);
    pc = desktop(stand);
    const joined = await pc.engine.enrollWithRecoveryCode(EMAIL, await codeFor(pc, EMAIL), made.recoveryCode, 'PC');
    expect(joined.ok).toBe(true);
    expect(JSON.parse(pc.local.get('vex.bookmarks')).map(item => item.url)).toEqual(['https://phone.example/']);
  });
});

describe('what the phone sends back', () => {
  it('leaves every record it does not own byte-identical — newer sources, other devices’ markers and odd numbers included', async () => {
    await desktopWithAccount();
    // What a newer Vex or another device put in the account, which neither
    // this desktop nor the phone knows.
    const start = await accountDocument(stand, recovery);
    const doc = start.doc;
    doc.records['["preference:vex.somethingNew","type"]'] = { clock: { future1: 3 }, deleted: false, value: 'scalar', at: 1700000000000, conflicts: [] };
    doc.records['["preference:vex.somethingNew","value"]'] = { clock: { future1: 3 }, deleted: false, value: { z: 1, a: [3, 2, 1], n: 1e+21, f: -0.5, s: 'a/b' }, at: 1700000000000, conflicts: [] };
    doc.records['["storage:futureStore","value"]'] = { clock: { future1: 1, b0: 2 }, deleted: true, value: null, at: 5, conflicts: [] };
    doc.records['["sync:device:ffffffffffffffffffffffffffffffff","type"]'] = { clock: { ffffffffffffffffffffffffffffffff: 1 }, deleted: false, value: 'scalar', at: 9, conflicts: [] };
    doc.records['["sync:device:ffffffffffffffffffffffffffffffff","value"]'] = { clock: { ffffffffffffffffffffffffffffffff: 1 }, deleted: false, value: { level: 7, extra: 'x' }, at: 9, conflicts: [] };
    await stand.putDocument(doc, recovery);
    const before = recordTexts((await accountDocument(stand, recovery)).doc);

    const mobile = await joinedPhone();
    await mobile.bookmarks.add({ url: 'https://phone.example/added', title: 'Added on the phone' });
    const notes = mobile.notes();
    notes[0] = { ...notes[0], content: notes[0].content + '\n- [ ] eggs', updatedAt: '2026-10-01T10:00:00.000Z' };
    mobile.setNotes(notes);
    const pushed = await mobile.sync.syncNow();
    expect(pushed.ok).toBe(true);

    const after = recordTexts((await accountDocument(stand, recovery)).doc);
    const ownMarker = 'sync:device:' + mobile.sync.state.deviceId;
    for (const [key, text] of Object.entries(before)) {
      const source = sourceOf(key);
      if (MINE.has(source) || source === ownMarker) continue;
      expect(after[key], key).toBe(text);
    }
    // And within its own lists, only what it changed changed.
    expect(after['["preference:vex.bookmarks","item","bmdesk1"]']).toBe(before['["preference:vex.bookmarks","item","bmdesk1"]']);
    expect(after['["preference:vex.bookmarks","item","bmdesk2"]']).toBe(before['["preference:vex.bookmarks","item","bmdesk2"]']);
    expect(after['["preference:vex.notes","item","note_1700000000000_abcde"]']).not.toBe(before['["preference:vex.notes","item","note_1700000000000_abcde"]']);
    // Nothing disappeared.
    for (const key of Object.keys(before)) expect(Object.hasOwn(after, key), key).toBe(true);
  });

  it('a desktop-shaped document goes round unchanged, but for the phone’s own marker', async () => {
    await desktopWithAccount();
    const before = await accountDocument(stand, recovery);
    const mobile = await joinedPhone();
    const after = await accountDocument(stand, recovery);
    const marker = JSON.stringify(['sync:device:' + mobile.sync.state.deviceId, 'value']);
    expect(JSON.parse(JSON.parse(after.text).records[marker] ? JSON.stringify(after.doc.records[marker].value) : 'null')).toEqual({ level: 1 });
    const withoutMarker = Object.fromEntries(Object.entries(after.doc.records).filter(([key]) => !sourceOf(key).startsWith('sync:device:' + mobile.sync.state.deviceId)));
    // Byte for byte, the whole document — key order included.
    expect(JSON.stringify({ schema: 2, records: withoutMarker })).toBe(before.text);
  });

  it('never writes storage:tabs, settings or the theme, whatever it reads', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await mobile.bookmarks.add({ url: 'https://phone.example/x', title: 'x' });
    await mobile.sync.syncNow();
    const { doc } = await accountDocument(stand, recovery);
    const phoneId = mobile.sync.state.deviceId;
    for (const [key, record] of Object.entries(doc.records)) {
      if (record.clock[phoneId]) expect(['preference:vex.bookmarks', 'sync:device:' + phoneId]).toContain(sourceOf(key));
    }
  });

  it('keeps a bookmark the desktop would refuse on the phone, and out of the account', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await mobile.bookmarks.add({ url: 'javascript:alert(1)', title: 'A bookmarklet' });
    await mobile.bookmarks.add({ url: 'https://ok.example/', title: 'Fine' });
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    const { text } = await accountDocument(stand, recovery);
    expect(text).not.toContain('javascript:');
    expect(text).toContain('https://ok.example/');
    expect(mobile.bookmarks.all().some(item => item.url === 'javascript:alert(1)')).toBe(true);
    // And the desktop takes the rest without complaint.
    expect((await pc.engine.pullNow()).ok).toBe(true);
  });
});

describe('with the desktop', () => {
  it('the desktop accepts what the phone wrote, and each sees the other’s edits and deletions', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await mobile.bookmarks.add({ url: 'https://phone.example/new', title: 'Phone bookmark', folder: 'Work' });
    mobile.setNotes([...mobile.notes(), {
      id: 'note_1759312800000_phone', title: 'From the phone', content: 'hello', pinned: false, tags: [],
      sourceUrl: '', sourceTitle: '', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z'
    }]);
    expect((await mobile.sync.syncNow()).ok).toBe(true);

    const pulled = await pc.engine.pullNow();
    expect(pulled.ok).toBe(true);
    expect(pc.toasts.filter(text => /Invalid|refus/i.test(text))).toEqual([]);
    const deskBookmarks = JSON.parse(pc.local.get('vex.bookmarks'));
    expect(deskBookmarks.find(item => item.url === 'https://phone.example/new')).toMatchObject({ title: 'Phone bookmark', folder: 'Work' });
    expect(JSON.parse(pc.local.get('vex.notes')).map(note => note.title)).toEqual(['Shopping', 'From the phone']);

    // The desktop deletes the phone's note and renames a bookmark.
    pc.local.set('vex.notes', JSON.stringify(JSON.parse(pc.local.get('vex.notes')).filter(note => note.title !== 'From the phone')));
    pc.local.set('vex.bookmarks', JSON.stringify(deskBookmarks.map(item => item.id === 'bmdesk1' ? { ...item, title: 'Renamed on the PC' } : item)));
    expect((await pc.engine.pushNow()).ok).toBe(true);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect(mobile.notes().map(note => note.title)).toEqual(['Shopping']);
    expect(mobile.bookmarks.all().find(item => item.id === 'bmdesk1').title).toBe('Renamed on the PC');

    // The phone deletes a bookmark; the desktop loses it.
    await mobile.bookmarks.remove('https://desk.example/two');
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    await pc.engine.pullNow();
    expect(JSON.parse(pc.local.get('vex.bookmarks')).some(item => item.url === 'https://desk.example/two')).toBe(false);
  });

  it('a bookmark merely missing on the phone is put back, never deleted everywhere', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await mobile.context.VexStore.set('vex.bookmarks', []);        // a wiped store, not a deletion
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect(mobile.bookmarks.all().map(item => item.id).sort()).toEqual(['bmdesk1', 'bmdesk2']);
    const { doc } = await accountDocument(stand, recovery);
    expect(doc.records['["preference:vex.bookmarks","item","bmdesk1"]'].deleted).toBe(false);
  });

  it('a bookmark added or edited while a sync is on the network survives it', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    // The desktop changed something, so the pull has work to apply.
    pc.local.set('vex.bookmarks', JSON.stringify([...JSON.parse(pc.local.get('vex.bookmarks')),
      { id: 'bmdesk9', url: 'https://desk.example/nine', title: 'Nine', folder: '', at: 1700000000009 }]));
    await pc.engine.pullNow();
    await pc.engine.pushNow();
    // While the phone's pull is between the worker and the merge…
    const realFetch = mobile.context.fetch;
    mobile.context.fetch = async (input, init) => {
      const response = await realFetch(input, init);
      if (String(input).endsWith('/sync/pull')) {
        await mobile.bookmarks.add({ url: 'https://phone.example/meanwhile', title: 'Added meanwhile' });
        await mobile.bookmarks.update('bmdesk1', { title: 'Edited meanwhile' });
      }
      return response;
    };
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    mobile.context.fetch = realFetch;
    const titles = mobile.bookmarks.all().map(item => item.title);
    expect(titles).toContain('Added meanwhile');
    expect(titles).toContain('Edited meanwhile');
    expect(titles).toContain('Nine');
    // And the next round sends both.
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    const { text } = await accountDocument(stand, recovery);
    expect(text).toContain('Added meanwhile');
    expect(text).toContain('Edited meanwhile');
  });

  it('after a restart it carries on from where it was, without joining again', async () => {
    await desktopWithAccount();
    const first = await joinedPhone();
    const revision = stand.blob().revision;
    // A new process over the same storage.
    const again = phone(stand);
    for (const [key, value] of first.store) again.store.set(key, value);
    for (const [key, value] of first.vault) again.vault.set(key, value);
    for (const [key, value] of first.blobs) again.blobs.set(key, value);
    expect(await again.sync.restore()).toBe(true);
    // Nothing goes up before the account has been read again.
    expect((await again.sync.push()).ok).toBe(false);
    expect((await again.sync.syncNow()).ok).toBe(true);
    expect(stand.blob().revision).toBe(revision);        // nothing changed, nothing sent
    await again.bookmarks.add({ url: 'https://phone.example/after-restart', title: 'After' });
    expect((await again.sync.syncNow()).ok).toBe(true);
    expect((await accountDocument(stand, recovery)).text).toContain('after-restart');
  });

  it('a push that loses the race (409) pulls, merges and goes again — both sides’ changes survive', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await mobile.bookmarks.add({ url: 'https://phone.example/race', title: 'Phone, racing' });
    // Just before the phone's push lands, the desktop pushes one of its own.
    stand.hooks.beforePush = async () => {
      pc.local.set('vex.bookmarks', JSON.stringify([
        { id: 'bmdesk3', url: 'https://desk.example/three', title: 'Desk, racing', folder: '', at: 1700000000003 },
        ...JSON.parse(pc.local.get('vex.bookmarks'))
      ]));
      await pc.engine.pullNow();
      const pushed = await pc.engine.pushNow();
      if (!pushed.ok) throw new Error('desktop push failed: ' + pushed.reason);
    };
    const result = await mobile.sync.push();
    expect(result.ok).toBe(true);
    expect(stand.log.filter(entry => entry.path === '/sync/push' && entry.status === 409).length).toBeGreaterThanOrEqual(1);
    const { text } = await accountDocument(stand, recovery);
    expect(text).toContain('https://phone.example/race');
    expect(text).toContain('https://desk.example/three');
    expect(mobile.bookmarks.all().some(item => item.url === 'https://desk.example/three')).toBe(true);
  });

  it('gives the desktop its tile sync: the phone’s marker says level 1', async () => {
    await desktopWithAccount();
    await joinedPhone();
    await pc.engine.pullNow();
    await pc.engine.pushNow();
    expect(pc.engine.tileSyncState()).toEqual({ open: true, waitingOn: [] });
  });

  it('puts its marker back when an older device deleted it', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    const { doc } = await accountDocument(stand, recovery);
    const key = JSON.stringify(['sync:device:' + mobile.sync.state.deviceId, 'value']);
    doc.records[key] = { clock: { ...doc.records[key].clock, old1: 1 }, deleted: true, value: null, at: Date.now(), conflicts: [] };
    await stand.putDocument(doc, recovery);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    const after = (await accountDocument(stand, recovery)).doc.records[key];
    expect(after.deleted).toBe(false);
    expect(after.value).toEqual({ level: 1 });
  });

  it('leaves notes alone when an older Vex keeps them as one value', async () => {
    await desktopWithAccount();
    const { doc } = await accountDocument(stand, recovery);
    for (const key of Object.keys(doc.records)) if (sourceOf(key) === 'preference:vex.notes') delete doc.records[key];
    doc.records['["preference:vex.notes","type"]'] = { clock: { old1: 1 }, deleted: false, value: 'scalar', at: 1, conflicts: [] };
    doc.records['["preference:vex.notes","value"]'] = { clock: { old1: 1 }, deleted: false, value: '[{"id":"n1","title":"Old"}]', at: 1, conflicts: [] };
    await stand.putDocument(doc, recovery);
    const before = recordTexts((await accountDocument(stand, recovery)).doc);
    const mobile = await joinedPhone();
    mobile.setNotes([{ id: 'note_x', title: 'phone', content: '', pinned: false, tags: [], sourceUrl: '', sourceTitle: '', createdAt: '', updatedAt: '' }]);
    await mobile.sync.syncNow();
    const after = recordTexts((await accountDocument(stand, recovery)).doc);
    expect(after['["preference:vex.notes","type"]']).toBe(before['["preference:vex.notes","type"]']);
    expect(after['["preference:vex.notes","value"]']).toBe(before['["preference:vex.notes","value"]']);
    expect(Object.keys(after).some(key => key.startsWith('["preference:vex.notes","item"'))).toBe(false);
  });
});

describe('the server’s answers', () => {
  it('401: removed from another device, the phone is signed out and says so', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await pc.engine.removeDevice(mobile.sync.state.deviceId);
    const result = await mobile.sync.syncNow();
    expect(result.ok).toBe(false);
    expect(mobile.sync.state.enabled).toBe(false);
    expect(mobile.toasts.some(text => /signed out/i.test(text))).toBe(true);
  });

  it('403: a sign-in waiting on its recovery code can do nothing but sync or leave', async () => {
    await desktopWithAccount();
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    await mobile.sync.signIn(EMAIL, await codeFor(mobile, EMAIL));
    expect(mobile.sync.pendingSignIn()).toBe(true);
    // Not enabled, so nothing is sent with the pending session.
    await expect(mobile.sync.sendToDevices('https://x.example/')).rejects.toThrow(/Sign in/);
    await mobile.sync.abandon();
    expect(stand.log.some(entry => entry.method === 'DELETE' && entry.status === 200)).toBe(true);
  });

  it('a revision that went backwards (the account was wiped elsewhere) signs the phone out rather than resurrecting it', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await pc.engine.wipeAllCloudData();
    const result = await mobile.sync.syncNow();
    expect(result.ok).toBe(false);
    expect(mobile.sync.state.enabled).toBe(false);
    expect(stand.blob()).toBe(null);
  });
});

describe('the spec’s §6 rules, case by case', () => {
  it('§5.4: rejoining with an old local list does not bring back what a desktop deleted meanwhile', async () => {
    await desktopWithAccount();
    const first = await joinedPhone();
    await first.sync.signOut();                                   // keeps the phone's bookmarks
    expect(first.bookmarks.all().some(item => item.id === 'bmdesk2')).toBe(true);
    await pc.engine.pullNow();
    pc.local.set('vex.bookmarks', JSON.stringify(JSON.parse(pc.local.get('vex.bookmarks')).filter(item => item.id !== 'bmdesk2')));
    expect((await pc.engine.pushNow()).ok).toBe(true);
    // The same phone signs in again.
    expect((await first.sync.signIn(EMAIL, await codeFor(first, EMAIL), recovery)).ok).toBe(true);
    const { doc } = await accountDocument(stand, recovery);
    expect(doc.records['["preference:vex.bookmarks","item","bmdesk2"]'].deleted).toBe(true);
    expect(first.bookmarks.all().some(item => item.id === 'bmdesk2')).toBe(false);
  });

  it('…nor does a stale local copy in an ordinary round, but an undo does', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    const entry = mobile.bookmarks.all().find(item => item.id === 'bmdesk1');
    await mobile.bookmarks.remove(entry.url);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect((await accountDocument(stand, recovery)).doc.records['["preference:vex.bookmarks","item","bmdesk1"]'].deleted).toBe(true);
    // A stale copy (a backup restored, say) is not a reason to revive it…
    await mobile.context.VexStore.set('vex.bookmarks', [...mobile.bookmarks.all(), entry]);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect((await accountDocument(stand, recovery)).doc.records['["preference:vex.bookmarks","item","bmdesk1"]'].deleted).toBe(true);
    // …but Undo is.
    await mobile.bookmarks.restore(entry);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect((await accountDocument(stand, recovery)).doc.records['["preference:vex.bookmarks","item","bmdesk1"]'].deleted).toBe(false);
    await pc.engine.pullNow();
    expect(JSON.parse(pc.local.get('vex.bookmarks')).some(item => item.id === 'bmdesk1')).toBe(true);
  });

  it('§5.3 step 2, rule 3: an account found empty gets the phone’s own part, never a stale stored document', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    // The blob gone, the sessions and devices still there.
    for (const key of [...stand.env.VEX_SYNC_KV.map.keys()]) if (key.startsWith('blob:')) stand.env.VEX_SYNC_KV.map.delete(key);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    const after = await accountDocument(stand, recovery);
    expect(after.revision).toBe(1);
    const sources = new Set(Object.keys(after.doc.records).map(sourceOf));
    expect([...sources].sort()).toEqual(['preference:vex.bookmarks', 'preference:vex.notes', 'sync:device:' + mobile.sync.state.deviceId].sort());
  });

  it('rule 15: a 401 anywhere signs the phone out, without a DELETE and without touching its bookmarks', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    const kept = mobile.bookmarks.all().length;
    await pc.engine.removeDevice(mobile.sync.state.deviceId);
    const deletesBefore = stand.log.filter(entry => entry.method === 'DELETE').length;
    expect(await mobile.sync.receiveFromDevices()).toEqual([]);
    expect(mobile.sync.state.enabled).toBe(false);
    expect(stand.log.filter(entry => entry.method === 'DELETE').length).toBe(deletesBefore);
    expect(mobile.bookmarks.all().length).toBe(kept);
  });

  it('§2.4: a mistyped recovery code is refused before the emailed code is spent', async () => {
    await desktopWithAccount();
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    const code = await codeFor(mobile, EMAIL);
    const verifies = () => stand.log.filter(entry => entry.path === '/auth/verify-code').length;
    const before = verifies();
    await expect(mobile.sync.signIn(EMAIL, code, '1234-not-a-code')).rejects.toThrow(/isn’t a recovery code/);
    expect(verifies()).toBe(before);
    expect((await mobile.sync.signIn(EMAIL, code, recovery)).ok).toBe(true);
  });

  it('rule 17: a 503 keeps the session and says the server is not set up', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    const secret = stand.env.EMAIL_HASH_SECRET;
    stand.env.EMAIL_HASH_SECRET = 'short';
    const result = await mobile.sync.syncNow();
    stand.env.EMAIL_HASH_SECRET = secret;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not set up/);
    expect(mobile.sync.state.enabled).toBe(true);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
  });

  it('rule 5: every document the phone pushes carries its marker at level 1, and only level 1', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    for (let round = 0; round < 3; round++) {
      await mobile.bookmarks.add({ url: 'https://phone.example/r' + round, title: 'r' + round });
      expect((await mobile.sync.syncNow()).ok).toBe(true);
      const { doc } = await accountDocument(stand, recovery);
      const marker = doc.records[JSON.stringify(['sync:device:' + mobile.sync.state.deviceId, 'value'])];
      expect(marker.deleted).toBe(false);
      expect(marker.value).toEqual({ level: 1 });
    }
  });

  it('rule 11: everything the phone wrote passes the desktop’s contracts and record validation', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await mobile.bookmarks.add({ url: 'https://phone.example/ü/😀?q=a"b', title: 'Odd "title" \\ ü 😀', folder: 'F/G' });
    mobile.setNotes([...mobile.notes(), { id: 'note_1_x', title: 't', content: 'c', pinned: false, tags: [], sourceUrl: '', sourceTitle: '', createdAt: '', updatedAt: '' }]);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    const { doc } = await accountDocument(stand, recovery);
    expect(() => pc.records.valid(doc)).not.toThrow();
    expect(() => pc.context.VexDataContracts.sources(pc.records.unflatten(pc.records.values(doc)))).not.toThrow();
    expect((await pc.engine.pullNow()).ok).toBe(true);
  });
});

describe('an account this phone’s key cannot open', () => {
  it('takes nothing, sends nothing, and carries on once the right key reads it again', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    const good = await accountDocument(stand, recovery);
    // Something re-encrypted the account under another key.
    const other = 'ABCDEF01-'.repeat(7) + 'ABCDEF01';
    await stand.putDocument(good.doc, other);
    const locked = stand.blob();
    const revisionBefore = mobile.sync.state.revision;
    await mobile.bookmarks.add({ url: 'https://phone.example/waiting', title: 'Waiting' });
    const result = await mobile.sync.syncNow();
    expect(result.ok).toBe(false);
    expect(result.badKey).toBe(true);
    // The server's revision was not taken, and no push was attempted.
    expect(mobile.sync.state.revision).toBe(revisionBefore);
    expect((await mobile.sync.push()).ok).toBe(false);
    expect(stand.blob()).toEqual(locked);
    // Readable again: the waiting bookmark goes up, nothing was lost meanwhile.
    await stand.putDocument(good.doc, recovery);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    const { text } = await accountDocument(stand, recovery);
    expect(text).toContain('https://phone.example/waiting');
    expect(text).toContain('https://desk.example/one');
  });
});

describe('Send to My Devices', () => {
  it('goes from the phone to the desktop and back, end to end encrypted', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await mobile.sync.sendToDevices('https://sent.example/from-phone', 'Read this');
    const atDesk = await pc.engine.dropFetch();
    expect(atDesk.map(item => [item.url, item.title])).toEqual([['https://sent.example/from-phone', 'Read this']]);
    await pc.engine.dropSend('https://sent.example/from-pc', 'And this');
    const atPhone = await mobile.sync.receiveFromDevices();
    expect(atPhone.map(item => [item.url, item.title, item.from])).toEqual([['https://sent.example/from-pc', 'And this', 'PC']]);
    // Handed over once.
    expect(await mobile.sync.receiveFromDevices()).toEqual([]);
    // Nothing in the mailbox can be read by the worker.
    expect(JSON.stringify([...stand.env.VEX_SYNC_KV.map.values()])).not.toContain('sent.example');
  });

  it('refuses anything but a web address', async () => {
    await desktopWithAccount();
    const mobile = await joinedPhone();
    await expect(mobile.sync.sendToDevices('file:///sdcard/x')).rejects.toThrow(/web addresses/);
  });
});

describe('v2.35.2 (§5.4, §6 rule 11)', () => {
  it('§5.4: joining keeps a local bookmark whose address the account only has as a tombstone', async () => {
    await desktopWithAccount();
    // The PC deletes its second bookmark: the account now holds it as a tombstone.
    pc.local.set('vex.bookmarks', JSON.stringify([
      { id: 'bmdesk1', url: 'https://desk.example/one', title: 'Desk one', folder: 'Work', at: 1700000000001 }
    ]));
    await pc.engine.pushNow();
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    await mobile.bookmarks.add({ url: 'https://desk.example/two', title: 'Saved on the phone' });
    await mobile.bookmarks.add({ url: 'https://desk.example/one', title: 'Same page, phone id' });
    await mobile.sync.signIn(EMAIL, await codeFor(mobile, EMAIL), recovery);
    // The live match is dropped for the account's copy; the tombstoned one stays.
    expect(mobile.bookmarks.all().map(item => item.url).sort()).toEqual(['https://desk.example/one', 'https://desk.example/two']);
    expect(mobile.bookmarks.all().find(item => item.url === 'https://desk.example/one').id).toBe('bmdesk1');
    const { doc } = await accountDocument(stand, recovery);
    const live = Object.entries(doc.records).filter(([key, r]) => sourceOf(key) === 'preference:vex.bookmarks' && !r.deleted && r.value && r.value.item)
      .map(([, r]) => r.value.item);
    expect(live.map(item => item.url).sort()).toEqual(['https://desk.example/one', 'https://desk.example/two']);
    expect(live.find(item => item.url === 'https://desk.example/two').id).not.toBe('bmdesk2');
  });

  it('rule 11: a record of a source it does not own that fails the contracts is carried, not refused', async () => {
    await desktopWithAccount();
    const { doc } = await accountDocument(stand, recovery);
    // A property name data-contracts rejects, in a source nobody here owns.
    doc.records['["preference:vex.fromTheFuture","type"]'] = { clock: { future1: 1 }, deleted: false, value: 'scalar', at: 1, conflicts: [] };
    doc.records['["preference:vex.fromTheFuture","value"]'] = { clock: { future1: 1 }, deleted: false, value: JSON.parse('{"constructor":1,"b":[2]}'), at: 1, conflicts: [] };
    await stand.putDocument(doc, recovery);
    const before = recordTexts((await accountDocument(stand, recovery)).doc);
    const mobile = await joinedPhone();
    await mobile.bookmarks.add({ url: 'https://phone.example/rule11', title: 'Still syncs' });
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    const after = recordTexts((await accountDocument(stand, recovery)).doc);
    expect(after['["preference:vex.fromTheFuture","type"]']).toBe(before['["preference:vex.fromTheFuture","type"]']);
    expect(after['["preference:vex.fromTheFuture","value"]']).toBe(before['["preference:vex.fromTheFuture","value"]']);
    expect(Object.values(after).some(text => text.includes('https://phone.example/rule11'))).toBe(true);
    // And the v2.35.2 desktop, which does not read it either, still syncs.
    expect((await pc.engine.pushNow()).ok !== false).toBe(true);
  });
});

describe('what the phone reads from the computer', () => {
  it('shows the computer’s open tabs in its groups, and its history, without writing either back', async () => {
    await desktopWithAccount();
    pc.storage.set('groups', [
      { id: 'g1', name: 'Work', color: 'blue', collapsed: false },
      { id: 'g2', name: 'Trip', color: '#e8574b', collapsed: true }
    ]);
    pc.storage.set('tabs', [
      { id: 't1', url: 'https://mail.example/', title: 'Mail', groupId: 'g1', pinned: true },
      { id: 't2', url: 'https://docs.example/q3', title: 'Q3 plan', groupId: 'g1' },
      { id: 't3', url: 'https://flights.example/', title: 'Flights', groupId: 'g2' },
      { id: 't4', url: 'https://news.example/', title: 'News' },
      { id: 't5', url: 'file:///C:/secret.txt', title: 'Not a web page' }
    ]);
    pc.local.set('vex.history', JSON.stringify([
      { id: 'h_1767225600000_aaaaa', url: 'https://tides.example/spring', title: 'Spring tides', favicon: '', visitedAt: '2026-10-04T20:00:00.000Z', indexed: false },
      { id: 'h_1767225500000_bbbbb', url: 'https://lamps.example/', title: 'Desk lamps', favicon: '', visitedAt: '2026-10-04T19:00:00.000Z', indexed: false }
    ]));
    await pc.engine.pushNow();
    const before = recordTexts((await accountDocument(stand, recovery)).doc);

    const mobile = await joinedPhone();
    const groups = mobile.sync.remoteTabGroups();
    expect(groups.map(group => [group.name, group.color, group.tabs.map(tab => tab.title)])).toEqual([
      ['Work', '#4f86f7', ['Mail', 'Q3 plan']],
      ['Trip', '#e8574b', ['Flights']],
      ['', '', ['News']]
    ]);
    expect(groups[0].tabs[0].pinned).toBe(true);
    expect(mobile.sync.remoteHistory('tides').map(entry => entry.title)).toEqual(['Spring tides']);
    expect(mobile.sync.remoteHistory('', 10)).toHaveLength(2);

    // Nothing of the computer's — tabs, groups, history — is written by the phone.
    await mobile.bookmarks.add({ url: 'https://phone.example/read', title: 'Phone' });
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    const after = recordTexts((await accountDocument(stand, recovery)).doc);
    for (const [key, text] of Object.entries(before)) {
      if (/^\["(storage:tabs|storage:groups|preference:vex\.history)"/.test(key)) expect(after[key], key).toBe(text);
    }
  });
});
