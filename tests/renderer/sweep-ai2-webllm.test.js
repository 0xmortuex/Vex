// @vitest-environment node
//
// Stop reaches the in-browser model (WebLLM) too (found 2026-09-29): the
// panel's AbortSignal goes router → WebLLM.chat → engine.interruptGenerate().
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let dir, WebLLM, engine, savedLocation, gpuDesc;

beforeAll(async () => {
  // A stand-in for the bundled runtime: an engine whose answer only comes when
  // it is interrupted (the way a real one hands back its partial text).
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-webllm-'));
  fs.mkdirSync(path.join(dir, 'vendor', 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor', 'runtime', 'webllm.mjs'), `
    export async function CreateMLCEngine() {
      const engine = {
        interrupted: 0,
        _finish: null,
        interruptGenerate() { engine.interrupted++; if (engine._finish) engine._finish({ choices: [{ message: { content: 'partial' } }] }); },
        chat: { completions: { create: () => new Promise(r => { engine._finish = r; }) } },
      };
      globalThis.__stubEngine = engine;
      return engine;
    }`);
  savedLocation = globalThis.location;
  globalThis.location = { href: pathToFileURL(path.join(dir, 'js', 'webllm.js')).href };
  gpuDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
  vi.resetModules();
  WebLLM = (await import('../../src/renderer/js/webllm.js')).WebLLM;
  await WebLLM.load('Llama-3.2-1B-Instruct-q4f32_1-MLC');
  engine = globalThis.__stubEngine;
});

afterAll(() => {
  globalThis.location = savedLocation;
  if (gpuDesc) Object.defineProperty(globalThis, 'navigator', gpuDesc); else delete globalThis.navigator;
  delete globalThis.__stubEngine;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('WebLLM.chat and Stop', () => {
  it('interrupts the engine and rejects with "Stopped" instead of returning the partial answer', async () => {
    const ctl = new AbortController();
    const answer = WebLLM.chat([{ role: 'user', content: 'long question' }], { signal: ctl.signal });
    ctl.abort();
    await expect(answer).rejects.toThrow('Stopped');
    expect(engine.interrupted).toBe(1);
  });

  it('does not start at all when already stopped', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const before = engine.interrupted;
    await expect(WebLLM.chat([{ role: 'user', content: 'q' }], { signal: ctl.signal })).rejects.toThrow('Stopped');
    expect(engine.interrupted).toBe(before);
  });

  it('answers normally, and a Stop after the answer interrupts nothing', async () => {
    const ctl = new AbortController();
    const answer = WebLLM.chat([{ role: 'user', content: 'q' }], { signal: ctl.signal });
    await Promise.resolve();
    engine._finish({ choices: [{ message: { content: 'done' } }] });
    await expect(answer).resolves.toBe('done');
    const before = engine.interrupted;
    ctl.abort();
    expect(engine.interrupted).toBe(before);
  });
});

describe('the router hands Stop to WebLLM', () => {
  it('passes the chat signal to WebLLM.chat', async () => {
    const saved = globalThis.WebLLM;
    const chat = vi.fn(async () => 'ok');
    globalThis.WebLLM = { preferred: () => true, isLoaded: () => true, loadedModel: () => 'm', chat };
    try {
      vi.resetModules();
      const { AIRouter } = await import('../../src/renderer/js/ai-router.js');
      const ctl = new AbortController();
      await AIRouter.callOn('ondevice', 'chat', { message: 'hi', signal: ctl.signal });
      expect(chat.mock.calls[0][1].signal).toBe(ctl.signal);
    } finally { globalThis.WebLLM = saved; }
  });
});
