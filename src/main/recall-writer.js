'use strict';
// When the page-text index (Recall, recall.json) goes to disk.
//
// The index is the text of every page read, a few megabytes. Each page read
// rewrote all of it plus a .bak copy (about 3.9 MB twice, measured on the
// owner's profile; audit S8): the old 1.5 s coalescing only joined reads that
// came within 1.5 s of each other. Now a page read only marks it changed, and
// it is written at most once a minute, and straight away when asked (closing
// the window, quitting Vex, forgetting a site, clearing it).
//
// A failed write leaves it marked changed, so the next write tries again with
// everything in it; nothing read in the meantime is lost.

const WRITE_DELAY_MS = 60 * 1000;

// serialize(): the bytes to write now. write(bytes, { erase }): a promise.
// onError(err): told when a timed write fails (the next write retries).
function createRecallWriter({ serialize, write, delay = WRITE_DELAY_MS, setTimer = setTimeout, clearTimer = clearTimeout, onError }) {
  if (typeof serialize !== 'function' || typeof write !== 'function' || typeof onError !== 'function') throw new Error('createRecallWriter needs serialize, write and onError');
  let dirty = false;
  let timer = null;
  let writes = Promise.resolve();

  function flush(erase = false) {
    if (timer) { clearTimer(timer); timer = null; }
    if (!dirty && !erase) return writes;
    dirty = false;
    const bytes = serialize();
    writes = writes.catch(() => {}).then(() => write(bytes, { erase })).catch((err) => {
      dirty = true;
      throw err;
    });
    return writes;
  }

  function touch() {
    dirty = true;
    if (timer) return;
    timer = setTimer(() => {
      timer = null;
      // A timed write has no caller to hand its error to: onError says it.
      flush().catch(onError);
    }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    touch,
    flush,
    get dirty() { return dirty; },
    get waiting() { return !!timer; },
  };
}

module.exports = { createRecallWriter, WRITE_DELAY_MS };
