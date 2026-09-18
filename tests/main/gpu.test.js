// src/main/gpu.js — is there room on the graphics card?
//
// A local model lives in video memory. Measured here on an 8 GB RTX 4060 with
// a game and OBS running: 7.7 GB used, 92% busy — the model was pushed out to
// the processor and the same agent task that took 30 seconds ran past the
// two-minute limit and came back with nothing, twice, with nothing on screen
// to say why.

import { describe, it, expect, vi } from 'vitest';
const { createGpuProbe, parse, roomFor } = require('../../src/main/gpu.js');

const REAL = 'NVIDIA GeForce RTX 4060, 92, 7708, 8188\n';

describe('reading nvidia-smi', () => {
  it('parses a real line', () => {
    expect(parse(REAL)).toEqual({ name: 'NVIDIA GeForce RTX 4060', utilization: 92, usedMB: 7708, totalMB: 8188, freeMB: 480, usedPercent: 94 });
  });

  it('takes the first card when there are several, and survives odd output', () => {
    expect(parse('GPU A, 10, 100, 1000\nGPU B, 20, 200, 2000').name).toBe('GPU A');
    expect(parse('')).toBe(null);
    expect(parse('nonsense')).toBe(null);
    expect(parse('GPU, 5, 100')).toBe(null);
    expect(parse('GPU, [N/A], [N/A], 4096')).toMatchObject({ utilization: null, usedMB: null, totalMB: 4096, freeMB: 4096 });
  });

  it('asks the driver with the flags that need no permissions, and caches the answer', async () => {
    const execFile = vi.fn((cmd, args, opts, cb) => cb(null, REAL));
    const probe = createGpuProbe({ execFile, now: () => 1000 });
    expect(await probe.read()).toMatchObject({ usedMB: 7708 });
    expect(await probe.read()).toMatchObject({ usedMB: 7708 });
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0][0]).toBe('nvidia-smi');
    expect(execFile.mock.calls[0][1]).toEqual(['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']);
    expect(execFile.mock.calls[0][2]).toMatchObject({ windowsHide: true });
  });

  it('two callers at once ask the driver once', async () => {
    let resolve;
    const execFile = vi.fn((c, a, o, cb) => { resolve = () => cb(null, REAL); });
    const probe = createGpuProbe({ execFile });
    const both = Promise.all([probe.read(), probe.read()]);
    resolve();
    const [x, y] = await both;
    expect(x).toBe(y);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('no NVIDIA card, no driver, or a tool that is not there: null, and Vex says nothing about it', async () => {
    const probe = createGpuProbe({ execFile: (c, a, o, cb) => cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) });
    expect(await probe.read()).toBe(null);
  });
});

describe('roomFor', () => {
  it('says yes, no, or "no idea" — never a refusal on no information', () => {
    const busy = parse(REAL);
    expect(roomFor(busy, 5500)).toBe(false);             // a 5.5 GB model on 480 MB free
    expect(roomFor(parse('GPU, 5, 500, 8188'), 5500)).toBe(true);
    expect(roomFor(null, 5500)).toBe(null);
    expect(roomFor(busy)).toBe(false);                   // no figure given: is there room at all
    expect(roomFor(parse('GPU, 5, 500, 8188'))).toBe(true);
  });
});
