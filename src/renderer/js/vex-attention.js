// === One gate for toasts a feature raises on its own =========================
//
// Many of the newer features may speak up without being asked: a badge, a level,
// a snoozed item that came back, a tab you opened days ago, a routine Vex
// noticed. Each is fine on its own and together they would be a storm. Every
// such toast asks here first:
//
//   if (VexAttention.gate('level-up', String(level))) showToast(...);
//
// gate(kind, id) is true when the toast may be shown now, and counts it:
//   - not while the global quiet switch (vex.fun.quiet) or Game mode is on;
//   - the same kind + id is never shown twice within REPEAT_MS;
//   - at most MAX_PER_MINUTE toasts of any kind in any 60 seconds.
// A toast the gate refused is not queued: it was a nice-to-have. Things the
// person asked for (they pressed a button) do not go through here.
//
// In memory only: a restart starts a fresh minute.
const VexAttention = {
  MAX_PER_MINUTE: 3,
  WINDOW_MS: 60 * 1000,
  REPEAT_MS: 10 * 60 * 1000,

  _recent: [],            // timestamps of toasts let through, newest last
  _seen: new Map(),       // 'kind::id' -> timestamp
  _now() { return Date.now(); },

  _quiet() {
    try { if (localStorage.getItem('vex.fun.quiet') === '1') return true; } catch { /* storage blocked: not quiet */ }
    try { if (typeof GameSession !== 'undefined' && GameSession && GameSession.active) return true; } catch { /* not loaded */ }
    try { if (typeof GameMode !== 'undefined' && GameMode && GameMode.gaming) return true; } catch { /* not loaded */ }
    return false;
  },

  gate(kind, id) {
    if (typeof kind !== 'string' || !kind) throw new Error('A toast needs a kind to be rate-limited');
    const key = kind + '::' + String(id == null ? '' : id);
    const now = this._now();
    if (this._quiet()) return false;
    const last = this._seen.get(key);
    if (last !== undefined && now - last < this.REPEAT_MS) return false;
    this._recent = this._recent.filter(t => now - t < this.WINDOW_MS);
    if (this._recent.length >= this.MAX_PER_MINUTE) return false;
    this._recent.push(now);
    this._seen.set(key, now);
    if (this._seen.size > 200) {
      for (const [k, t] of this._seen) if (now - t >= this.REPEAT_MS) this._seen.delete(k);
    }
    return true;
  },

  // Tests and "forget what you have said".
  reset() { this._recent = []; this._seen.clear(); },
};

if (typeof window !== 'undefined') window.VexAttention = VexAttention;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAttention };
