// An answer formats itself as it is written. It used to arrive as plain text
// and only become headings, bold and lists once it had finished — so while
// you were reading it there was no way to see what the important parts were.
// The thing that made plain text tempting is a half-written code fence, so
// that is what this leans on.
import { describe, it, expect, beforeEach } from 'vitest';
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

beforeEach(() => {
  globalThis.window = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    VexMarkdown: { render: (s) => 'MD(' + s + ')' },
  };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  // _md runs every answer past the video-chat linkifier and the tab it is
  // about; neither is what this is testing.
  globalThis.VideoChat = { linkify: (html) => html };
  globalThis.VexMarkdown = window.VexMarkdown;
  globalThis.TabManager = { tabs: [], activeTabId: null };
});

describe('markdown while it is still being written', () => {
  it('formats what has arrived so far', () => {
    expect(AIPanel._streamMarkdown('## Heading\n\n- one')).toBe('MD(## Heading\n\n- one)');
  });

  it('closes a code fence that has not been closed yet', () => {
    // Without this the open fence swallows the rest of the answer and the
    // reader sees one growing grey box instead of the text.
    expect(AIPanel._streamMarkdown('Here:\n```js\nconst a = 1;')).toBe('MD(Here:\n```js\nconst a = 1;\n```)');
  });

  it('leaves a finished code block alone', () => {
    const done = 'Here:\n```js\nconst a = 1;\n```\nand then';
    expect(AIPanel._streamMarkdown(done)).toBe('MD(' + done + ')');
  });

  it('counts a fence even when it is indented inside a list', () => {
    expect(AIPanel._streamMarkdown('1. step\n   ```sh\n   npm i')).toMatch(/\n```\)$/);
  });

  it('nothing written yet is nothing rendered', () => {
    expect(AIPanel._streamMarkdown('')).toBe('MD()');
    expect(AIPanel._streamMarkdown(null)).toBe('MD()');
  });
});
