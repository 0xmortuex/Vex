// @vitest-environment node
//
// A WebLLM answer that times out stops the engine too (found 2026-09-29): it
// used to reject and leave the GPU writing on. Same stand-in engine as
// sweep-ai2-webllm.test.js.
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

describe('WebLLM.chat timing out', () => {
  it('rejects and interrupts the engine', async () => {
    const before = engine.interrupted;
    await expect(WebLLM.chat([{ role: 'user', content: 'long question' }], { timeoutMs: 20 })).rejects.toThrow('timed out');
    expect(engine.interrupted).toBe(before + 1);
  });
});
