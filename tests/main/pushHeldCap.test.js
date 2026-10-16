// Audit (2026-10): the held-notification wrapper in preload-webview.js sent every held notification to the
// host window, with no limit per page. It now holds at most 20 per page load and shows the rest as asked.
// The section is cut out of the preload and run against a stand-in electron and window.
import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
const start = SRC.indexOf('// === Site notifications held for the hourly bundle');
const end = SRC.indexOf('// === Where this tab\'s sound comes out');

function page() {
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  class FakeNotification { constructor(title, options) { this.title = title; this.options = options; } }
  FakeNotification.permission = 'granted';
  const win = { location: { hostname: 'shop.example.com', protocol: 'https:' }, Notification: FakeNotification };
  const sent = [];
  const handlers = {};
  const electron = {
    contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
    ipcRenderer: { on: (ch, fn) => { handlers[ch] = fn; }, sendToHost: vi.fn((ch, payload) => { sent.push({ ch, payload }); }) },
  };
  new Function('require', 'window', SRC.slice(start, end))((name) => { if (name === 'electron') return electron; throw new Error('unexpected require ' + name); }, win);
  handlers['vex-push-rules']({}, { hosts: ['shop.example.com'], pass: '' });
  return { win, sent, FakeNotification };
}

describe('held notifications are capped per page', () => {
  it('holds 20, then shows the rest as the page asked', () => {
    const { win, sent, FakeNotification } = page();
    const results = [];
    for (let i = 0; i < 25; i++) results.push(new win.Notification('Sale ' + i, { body: 'half price' }));
    expect(sent.filter(s => s.ch === 'vex-push-held')).toHaveLength(20);
    // The first 20 are inert stand-ins, the last 5 are the page's real Notification.
    expect(results.slice(0, 20).every(r => !(r instanceof FakeNotification))).toBe(true);
    expect(results.slice(20).every(r => r instanceof FakeNotification)).toBe(true);
    expect(results[24].title).toBe('Sale 24');
  });

  it('wraps a listed page Notification and sends nothing until one is shown', () => {
    const { win, sent, FakeNotification } = page();
    expect(win.Notification).not.toBe(FakeNotification);
    expect(sent).toHaveLength(0);
  });
});
