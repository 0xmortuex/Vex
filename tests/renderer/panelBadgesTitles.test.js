// @vitest-environment jsdom
//
// The sidebar's unread badges come from each panel's page title. They used to
// read any "(N)" anywhere and any "• N", so Spotify's "In Da Club • 50 Cent"
// showed 50 unread, and a slept panel kept its last count on the icon for good.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexJobs = { every: vi.fn(() => 1) };
require('../../src/renderer/js/panel-badges.js');
const PanelBadges = window.PanelBadges;

describe('reading an unread count from a title', () => {
  it('reads a leading "(N)" and "N new / unread"', () => {
    expect(PanelBadges._unreadFromTitle('(5) Discord | #general', 'discord')).toBe(5);
    expect(PanelBadges._unreadFromTitle('(3) WhatsApp', 'whatsapp')).toBe(3);
    expect(PanelBadges._unreadFromTitle('Inbox - 12 unread', 'mail')).toBe(12);
    expect(PanelBadges._unreadFromTitle('3 new messages', 'slack')).toBe(3);
  });

  it('does not treat a Spotify "Song • Artist" title as unread messages', () => {
    expect(PanelBadges._unreadFromTitle('In Da Club • 50 Cent', 'spotify')).toBe(0);
    expect(PanelBadges._unreadFromTitle('a lot • 21 Savage', 'spotify')).toBe(0);
    expect(PanelBadges._unreadFromTitle('Changes • 2Pac', 'spotify')).toBe(0);
    // whatever the panel, a bullet and a number is a name
    expect(PanelBadges._unreadFromTitle('In Da Club • 50 Cent')).toBe(0);
    // Spotify never counts messages, even a title that looks like it
    expect(PanelBadges._unreadFromTitle('(2) Song name', 'spotify')).toBe(0);
  });

  it('does not treat a number in brackets inside a title as unread', () => {
    expect(PanelBadges._unreadFromTitle('Thriller (1982) - Claude', 'claude')).toBe(0);
    expect(PanelBadges._unreadFromTitle('Chapter 3 (2) - GitHub', 'github')).toBe(0);
  });
});

describe('Gmail title form', () => {
  const gmail = 'https://mail.google.com/mail/u/0/';

  it('reads "Inbox (6,693)" with the separators stripped', () => {
    expect(PanelBadges._unreadFromTitle('Inbox (6,693) - name@gmail.com - Gmail', 'site-gmail', gmail)).toBe(6693);
    expect(PanelBadges._unreadFromTitle('Gelen Kutusu (12) - name@gmail.com - Gmail', 'site-gmail', gmail)).toBe(12);
  });

  it('shows no badge when Gmail has no count', () => {
    expect(PanelBadges._unreadFromTitle('Inbox - name@gmail.com - Gmail', 'site-gmail', gmail)).toBe(0);
  });

  it('ignores the same title shape on any other site', () => {
    expect(PanelBadges._unreadFromTitle('Inbox (6,693) - name@example.com - Mail', 'site-x', 'https://example.com/')).toBe(0);
    expect(PanelBadges._unreadFromTitle('Inbox (6,693) - name@gmail.com - Gmail', 'site-x')).toBe(0);
    expect(PanelBadges._unreadFromTitle('Inbox (5)', 'site-x', 'https://evilmail.google.com.example.org/')).toBe(0);
  });

  it('keeps the leading "(N)" form on Gmail and elsewhere', () => {
    expect(PanelBadges._unreadFromTitle('(5) Discord', 'discord', 'https://discord.com/app')).toBe(5);
    expect(PanelBadges._unreadFromTitle('(5) Gmail', 'site-gmail', gmail)).toBe(5);
  });
});

describe('a slept panel', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button class="sidebar-icon" data-panel="discord"></button>
      <button class="sidebar-icon" data-panel="whatsapp"></button>`;
  });

  it('loses its badge on the next sweep, and at once when it is slept', () => {
    const wv = { getTitle: () => '(4) Discord' };
    globalThis.SidebarManager = { panelWebviews: { discord: wv, whatsapp: { getTitle: () => '(1) WhatsApp' } } };
    PanelBadges.start();
    expect(document.querySelector('[data-panel="discord"] .panel-badge').textContent).toBe('4');
    delete SidebarManager.panelWebviews.discord;
    document.dispatchEvent(new CustomEvent('vex:panel-slept', { detail: { panel: 'discord' } }));
    expect(document.querySelector('[data-panel="discord"] .panel-badge')).toBe(null);
    expect(document.querySelector('[data-panel="whatsapp"] .panel-badge').textContent).toBe('1');
    expect(PanelBadges._total).toBe(1);
  });
});
