// What pdf.js 5 takes for granted and a WebView may not have yet.
//
// pdf.js ships two builds: this one, which assumes a browser from this month,
// and a "legacy" one that is bigger and slower everywhere. A phone's WebView
// updates from the Play Store, so most are current — but one a few versions
// behind failed every page with "getOrInsertComputed is not a function", and
// the PDF was a white rectangle. These are the few it calls without checking,
// filled in only where missing. Loaded first on the main thread (js/pdf.js)
// and first in the worker (vex-worker.mjs), which is a world of its own.

function define(target, name, value) {
  if (target && !(name in target)) {
    Object.defineProperty(target, name, { value, writable: true, configurable: true });
  }
}

for (const Kind of [Map, WeakMap]) {
  define(Kind.prototype, 'getOrInsert', function getOrInsert(key, value) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  });
  define(Kind.prototype, 'getOrInsertComputed', function getOrInsertComputed(key, compute) {
    if (this.has(key)) return this.get(key);
    const value = compute(key);
    this.set(key, value);
    return value;
  });
}

define(Promise, 'withResolvers', function withResolvers() {
  let resolve, reject;
  const promise = new this((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
});

define(Promise, 'try', function promiseTry(fn, ...args) {
  return new this(resolve => resolve(fn(...args)));
});

// Not the exact summation the real one does; pdf.js adds up lengths and
// widths, where the last bit of a double is not something anyone sees.
define(Math, 'sumPrecise', function sumPrecise(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
});

define(Uint8Array.prototype, 'toBase64', function toBase64() {
  let binary = '';
  for (let at = 0; at < this.length; at += 0x8000) {
    binary += String.fromCharCode.apply(null, this.subarray(at, at + 0x8000));
  }
  return btoa(binary);
});

define(Uint8Array, 'fromBase64', function fromBase64(text) {
  const binary = atob(String(text).replace(/[\s]/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
});

if (typeof Response !== 'undefined') {
  define(Response.prototype, 'bytes', async function bytes() {
    return new Uint8Array(await this.arrayBuffer());
  });
}

export {};
