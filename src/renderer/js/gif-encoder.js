// === A small animated-GIF writer ============================================
//
// For short screen clips (js/area-recorder.js). One fixed palette for every
// frame — 6 levels of red, 7 of green, 6 of blue (252 colours), which is what
// screens of text and interface need — so a frame is reduced to one byte a
// pixel the moment it is captured and a clip never holds full-colour frames.
// LZW as the GIF89a specification has it; loops forever.
const GifEncoder = {
  palette() {
    const p = new Uint8Array(256 * 3);
    let i = 0;
    for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
      p[i++] = Math.round(r * 255 / 5); p[i++] = Math.round(g * 255 / 6); p[i++] = Math.round(b * 255 / 5);
    }
    return p;                                   // the last 4 entries stay black
  },

  // RGBA pixels → palette indices.
  quantize(rgba) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) {
      out[j] = Math.round(rgba[i] * 5 / 255) * 42 + Math.round(rgba[i + 1] * 6 / 255) * 6 + Math.round(rgba[i + 2] * 5 / 255);
    }
    return out;
  },

  lzw(indices, minCodeSize = 8) {
    const clear = 1 << minCodeSize, eoi = clear + 1;
    let codeSize = minCodeSize + 1, next = eoi + 1, table = new Map();
    const out = [];
    let cur = 0, bits = 0;
    const emit = (code) => { cur |= code << bits; bits += codeSize; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = table.get(key);
      if (found !== undefined) { prefix = found; continue; }
      emit(prefix);
      if (next === 4096) {                       // table full: start again
        emit(clear);
        table = new Map(); codeSize = minCodeSize + 1; next = eoi + 1;
      } else {
        if (next >= (1 << codeSize)) codeSize++;
        table.set(key, next++);
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
    if (bits > 0) out.push(cur & 255);
    return out;
  },

  // frames: palette-index arrays of width × height; delayMs between frames.
  encode({ width, height, frames, delayMs = 100 }) {
    if (!frames.length) throw new Error('No frames to put in the GIF');
    const bytes = [];
    const u16 = (n) => { bytes.push(n & 255, (n >> 8) & 255); };
    const str = (s) => { for (const c of s) bytes.push(c.charCodeAt(0)); };
    str('GIF89a'); u16(width); u16(height);
    bytes.push(0xF7, 0, 0);                      // global colour table of 256, 8 bits
    for (const v of this.palette()) bytes.push(v);
    bytes.push(0x21, 0xFF, 11); str('NETSCAPE2.0'); bytes.push(3, 1, 0, 0, 0);   // loop forever
    const delay = Math.max(2, Math.round(delayMs / 10));
    for (const frame of frames) {
      if (frame.length !== width * height) throw new Error('A frame is the wrong size');
      bytes.push(0x21, 0xF9, 4, 0x04); u16(delay); bytes.push(0, 0);           // keep the previous frame beneath
      bytes.push(0x2C); u16(0); u16(0); u16(width); u16(height); bytes.push(0);
      bytes.push(8);
      const data = this.lzw(frame, 8);
      for (let i = 0; i < data.length; i += 255) {
        const n = Math.min(255, data.length - i);
        bytes.push(n);
        for (let j = 0; j < n; j++) bytes.push(data[i + j]);
      }
      bytes.push(0);
    }
    bytes.push(0x3B);
    return new Uint8Array(bytes);
  },
};

if (typeof window !== 'undefined') window.GifEncoder = GifEncoder;
if (typeof module !== 'undefined' && module.exports) module.exports = { GifEncoder };
