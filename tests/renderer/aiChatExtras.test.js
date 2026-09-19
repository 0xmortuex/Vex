// @vitest-environment jsdom
//
// The chat's finishing touches: answers saved as notes, where to go next,
// chats that can be pinned and named, pictures pasted into the box, and
// "Debug" on a selected error.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');
globalThis.VideoChat = require('../../src/renderer/js/video-chat.js').VideoChat;

const CONV = [
  { role: 'user', content: 'Compare the Pixel 9 and iPhone 16' },
  { role: 'assistant', content: '| | Pixel | iPhone |\n|---|---|---|\n| Price | 799 | 829 |\nSources: https://a.example/review and https://b.example/specs.' },
];

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="ai-panel"><div id="ai-messages"></div><div class="ai-input-row"><textarea id="ai-input"></textarea></div><div id="ai-history-list"></div></div>';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1', title: 'Phones' }], createTab: vi.fn() };
  globalThis.AgentTools = { saveNote: vi.fn(), youtubeId: () => null };
  AIPanel._conversations = { t1: CONV.map(m => ({ ...m })) };
  AIPanel._viewingId = null;
  AIPanel._pendingImage = null;
});

describe('answers', () => {
  it('any answer can be saved as a note, titled with its question', () => {
    AIPanel._renderMessages();
    const answer = document.querySelectorAll('.ai-msg.assistant')[0];
    answer.querySelector('[title="Save as note"]').click();
    expect(AgentTools.saveNote).toHaveBeenCalledWith('Compare the Pixel 9 and iPhone 16', CONV[1].content);
  });

  it('under the latest answer: dig deeper, and open the sources it cites', () => {
    const send = vi.spyOn(AIPanel, 'sendMessage').mockResolvedValue();
    AIPanel._renderMessages();
    const chips = [...document.querySelectorAll('.ai-next-chips .follow-up-btn')];
    expect(chips.map(c => c.textContent)).toEqual(['Dig deeper', 'Open the 2 sources']);
    chips[1].click();
    expect(TabManager.createTab.mock.calls.map(c => c[0])).toEqual(['https://a.example/review', 'https://b.example/specs']);
    chips[0].click();
    expect(send).toHaveBeenCalledWith('chat', { message: expect.stringMatching(/Go deeper/) });
    send.mockRestore();
  });

  it('no "open sources" when the answer cites none', () => {
    AIPanel._conversations = { t1: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }] };
    AIPanel._renderMessages();
    expect([...document.querySelectorAll('.ai-next-chips .follow-up-btn')].map(c => c.textContent)).toEqual(['Dig deeper']);
  });
});

describe('the chat list', () => {
  it('a chat can be named and pinned, and pinned ones come first', async () => {
    AIPanel._conversations = { old: [{ role: 'user', content: 'Older chat' }], t1: CONV.map(m => ({ ...m })) };
    window.vexPrompt = vi.fn(async () => 'Phone shopping');
    AIPanel._renderHistory();
    let items = [...document.querySelectorAll('.ai-history-item')];
    expect(items[0].querySelector('.t').textContent).toBe('Compare the Pixel 9 and iPhone 16');   // newest first
    const older = items.find(i => i.textContent.includes('Older chat'));
    [...older.querySelectorAll('button')].find(b => b.textContent === 'Pin').click();
    await Promise.resolve();
    items = [...document.querySelectorAll('.ai-history-item')];
    expect(items[0].querySelector('.t').textContent).toBe('Pinned · Older chat');
    const phones = items.find(i => i.textContent.includes('Pixel'));
    [...phones.querySelectorAll('button')].find(b => b.textContent === 'Rename').click();
    await new Promise(r => setTimeout(r, 0));
    expect([...document.querySelectorAll('.ai-history-item .t')].map(t => t.textContent)).toContain('Phone shopping');
  });

  it('a whole chat can be kept as one note', () => {
    AIPanel._renderHistory();
    [...document.querySelectorAll('.ai-history-item button')].find(b => b.textContent === 'To note').click();
    expect(AgentTools.saveNote).toHaveBeenCalledWith('Compare the Pixel 9 and iPhone 16', expect.stringMatching(/^\*\*You:\*\* Compare.*\*\*Vex AI:\*\*/s));
  });
});

describe('a picture in the box', () => {
  it('attached, shown, sent with the question, then cleared', async () => {
    const send = vi.spyOn(AIPanel, 'sendMessage').mockResolvedValue();
    vi.spyOn(AIPanel, 'isOpen').mockReturnValue(true);
    AIPanel._attachImage(new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }));
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('ai-attach')).not.toBeNull();
    document.getElementById('ai-input').value = '';
    await AIPanel._sendChat();
    expect(send).toHaveBeenCalledWith('chat', { message: 'What is in this image?', image: expect.stringMatching(/^data:image\/png;base64,/) });
    expect(document.getElementById('ai-attach')).toBeNull();
    expect(AIPanel._pendingImage).toBeNull();
    send.mockRestore();
  });

  it('refuses a picture over 8 MB', () => {
    AIPanel._attachImage({ size: 9 * 1024 * 1024, type: 'image/png' });
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/over 8 MB/), 'error');
    expect(AIPanel._pendingImage).toBeNull();
  });
});
