// The GIF writer behind "Record a GIF": checked by decoding what it wrote
// with an independent LZW decoder, the way an image viewer would.
import { describe, it, expect } from 'vitest';
const { GifEncoder: G } = require('../../src/renderer/js/gif-encoder.js');

// A plain GIF LZW decoder (the specification's, not the encoder's mirror).
function unlzw(data, minCodeSize, count) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, dict = [], prev = null;
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = null; codeSize = minCodeSize + 1; prev = null; };
  reset();
  const out = [];
  let pos = 0, cur = 0, bits = 0;
  const read = () => { while (bits < codeSize) { cur |= data[pos++] << bits; bits += 8; } const c = cur & ((1 << codeSize) - 1); cur >>>= codeSize; bits -= codeSize; return c; };
  for (;;) {
    const code = read();
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat(prev[0]);
    else throw new Error('bad code ' + code);
    out.push(...entry);
    if (prev) dict.push(prev.concat(entry[0]));
    prev = entry;
    if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
    if (out.length >= count) break;
  }
  return out;
}

// Pull the frames back out of a GIF.
function frames(gif) {
  const w = gif[6] | (gif[7] << 8), h = gif[8] | (gif[9] << 8);
  let i = 13 + 768;
  const got = [];
  while (gif[i] !== 0x3B) {
    if (gif[i] === 0x21) { i += 2; while (gif[i]) i += gif[i] + 1; i++; continue; }
    if (gif[i] === 0x2C) {
      i += 10;
      const min = gif[i++];
      const data = [];
      while (gif[i]) { data.push(...gif.slice(i + 1, i + 1 + gif[i])); i += gif[i] + 1; }
      i++;
      got.push(unlzw(data, min, w * h));
      continue;
    }
    throw new Error('unexpected block ' + gif[i]);
  }
  return { w, h, got };
}

describe('GifEncoder', () => {
  it('writes frames an independent decoder reads back exactly', () => {
    const w = 64, h = 40;
    const noise = Uint8Array.from({ length: w * h }, (_, i) => (i * 7919 + (i >> 3)) % 252);   // worst case for LZW: many table resets
    const flat = new Uint8Array(w * h).fill(42);
    const gif = G.encode({ width: w, height: h, frames: [noise, flat], delayMs: 120 });
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a');
    const { w: dw, h: dh, got } = frames(gif);
    expect([dw, dh]).toEqual([w, h]);
    expect(got).toHaveLength(2);
    expect(Uint8Array.from(got[0])).toEqual(noise);
    expect(Uint8Array.from(got[1])).toEqual(flat);
  });

  it('a large frame, past the 4096-code table, still round-trips', () => {
    const w = 320, h = 200;
    const frame = Uint8Array.from({ length: w * h }, (_, i) => ((i % w) ^ (i / w | 0)) % 252);
    const { got } = frames(G.encode({ width: w, height: h, frames: [frame] }));
    expect(Uint8Array.from(got[0])).toEqual(frame);
  });

  it('maps colours onto the palette: black, white and a primary come back close', () => {
    const idx = G.quantize(Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255, 230, 30, 40, 255]));
    const p = G.palette();
    const rgb = (i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
    expect(rgb(idx[0])).toEqual([0, 0, 0]);
    expect(rgb(idx[1])).toEqual([255, 255, 255]);
    const [r, g, b] = rgb(idx[2]);
    expect(Math.abs(r - 230) + Math.abs(g - 30) + Math.abs(b - 40)).toBeLessThan(80);
  });

  it('refuses nothing to encode, and a frame of the wrong size', () => {
    expect(() => G.encode({ width: 2, height: 2, frames: [] })).toThrow('No frames');
    expect(() => G.encode({ width: 2, height: 2, frames: [new Uint8Array(3)] })).toThrow('wrong size');
  });
});
