// @vitest-environment node
// Unfinished-form rescue, main side: a closed tab's typed text is kept (encrypted) for a week, bounded, and can be dropped.
// And the List-Unsubscribe header the newsletter lane reads: https only, nothing else.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTabSnapshots } = require('../../src/main/tab-snapshots.js');
const { unsubscribeUrl } = require('../../src/main/mail.js');
const { SecretStore, JsonStore } = require('../../src/main/file-store.js');

const DAY = 24 * 3600 * 1000;
const fakeSafe = () => ({
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64'), 'utf8'),
  decryptString: (b) => Buffer.from(b.toString('utf8'), 'base64').toString('utf8'),
});
function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-rescue-'));
  const safe = fakeSafe();
  const t = { now: 1_800_000_000_000 };
  const svc = createTabSnapshots({ secrets: new SecretStore(safe), plain: new JsonStore(dir), file: path.join(dir, 'tab-snapshots.vex'), encryptionAvailable: () => true, now: () => t.now });
  return { svc, t, dir };
}
const entry = (url, v) => ({ url, scroll: { x: 0, y: 0 }, fields: [{ s: '#c', i: 0, v }], title: 'Page' });

describe('closed tabs keep their typed text', () => {
  it('marks the page closed, keeps it for 7 days and then lets it go', async () => {
    const { svc, t } = build();
    await svc.save({ entries: [entry('https://a.example/form', 'my unsent message')], keepUrls: [] });
    await svc.save({ entries: [], keepUrls: [], closedUrls: ['https://a.example/form'] });
    let back = await svc.load();
    expect(back.entries).toHaveLength(1);
    expect(back.entries[0]).toMatchObject({ closed: true, title: 'Page' });
    expect(back.entries[0].fields[0].v).toBe('my unsent message');
    // a later round with no mention of it keeps it
    t.now += 3 * DAY;
    await svc.save({ entries: [], keepUrls: [] });
    expect((await svc.load()).entries).toHaveLength(1);
    t.now += 5 * DAY;
    expect((await svc.load()).entries).toHaveLength(0);
    await svc.save({ entries: [], keepUrls: [] });
    expect((await svc.load()).entries).toHaveLength(0);
  });

  it('does not keep a page that is still open elsewhere, or a close with nothing typed', async () => {
    const { svc } = build();
    await svc.save({ entries: [entry('https://a.example/', 'x')], keepUrls: [] });
    await svc.save({ entries: [], keepUrls: ['https://a.example/'], closedUrls: ['https://a.example/'] });
    expect((await svc.load()).entries[0].closed).toBeUndefined();
    await svc.save({ entries: [], keepUrls: [], closedUrls: ['https://never.example/'] });
    expect((await svc.load()).entries.find(e => e.url === 'https://never.example/')).toBeUndefined();
  });

  it('keeps at most 10 rescued pages and replaces one when the page is typed in again', async () => {
    const { svc } = build();
    const urls = Array.from({ length: 12 }, (_, i) => 'https://s' + i + '.example/');
    await svc.save({ entries: urls.map(u => entry(u, 'text ' + u)), keepUrls: [] });
    await svc.save({ entries: [], keepUrls: [], closedUrls: urls });
    const kept = (await svc.load()).entries;
    expect(kept).toHaveLength(10);
    await svc.save({ entries: [entry(urls[0], 'new text')], keepUrls: [] });
    const again = (await svc.load()).entries.find(e => e.url === urls[0]);
    expect(again.closed).toBeUndefined();
    expect(again.fields[0].v).toBe('new text');
  });

  it('drops one page on request, and stores nothing readable in the profile', async () => {
    const { svc, dir } = build();
    await svc.save({ entries: [entry('https://a.example/', 'private words')], keepUrls: [] });
    await svc.save({ entries: [], keepUrls: [], closedUrls: ['https://a.example/'] });
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).not.toContain('private words');
    await svc.drop('https://a.example/');
    expect((await svc.load()).entries).toEqual([]);
    await expect(svc.drop('javascript:1')).rejects.toThrow(/web address/);
  });
});

describe('List-Unsubscribe', () => {
  it('takes the https address and ignores mailto', () => {
    expect(unsubscribeUrl('List-Unsubscribe: <mailto:u@x.test>, <https://x.test/u?a=1>\r\n')).toBe('https://x.test/u?a=1');
    expect(unsubscribeUrl(Buffer.from('List-Unsubscribe: <mailto:u@x.test>\r\n'))).toBe('');
    expect(unsubscribeUrl('List-Unsubscribe: <http://x.test/u>\r\n')).toBe('');
    expect(unsubscribeUrl('List-Unsubscribe: <https://user:pw@x.test/u>\r\n')).toBe('');
    expect(unsubscribeUrl('List-Unsubscribe: <https://x.test/a>,\r\n <https://x.test/b>\r\n')).toBe('https://x.test/a');
    expect(unsubscribeUrl(undefined)).toBe('');
  });
});
