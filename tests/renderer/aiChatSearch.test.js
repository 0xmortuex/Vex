// @vitest-environment jsdom
//
// Three things about a long chat: searching every chat at once (they are one
// per tab, so a closed tab's chat was unreachable), the line showing where
// the model's memory of the chat begins, and what a cited source says.
import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.AgentTools = { youtubeId: () => null };
globalThis.VideoChat = require('../../src/renderer/js/video-chat.js').VideoChat;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<input id="ai-history-search"><div class="ai-history-list" id="ai-history-list"></div><div id="ai-messages"></div>';
  globalThis.TabManager = { tabs: [{ id: 't1', title: 'Boiler quotes', url: 'https://a.example' }], activeTabId: 't1' };
  globalThis.AgentLoop = { runs: () => [], isRunning: () => false };
  AIPanel._conversations = {
    t1: [{ role: 'user', content: 'What does a new boiler cost?' }, { role: 'assistant', content: 'Around £2,000 fitted.' }],
    t9: [{ role: 'user', content: 'Explain the tides' }, { role: 'assistant', content: 'The Moon pulls the sea.' }],
  };
});

describe('searching every chat', () => {
  const search = (q) => { document.getElementById('ai-history-search').value = q; AIPanel._renderHistory(); return [...document.querySelectorAll('.ai-history-item')].map(b => b.textContent); };

  it('finds a chat by a word in any message, including one whose tab is closed, and shows the line that matched', () => {
    const rows = search('moon');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Vex: The Moon pulls the sea.');
  });

  it('matches what you asked too, and says so when nothing matches', () => {
    expect(search('boiler')).toHaveLength(1);
    search('kangaroo');
    expect(document.querySelector('.ai-history-empty').textContent).toBe('No chat mentions “kangaroo”.');
  });

  it('with an empty box it is the ordinary list again', () => {
    expect(search('')).toHaveLength(2);
  });
});

describe('the line where the model stops remembering', () => {
  it('is drawn once a chat is longer than what is sent, above the messages it can still see', () => {
    AIPanel._conversations.t1 = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }));
    AIPanel._renderMessages();
    const nodes = [...document.getElementById('ai-messages').children];
    const i = nodes.findIndex(n => n.classList.contains('ai-context-mark'));
    expect(i).toBe(3);                                   // 13 messages, the last 10 are sent
    expect(nodes[i].textContent).toBe('The model only sees the messages below this line');
  });

  it('is not drawn for a short chat', () => {
    AIPanel._renderMessages();
    expect(document.querySelector('.ai-context-mark')).toBeNull();
  });
});

describe('resting on a source an answer cites', () => {
  it('shows its title and first words, and says so when it cannot be read', async () => {
    globalThis.AgentTools = { readUrl: vi.fn(async () => ({ title: 'How tides work', text: '  The Moon pulls\n the sea. ' })) };
    const a = document.createElement('a');
    a.className = 'vex-md-link';
    a.href = 'https://ocean.example/tides';
    document.body.appendChild(a);
    a.matches = () => true;                              // jsdom has no real hover
    await AIPanel._previewSource(a);
    expect(document.querySelector('.ai-source-card').textContent).toBe('How tides work — The Moon pulls the sea.');
    AIPanel._SOURCE_CACHE.clear();
    AgentTools.readUrl = vi.fn(async () => { throw new Error('that page refused'); });
    await AIPanel._previewSource(a);
    expect(document.querySelector('.ai-source-card').textContent).toBe('Could not read it: that page refused');
  });
});
