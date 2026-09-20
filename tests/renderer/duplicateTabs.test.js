// Opening a page you already have open. The risk here is the opposite of the
// feature: a tab that should have opened being swallowed. So a container's
// tabs are separate, a Vex page never matches, and it can be switched off.
import { describe, it, expect, beforeEach } from 'vitest';
const { DuplicateTabs: D } = require('../../src/renderer/js/duplicate-tabs.js');

const store = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  globalThis.window = { showToast: () => {} };
});

const tabs = [
  { id: 1, url: 'https://mail.google.com/mail/u/0/', partition: null },
  { id: 2, url: 'https://mail.google.com/mail/u/0/', partition: 'persist:container-work' },
  { id: 3, url: 'https://example.com/', partition: 'persist:main' },
];

describe('what counts as the same page', () => {
  it('the fragment is a place on a page, not another page', () => {
    expect(D.norm('https://example.com/docs#install')).toBe(D.norm('https://example.com/docs'));
  });

  it('a trailing slash on a bare host is not another page', () => {
    expect(D.norm('https://example.com/')).toBe(D.norm('https://example.com'));
  });

  it('a different query is a different page', () => {
    expect(D.norm('https://example.com/s?q=a')).not.toBe(D.norm('https://example.com/s?q=b'));
  });

  it('a Vex page or a file is never matched', () => {
    expect(D.norm('file:///C:/start.html')).toBe('');
    expect(D.match(tabs, 'file:///C:/start.html', null)).toBe(null);
  });
});

describe('finding the tab you already have', () => {
  it('finds it in the same container', () => {
    expect(D.match(tabs, 'https://mail.google.com/mail/u/0/', null).id).toBe(1);
    expect(D.match(tabs, 'https://mail.google.com/mail/u/0/', 'persist:main').id).toBe(1);
    expect(D.match(tabs, 'https://mail.google.com/mail/u/0/', 'persist:container-work').id).toBe(2);
  });

  it('a container with no tab of its own opens its own', () => {
    expect(D.match(tabs, 'https://example.com/', 'persist:container-shopping')).toBe(null);
  });

  it('a page nobody has open opens', () => {
    expect(D.match(tabs, 'https://other.example/', null)).toBe(null);
  });

  it('switched off, it never matches anything', () => {
    D.setEnabled(false);
    expect(D.match(tabs, 'https://example.com/', null)).toBe(null);
    D.setEnabled(true);
    expect(D.match(tabs, 'https://example.com/', null).id).toBe(3);
  });

  it('is on unless it was turned off', () => {
    expect(D.enabled()).toBe(true);
    expect(D.toggle()).toBe(false);
    expect(D.toggle()).toBe(true);
  });
});
