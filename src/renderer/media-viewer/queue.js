// The queue: the other files of the folder a file was opened from, with repeat and shuffle. No page, no network: plain logic.
// items: [{ name, url, ext }]. repeat: 'off' | 'all' | 'one'.

export const REPEAT_MODES = ['off', 'all', 'one'];

export class Queue {
  constructor(random = Math.random) {
    this.items = [];
    this.index = -1;
    this.repeat = 'off';
    this.shuffle = false;
    this.random = random;
    this.played = new Set();       // indexes already played in this shuffle round
    this.trail = [];               // indexes in the order they were played, for "previous"
  }

  set(items, currentUrl) {
    this.items = Array.isArray(items) ? items.slice() : [];
    this.index = this.items.findIndex((i) => i.url === currentUrl);
    this.played = new Set(this.index >= 0 ? [this.index] : []);
    this.trail = this.index >= 0 ? [this.index] : [];
  }

  get size() { return this.items.length; }
  get usable() { return this.items.length > 1 && this.index >= 0; }
  current() { return this.index >= 0 ? this.items[this.index] : null; }

  cycleRepeat() {
    this.repeat = REPEAT_MODES[(REPEAT_MODES.indexOf(this.repeat) + 1) % REPEAT_MODES.length];
    return this.repeat;
  }
  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.played = new Set(this.index >= 0 ? [this.index] : []);
    return this.shuffle;
  }

  // What follows the current item, without moving to it: { index, item } or null at the end. `auto` is true when a file ended by itself
  // (repeat one then plays the same file again; a button press always moves on).
  peekNext(auto) {
    if (!this.usable) return null;
    if (auto && this.repeat === 'one') return { index: this.index, item: this.items[this.index] };
    if (this.shuffle) {
      let pool = this.items.map((_, i) => i).filter((i) => !this.played.has(i));
      if (!pool.length) {
        if (this.repeat === 'off' && auto) return null;
        pool = this.items.map((_, i) => i).filter((i) => i !== this.index);
      }
      const index = pool[Math.floor(this.random() * pool.length)];
      return { index, item: this.items[index] };
    }
    let index = this.index + 1;
    if (index >= this.items.length) {
      if (this.repeat === 'off' && auto) return null;
      index = 0;
    }
    return { index, item: this.items[index] };
  }

  peekPrev() {
    if (!this.usable) return null;
    if (this.shuffle && this.trail.length > 1) { const index = this.trail[this.trail.length - 2]; return { index, item: this.items[index], fromTrail: true }; }
    const index = (this.index - 1 + this.items.length) % this.items.length;
    return { index, item: this.items[index] };
  }

  // Make `index` the current one.
  goTo(index, { back } = {}) {
    if (index < 0 || index >= this.items.length) throw new Error('There is no item ' + index + ' in the queue');
    if (back && this.trail.length > 1 && this.trail[this.trail.length - 2] === index) this.trail.pop();
    else if (this.trail[this.trail.length - 1] !== index) this.trail.push(index);
    if (this.trail.length > 500) this.trail.shift();
    this.index = index;
    if (this.played.size >= this.items.length) this.played = new Set();      // a new shuffle round starts
    this.played.add(index);
    return this.items[index];
  }
}
