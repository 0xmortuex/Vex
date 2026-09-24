// @vitest-environment jsdom
//
// Send decides. There used to be two buttons — Send (chat) and a robot (agent)
// — and the user had to know in advance which one a request needed. Now a
// task, or a question a chat model could only guess at, runs as the agent;
// anything about the page, writing or explaining is answered as chat.
//
// And an agent run is part of the tab's conversation. It used to exist only on
// screen: reopening the panel redrew from an empty conversation, so the
// question, the steps and the answer were gone, with nothing in Recent chats.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');
globalThis.AgentTools = globalThis.AgentTools || require('../../src/renderer/js/agent-tools.js').AgentTools;
globalThis.VideoChat = require('../../src/renderer/js/video-chat.js').VideoChat;

const MARKUP = `
  <div id="ai-panel" class="open"></div>
  <textarea id="ai-input"></textarea>
  <button id="ai-send"></button>
  <button id="ai-stop-agent"></button>
  <div id="ai-messages"></div>`;

let finish;
beforeEach(() => {
  document.body.innerHTML = MARKUP;
  localStorage.clear();
  localStorage.setItem('vex.agentModeChosen', '1');
  AIPanel._conversations = {}; AIPanel._convPrivate = {}; AIPanel._viewingId = null; AIPanel._sending = false; AIPanel._agentTabId = null; AIPanel._agentMode = 'auto';
  AIPanel.isOpen = () => true;
  AIPanel.sendMessage = vi.fn(async () => {});
  globalThis.TabManager = { activeTabId: 'tab1', tabs: [{ id: 'tab1', title: 'A page', url: 'https://a.example/' }], getActiveTab() { return this.tabs[0]; } };
  let running = false;
  globalThis.AgentLoop = {
    lastRun: null, _runs: [],
    isRunning: () => running,
    runs() { return this._runs; },
    showRun: vi.fn(),
    start: vi.fn((goal) => { running = true; return new Promise(res => { finish = (final) => { running = false; const run = { id: 'run_1', goal, final, steps: [{}] }; AgentLoop.lastRun = run; AgentLoop._runs = [run]; res(); }; }); }),
  };
  window.showToast = vi.fn();
});

describe('AIPanel.routeMessage', () => {
  const agent = (s) => AIPanel.routeMessage(s).agent;

  it('a task is for the agent', () => {
    for (const s of [
      'group my github tabs', 'Start an 20 minute timer', 'set an alarm for 7am on weekdays', 'remind me to call Dana tomorrow at 9',
      'open youtube and play lofi', 'go to github.com', 'click the sign in button', 'fill in this form with my details',
      'bookmark this page', 'group my tabs by topic', 'rename my tab groups', 'close all the youtube tabs',
      'hey vex, can you please open reddit', 'Could you search the web for cheap flights to Rome', 'research the best 1440p monitors and save a note',
      'take a screenshot', 'book a table for two',
    ]) expect(agent(s), s).toBe(true);
  });

  it('a question a chat model can only guess at is for the agent, which can look it up', () => {
    for (const s of ['what is the latest version of Node.js', "what's the weather in Istanbul today", 'who won the match tonight', 'price of bitcoin right now', 'any news about the Artemis launch']) expect(agent(s), s).toBe(true);
  });

  it('the page, writing and explaining are chat', () => {
    for (const s of [
      'summarize this page', 'what is this article about?', 'explain this to me simply', 'translate this page to Turkish', 'tl;dr',
      'what does this mean', 'rewrite this paragraph to sound friendlier', 'write me a poem about autumn', 'how do I reverse a list in python?',
      'why is the sky blue', 'hello', 'is the current page trustworthy?', 'find the pricing on this page', 'what are the key points of the video',
    ]) expect(agent(s), s).toBe(false);
  });

  it('/agent and /chat force it, and the prefix is not part of the message', () => {
    expect(AIPanel.routeMessage('/agent why is the sky blue')).toEqual({ agent: true, text: 'why is the sky blue' });
    expect(AIPanel.routeMessage('/chat open youtube')).toEqual({ agent: false, text: 'open youtube' });
    expect(AIPanel.routeMessage('  start a timer  ').text).toBe('start a timer');
  });
});

describe('Send', () => {
  it('runs a task as the agent, in the chosen permission mode', async () => {
    document.getElementById('ai-input').value = 'group my github tabs';
    await AIPanel._sendChat();
    expect(AgentLoop.start).toHaveBeenCalledWith('group my github tabs', 'auto');
    expect(AIPanel.sendMessage).not.toHaveBeenCalled();
    expect(document.getElementById('ai-input').value).toBe('');
  });

  it('answers a question as chat', async () => {
    document.getElementById('ai-input').value = 'summarize this page';
    await AIPanel._sendChat();
    expect(AgentLoop.start).not.toHaveBeenCalled();
    expect(AIPanel.sendMessage).toHaveBeenCalledWith('chat', { message: 'summarize this page' });
  });

  it('/chat keeps a task-shaped message in chat, without the prefix', async () => {
    document.getElementById('ai-input').value = '/chat open source licences compared';
    await AIPanel._sendChat();
    expect(AgentLoop.start).not.toHaveBeenCalled();
    expect(AIPanel.sendMessage).toHaveBeenCalledWith('chat', { message: 'open source licences compared' });
  });

  it('with the agent already running, a second task is refused and stays in the box', async () => {
    document.getElementById('ai-input').value = 'open youtube';
    await AIPanel._sendChat();
    document.getElementById('ai-input').value = 'open reddit';
    await AIPanel._sendChat();
    expect(AgentLoop.start).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ai-input').value).toBe('open reddit');
    expect(window.showToast).toHaveBeenCalledWith('The agent is already running — stop it first', 'info');
  });
});

describe('an agent run is part of the chat', () => {
  it('the question is stored at once, the answer when it ends, with a way back to the steps', async () => {
    document.getElementById('ai-input').value = 'group my github tabs';
    await AIPanel._sendChat();
    expect(AIPanel._conversations.tab1).toEqual([{ role: 'user', content: 'group my github tabs', at: expect.any(Number) }]);
    expect(JSON.parse(localStorage.getItem('vex.aiConversations')).tab1).toHaveLength(1);   // survives a crash mid-run

    finish('Grouped 4 tabs.');
    await vi.waitFor(() => expect(AIPanel._conversations.tab1).toHaveLength(2));
    expect(AIPanel._conversations.tab1[1]).toEqual({ role: 'assistant', content: 'Grouped 4 tabs.', at: expect.any(Number), agentRun: 'run_1' });
    expect(JSON.parse(localStorage.getItem('vex.aiConversations')).tab1[1].agentRun).toBe('run_1');

    // Close and reopen the panel: the chat is still there.
    AIPanel._renderMessages();
    const text = document.getElementById('ai-messages').textContent;
    expect(text).toContain('group my github tabs');
    expect(text).toContain('Grouped 4 tabs.');
    document.querySelector('.ai-agent-steps-link').click();
    expect(AgentLoop.showRun).toHaveBeenCalledWith('run_1');

    // And after a restart.
    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations.tab1[1].agentRun).toBe('run_1');
  });

  it('a run that ended without an answer says so', async () => {
    document.getElementById('ai-input').value = 'open youtube';
    await AIPanel._sendChat();
    finish(null);
    await vi.waitFor(() => expect(AIPanel._conversations.tab1).toHaveLength(2));
    expect(AIPanel._conversations.tab1[1].content).toBe('*The agent stopped without an answer.*');
  });

  it('reopening the panel mid-run does not wipe the live steps', async () => {
    document.getElementById('ai-input').value = 'open youtube';
    await AIPanel._sendChat();
    const step = document.createElement('div'); step.className = 'ai-msg assistant agent-step-action'; step.textContent = 'navigate(…)';
    document.getElementById('ai-messages').appendChild(step);
    AIPanel._renderMessages();
    expect(document.getElementById('ai-messages').textContent).toContain('navigate(…)');
    finish('done');
    await vi.waitFor(() => expect(AIPanel._agentTabId).toBe(null));
  });
});
describe('an order is an order', () => {
  // Reported 2026-09-21: "when I gave orders to Vex AI it tried to explain
  // some things that I did not ask". Half of that is the prompt; the other
  // half is here — an imperative that never reached the agent got answered
  // with an explanation of how to do it yourself.
  const goes = (msg) => AIPanel.routeMessage(msg).agent;

  it('ordinary verbs that were missing', () => {
    for (const order of [
      'delete every bookmark in the old folder',
      'clear my downloads',
      'copy this page address to my notes',
      'export my notes',
      'install uBlock Origin',
      'archive these tabs',
      'record the screen',
      'split the window with the docs',
      'hide the sidebar',
      'zoom this site to 125%',
    ]) expect(goes(order), order).toBe(true);
  });

  it('a question about the page is still a question', () => {
    for (const ask of [
      'what does this page say about pricing?',
      'explain this paragraph',
      'summarize this',
      'rewrite this more simply',
    ]) expect(goes(ask), ask).toBe(false);
  });
});

// Asked "make an timer for 10 minutes", Vex replied with three paragraphs on
// how a countdown works, steps for a button that does not exist, and an offer
// to explain alarms. It had the clock and the parser all along. An order Vex
// can carry out is carried out — before any model is consulted, so there is
// nothing left that could invent a user interface.
describe('an order Vex can carry out itself', () => {
  beforeEach(() => {
    globalThis.VexQuickCommands = require('../../src/renderer/js/quick-commands.js').VexQuickCommands;
    globalThis.VexClock = {
      parseDuration: (t) => { const m = String(t).match(/^(\d+)\s*(m|min|mins|minute|minutes)$/i); if (!m) throw new Error('not a duration'); return Number(m[1]) * 60000; },
      fmtLeft: (ms) => Math.round(ms / 60000) + ':00',
      addTimer: vi.fn(async () => ({ id: 't1', label: 'Timer', total: 600000 })),
    };
    AIPanel._renderMessages = vi.fn();
    AIPanel._persistConversations = vi.fn();
  });

  it('starts the timer and says so in one line, with no model asked', async () => {
    document.getElementById('ai-input').value = 'make an timer for 10 minutes';
    await AIPanel._sendChat();
    expect(VexClock.addTimer).toHaveBeenCalled();
    expect(AgentLoop.start).not.toHaveBeenCalled();
    expect(AIPanel.sendMessage).not.toHaveBeenCalled();
    const conv = AIPanel._conversations.tab1;
    expect(conv[0]).toMatchObject({ role: 'user', content: 'make an timer for 10 minutes' });
    expect(conv[1].role).toBe('assistant');
    expect(conv[1].content).toMatch(/Timer/);
    expect(conv[1].didIt).toBe(true);
    expect(document.getElementById('ai-input').value).toBe('');
  });

  // The parse is confident, not infallible: someone who meant a question
  // needs one press to get the model rather than retyping.
  it('leaves a way to ask the model anyway', async () => {
    AIPanel._renderMessages = () => {
      const el = document.createElement('div');
      el.className = 'ai-msg assistant';
      document.getElementById('ai-messages').appendChild(el);
    };
    document.getElementById('ai-input').value = 'set a timer for 5 minutes';
    await AIPanel._sendChat();
    const again = [...document.querySelectorAll('#ai-messages button')].find(b => b.textContent === 'Ask the AI instead');
    expect(again).toBeTruthy();
    again.click();
    expect(AIPanel.sendMessage).toHaveBeenCalledWith('chat', { message: 'set a timer for 5 minutes' });
  });

  it('says plainly when it could not, instead of explaining', async () => {
    VexClock.addTimer = vi.fn(async () => { throw new Error('the clock is not ready'); });
    document.getElementById('ai-input').value = 'make a timer for 10 minutes';
    await AIPanel._sendChat();
    expect(AIPanel._conversations.tab1[1].content).toBe('I could not: the clock is not ready');
  });

  it('a question is left to the model exactly as before', async () => {
    document.getElementById('ai-input').value = 'what is a timer';
    await AIPanel._sendChat();
    expect(VexClock.addTimer).not.toHaveBeenCalled();
    expect(AIPanel._conversations.tab1).toBeUndefined();
  });
});

// Shown a card explaining a feature, the obvious human reply is to ask Vex to
// do it instead. Said to the model, "you do it" has no subject — it cannot
// know what "it" is — and a small model asked to do it with no context
// invents something: one answered with instructions for embedding a timer in
// a Google Doc. The card knows what it was about.
describe('"you do it" after a card', () => {
  beforeEach(() => {
    globalThis.VexQuickCommands = require('../../src/renderer/js/quick-commands.js').VexQuickCommands;
    globalThis.VexClock = {
      parseDuration: (t) => { const m = String(t).match(/^(\d+)\s*(m|min|mins|minute|minutes)$/i); if (!m) throw new Error('not a duration'); return Number(m[1]) * 60000; },
      fmtLeft: (ms) => Math.round(ms / 60000) + ':00',
      addTimer: vi.fn(async () => ({ id: 't1', label: 'Timer', total: 600000 })),
    };
    globalThis.VexGuide = { run: vi.fn(async () => true), isAbout: () => false };
    globalThis.VexFeatures = { nameOf: () => 'Split screen' };
    AIPanel._renderMessages = vi.fn();
    AIPanel._persistConversations = vi.fn();
    AIPanel._lastGuide = null;
  });

  const say = async (text) => { document.getElementById('ai-input').value = text; await AIPanel._sendChat(); };

  it('does the original request when Vex can simply do it', async () => {
    AIPanel._lastGuide = { question: 'make me an timer for 10 minutes', entry: { id: 'agent' } };
    await say('you do it');
    expect(VexClock.addTimer).toHaveBeenCalled();
    expect(VexGuide.run).not.toHaveBeenCalled();          // no need for the card
    expect(AIPanel.sendMessage).not.toHaveBeenCalled();   // and no model at all
  });

  it('otherwise runs the feature the card was about', async () => {
    AIPanel._lastGuide = { question: 'how do I split the screen', entry: { id: 'split' } };
    await say('do it');
    expect(VexGuide.run).toHaveBeenCalledWith({ id: 'split' });
    expect(AIPanel._conversations.tab1[1].content).toMatch(/Opened Split screen/);
  });

  it('every ordinary way of saying it, and nothing more', async () => {
    for (const phrase of ['you do it', 'do it', 'just do it', 'yes do it', 'Can you do it?', 'do it then']) {
      expect(AIPanel.DO_IT.test(phrase)).toBe(true);
    }
    for (const phrase of ['do it in the background', 'do it for every tab', 'undo it', 'how do I do it']) {
      expect(AIPanel.DO_IT.test(phrase)).toBe(false);
    }
  });

  // With no card behind it, "do it" is just a sentence and goes to the model.
  it('means nothing on its own', async () => {
    await say('do it');
    expect(VexGuide.run).not.toHaveBeenCalled();
    expect(AIPanel.sendMessage).toHaveBeenCalledWith('chat', { message: 'do it' });
  });

  it('is used once: the second "do it" is a fresh sentence again', async () => {
    AIPanel._lastGuide = { question: 'how do I split the screen', entry: { id: 'split' } };
    await say('do it');
    VexGuide.run.mockClear();
    await say('do it');
    expect(VexGuide.run).not.toHaveBeenCalled();
  });
});

// "cancel it, now research something else" became the task: the run carried
// on, and "cancel it" was handed to the model as part of what to research.
// A cancel is an instruction about Vex, not a thing to look up.
describe('cancelling', () => {
  beforeEach(() => {
    globalThis.VexGuide = { run: vi.fn(async () => true), isAbout: () => false };
    globalThis.VexQuickCommands = require('../../src/renderer/js/quick-commands.js').VexQuickCommands;
    AIPanel._renderMessages = vi.fn();
    AIPanel._persistConversations = vi.fn();
    AIPanel._lastGuide = null;
    AgentLoop.stop = vi.fn();
  });

  const say = async (text) => { document.getElementById('ai-input').value = text; await AIPanel._sendChat(); };

  it('stops the run, and runs what came after it as its own request', async () => {
    let running = true;
    AgentLoop.isRunning = () => running;
    AgentLoop.stop = vi.fn(() => { running = false; });
    await say('cancel it, now research about the errors in bible');
    expect(AgentLoop.stop).toHaveBeenCalled();
    // The rest is a task of its own, not part of the cancelled one.
    expect(AgentLoop.start).toHaveBeenCalled();
    expect(AgentLoop.start.mock.calls[0][0]).toBe('research about the errors in bible');
    expect(AgentLoop.start.mock.calls[0][0]).not.toMatch(/cancel/i);
  });

  it('says so when there was nothing running, rather than looking ignored', async () => {
    AgentLoop.isRunning = () => false;
    await say('stop');
    expect(AIPanel._conversations.tab1[1].content).toMatch(/nothing running/i);
    expect(AIPanel.sendMessage).not.toHaveBeenCalled();
  });

  // "stop the timer" and "cancel my subscription" are things to do.
  it('leaves an ordinary request that happens to start with a verb alone', async () => {
    AgentLoop.isRunning = () => true;
    for (const phrase of ['stop the timer', 'cancel my subscription', 'stop all the music']) {
      expect(AIPanel.CANCEL.test(phrase)).toBe(false);
    }
    for (const phrase of ['cancel it', 'stop', 'nvm, do something else', 'never mind']) {
      expect(AIPanel.CANCEL.test(phrase)).toBe(true);
    }
  });
});
