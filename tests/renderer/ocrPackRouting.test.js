// @vitest-environment jsdom
// Every OCR caller (page OCR, screenshot/slide reading, redaction) goes through the language pack that main downloads through the
// egress ledger. None of them may start Tesseract with its own defaults (that fetched English data from a CDN with no ledger line).
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const { VexImageText: T } = require('../../src/renderer/js/image-text.js');

describe('OCR callers use the ledgered pack', () => {
  it('doc-extract.js and redact-tool.js do not create a Tesseract worker or import the engine themselves', () => {
    for (const f of ['src/renderer/js/doc-extract.js', 'src/renderer/js/redact-tool.js']) {
      const src = read(f);
      expect(src, f).not.toMatch(/createWorker/);
      expect(src, f).not.toMatch(/tesseract\.mjs/);
      expect(src, f).toMatch(/recognizeWithPack/);
    }
  });
  it('image-text.js is the only renderer file that starts the engine', () => {
    const dir = path.join(__dirname, '../../src/renderer/js');
    const users = fs.readdirSync(dir).filter(f => f.endsWith('.js') && /createWorker\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(users).toEqual(['image-text.js']);
  });
  it('stops with a plain error when the person declines the download, and starts no worker', async () => {
    const t = Object.create(T);
    t.ensurePack = async () => 'declined';
    let started = 0;
    t._worker = async () => { started++; };
    await expect(t.packWorker()).rejects.toThrow(/nothing was downloaded/);
    expect(started).toBe(0);
  });
  it('reads with the pack worker, passes the output option through and always stops the worker', async () => {
    const calls = [];
    const worker = { recognize: async (img, o, out) => { calls.push([img, out]); return { data: { text: 'x' } }; }, terminate: async () => { calls.push('terminated'); } };
    const t = Object.create(T);
    t.packWorker = async () => worker;
    const r = await t.recognizeWithPack('data:image/png;base64,AA', { output: { blocks: true } });
    expect(r.data.text).toBe('x');
    expect(calls).toEqual([['data:image/png;base64,AA', { blocks: true }], 'terminated']);
  });
  it('stops the worker even when reading throws', async () => {
    let stopped = false;
    const worker = { recognize: async () => { throw new Error('boom'); }, terminate: async () => { stopped = true; } };
    const t = Object.create(T);
    t.packWorker = async () => worker;
    await expect(t.recognizeWithPack('x')).rejects.toThrow('boom');
    expect(stopped).toBe(true);
  });
});
