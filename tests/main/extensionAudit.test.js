// What an extension can actually do, read out of its manifest. This decides
// what a person is told about something already installed, so it must not
// understate reach: every way a manifest can ask for "all sites" has to come
// out as all sites.
import { describe, it, expect } from 'vitest';
const { auditOne, reach, powers, hostsOf } = require('../../src/main/extension-audit.js');

const m = (manifest) => ({ folder: 'x', manifest });

describe('what it can read', () => {
  it('<all_urls>, a bare star, and http(s)://*/* all mean every page', () => {
    for (const p of ['<all_urls>', '*://*/*', 'https://*/*', 'http://*/*']) {
      expect(reach({ host_permissions: [p] }).level, p).toBe('all');
    }
    expect(reach({ permissions: ['<all_urls>'] }).level).toBe('all');
    expect(reach({ content_scripts: [{ matches: ['*://*/*'] }] }).level).toBe('all');
  });

  it('named sites are named, and counted when there are many', () => {
    const few = reach({ host_permissions: ['https://*.github.com/*', 'https://news.ycombinator.com/*'] });
    expect(few.level).toBe('some');
    expect(few.hosts).toEqual(['github.com', 'news.ycombinator.com']);
    expect(few.says).toContain('github.com');

    const many = reach({ host_permissions: ['https://a.com/*', 'https://b.com/*', 'https://c.com/*', 'https://d.com/*', 'https://e.com/*'] });
    expect(many.says).toMatch(/and 2 more/);
  });

  it('activeTab alone is "only when you click it"', () => {
    expect(reach({ permissions: ['activeTab', 'storage'] }).level).toBe('click');
  });

  it('an extension that asks for no pages says so', () => {
    expect(reach({ permissions: ['storage'] })).toMatchObject({ level: 'none', hosts: [] });
    expect(reach({})).toMatchObject({ level: 'none' });
  });

  it('host patterns are read from all three places a manifest puts them', () => {
    const out = hostsOf({
      host_permissions: ['https://one.example/*'],
      permissions: ['https://two.example/*', 'storage'],
      content_scripts: [{ matches: ['https://*.three.example/*'] }],
    });
    expect(out.hosts).toEqual(['one.example', 'three.example', 'two.example']);
    expect(out.all).toBe(false);
  });
});

describe('what it is allowed to do', () => {
  it('turns permissions into sentences, the heavy ones first', () => {
    const out = powers({ permissions: ['storage', 'cookies', 'notifications', 'nativeMessaging'] });
    expect(out.slice(0, 2).every(p => p.heavy)).toBe(true);
    expect(out.map(p => p.id)).toEqual(['cookies', 'nativeMessaging', 'notifications', 'storage']);
    expect(out[0].says).toMatch(/signed in/);
  });

  it('optional permissions count too — they can be granted later', () => {
    expect(powers({ optional_permissions: ['history'] }).map(p => p.id)).toEqual(['history']);
  });

  it('jargon nobody needs is left out rather than shown', () => {
    expect(powers({ permissions: ['alarms', 'contextMenus', 'unknownThing'] })).toEqual([]);
  });

  it('the same permission twice is one line', () => {
    expect(powers({ permissions: ['tabs'], optional_permissions: ['tabs'] })).toHaveLength(1);
  });
});

describe('which ones to look at first', () => {
  it('reads-everything outranks reads-a-few, which outranks click-only', () => {
    const all = auditOne(m({ host_permissions: ['<all_urls>'] }));
    const some = auditOne(m({ host_permissions: ['https://github.com/*'] }));
    const click = auditOne(m({ permissions: ['activeTab'] }));
    const none = auditOne(m({ permissions: ['storage'] }));
    expect(all.weight).toBeGreaterThan(some.weight);
    expect(some.weight).toBeGreaterThan(click.weight);
    expect(click.weight).toBeGreaterThan(none.weight);
  });

  it('heavy powers push an extension up even when it names only one site', () => {
    const plain = auditOne(m({ host_permissions: ['https://a.com/*'] }));
    const heavy = auditOne(m({ host_permissions: ['https://a.com/*'], permissions: ['cookies', 'history', 'nativeMessaging'] }));
    expect(heavy.weight).toBeGreaterThan(plain.weight);
  });

  it('a manifest that is missing or broken is audited as "nothing", not thrown over', () => {
    expect(() => auditOne({ folder: 'x' })).not.toThrow();
    expect(auditOne({ folder: 'x' }).reach.level).toBe('none');
    expect(auditOne(m({ permissions: 'not a list', content_scripts: 'nope' })).powers).toEqual([]);
  });
});
