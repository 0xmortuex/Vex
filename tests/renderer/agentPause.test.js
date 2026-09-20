// @vitest-environment jsdom
//
// Pausing a run, and changing your mind while it is held. The rules that
// matter: a pause holds the loop BETWEEN steps (never mid-step), what you say
// while paused reaches the model as its next instruction, and stopping a
// paused run never leaves it waiting forever.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { AgentLoop } = require('../../src/renderer/js/agent-loop.js');

beforeEach(() => {
  document.body.innerHTML = '<button id="ai-pause-agent">Pause</button>';
  AgentLoop._running = true;
  AgentLoop._paused = false;
  AgentLoop._pauseWaiters = [];
  AgentLoop._nudges = [];
  AgentLoop._history = [];
  AgentLoop._renderStep = vi.fn();
});

describe('holding a run', () => {
  it('pauses, and the wait only ends when it is resumed', async () => {
    expect(AgentLoop.pause()).toBe(true);
    expect(AgentLoop.isPaused()).toBe(true);

    let released = false;
    const waiting = AgentLoop._waitWhilePaused().then(() => { released = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(released).toBe(false);

    AgentLoop.resume();
    await waiting;
    expect(released).toBe(true);
    expect(AgentLoop.isPaused()).toBe(false);
  });

  it('a run that is not paused does not wait at all', async () => {
    await expect(AgentLoop._waitWhilePaused()).resolves.toBeUndefined();
  });

  it('pausing twice, or pausing nothing, changes nothing', () => {
    expect(AgentLoop.pause()).toBe(true);
    expect(AgentLoop.pause()).toBe(false);
    AgentLoop.resume();
    AgentLoop._running = false;
    expect(AgentLoop.pause()).toBe(false);
  });

  it('the button says what it will do', () => {
    AgentLoop.pause();
    expect(document.getElementById('ai-pause-agent').textContent).toBe('Continue');
    AgentLoop.resume();
    expect(document.getElementById('ai-pause-agent').textContent).toBe('Pause');
  });
});

describe('saying something mid-run', () => {
  it('reaches the model as its next instruction', () => {
    AgentLoop.pause();
    AgentLoop.nudge('use the UK site, not the US one');
    expect(AgentLoop._history).toEqual([]);          // not until the next step
    AgentLoop._flushNudges();
    expect(AgentLoop._history).toHaveLength(1);
    expect(AgentLoop._history[0]).toMatchObject({ role: 'user' });
    expect(AgentLoop._history[0].content).toContain('use the UK site');
  });

  it('several notes go together, in the order they were said', () => {
    AgentLoop.nudge('first');
    AgentLoop.nudge('second');
    AgentLoop._flushNudges();
    expect(AgentLoop._history[0].content).toMatch(/first\nsecond/);
  });

  it('nothing to say, nothing added', () => {
    expect(() => AgentLoop.nudge('   ')).toThrow(/Write what/);
    AgentLoop._flushNudges();
    expect(AgentLoop._history).toEqual([]);
  });

  it('there has to be a run to say it to', () => {
    AgentLoop._running = false;
    expect(() => AgentLoop.nudge('hello')).toThrow(/Nothing is running/);
  });
});

describe('stopping while paused', () => {
  it('lets the loop go rather than leaving it waiting forever', async () => {
    AgentLoop.pause();
    let released = false;
    const waiting = AgentLoop._waitWhilePaused().then(() => { released = true; });
    AgentLoop.stop();
    await waiting;
    expect(released).toBe(true);
    expect(AgentLoop.isPaused()).toBe(false);
    expect(AgentLoop._nudges).toEqual([]);
  });
});
