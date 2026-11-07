// === Vex Mobile — reading a page aloud ===
//
// Samsung Internet reads a page to you and so does Chrome; a browser you use on
// a commute should. Android's own TextToSpeech does the speaking — every phone
// has one, and a Galaxy has a good one — and the article the reader already
// extracts is what gets read, so it is the text without the navigation, the
// cookie banner and the share buttons.
//
// Sent a paragraph at a time, for three reasons: the engine takes 4,000
// characters per utterance, a paragraph is where a person wants to stop or skip,
// and it is how the bar can say where it has got to.
//
// TextToSpeech has no pause, only stop. So pausing stops the engine and keeps
// the line number, and carrying on re-queues the rest from there. Skipping and
// changing speed are the same move, which is why they all go through one place.
//
// It carries on with the screen off or from another app, like Chrome's "Listen
// to this page": native holds a media notification with Pause and Stop, answers
// the headset button, and pauses for a call or for headphones coming out. Those
// arrive here as events, so the bar always says what the phone is doing.

const VexSpeak = (() => {
  // What the speed button steps through. 2× is where a TTS voice stops being
  // words, which is why it is the end of the range.
  const RATES = [0.75, 1, 1.25, 1.5, 2];

  const state = {
    available: null,       // null until asked
    voices: [],
    loaded: false,         // an article is in hand, so the bar is up
    speaking: false,       // the engine is actually talking
    index: 0,              // which line, across the whole article
    base: 0,               // the line the current queue started at
    parts: [],
    title: '',
    url: ''
  };

  const listeners = new Set();
  let askedNotifications = false;
  function changed() { for (const fn of listeners) { try { fn(state); } catch { /* a gone panel */ } } }

  function rate() {
    const stored = Number(VexStore.get('vex.speakRate', 1));
    return stored >= 0.5 && stored <= 2.5 ? stored : 1;
  }
  function voice() { return String(VexStore.get('vex.speakVoice', '') || ''); }

  // Sentences, not paragraphs, when a paragraph is enormous: a 2,000-character
  // block is fifteen seconds you cannot skip out of, and the engine's own limit
  // is not far above it.
  function split(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    if (clean.length <= 400) return [clean];
    const out = [];
    let at = 0;
    while (at < clean.length) {
      let end = Math.min(at + 400, clean.length);
      if (end < clean.length) {
        const stop = clean.lastIndexOf('. ', end);
        if (stop > at + 80) end = stop + 1;
      }
      out.push(clean.slice(at, end).trim());
      at = end;
    }
    return out.filter(Boolean);
  }

  // Send the queue from `from` onwards. Everything that changes what is being
  // said — carrying on, skipping, a new speed, a new voice — is this.
  async function speakFrom(from) {
    if (!state.parts.length) return false;
    state.index = Math.max(0, Math.min(from, state.parts.length - 1));
    state.base = state.index;
    state.speaking = true;
    changed();
    try {
      await VexBridge.speak(state.parts.slice(state.index), {
        rate: rate(), voice: voice(), title: state.title || 'Reading aloud'
      });
      return true;
    } catch (error) {
      state.speaking = false;
      changed();
      VexUI.toast((error && error.message) || 'It could not read that', 4000);
      return false;
    }
  }

  return {
    state,
    RATES,

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async check() {
      const result = await VexBridge.speakAvailable().catch(() => ({}));
      state.available = !!(result && result.available);
      state.voices = (result && result.voices) || [];
      changed();
      return state.available;
    },

    rate,
    voice,

    /** Turn an extracted article into the lines that will be spoken. */
    linesFor(article) {
      if (!article) return [];
      const lines = [];
      if (article.title) lines.push(article.title);
      for (const block of article.blocks || []) {
        if (!block || !block.text) continue;          // images have nothing to say
        lines.push(...split(block.text));
      }
      return lines.slice(0, 500);
    },

    /** Read the page in the active tab, from the top. */
    async readPage() {
      const tab = VexTabStore.active();
      if (!tab || !tab.url || tab.url === 'about:blank') { VexUI.toast('Open a page first'); return false; }
      if (state.available === null) await this.check();
      if (!state.available) { VexUI.toast('This phone has no speech engine', 4000); return false; }

      VexUI.toast('Reading…', 900);
      let article = null;
      try { article = await VexReader.extract(tab.id); } catch { article = null; }
      const lines = this.linesFor(article);
      if (!lines.length) { VexUI.toast('There is no article on this page to read'); return false; }
      return this.readLines(lines, { title: (article && article.title) || tab.title || '', url: tab.url });
    },

    /**
     * Read lines somebody else already has. The reader has the article in hand
     * the moment it opens one, and extracting it a second time to read it aloud
     * would be a second trip into the page for text that is already here.
     */
    async readLines(lines, { title = '', url = '' } = {}) {
      if (!Array.isArray(lines) || !lines.length) { VexUI.toast('Nothing to read'); return false; }
      if (state.available === null) await this.check();
      if (!state.available) { VexUI.toast('This phone has no speech engine', 4000); return false; }
      // Pause and Stop live in the notification, which Android 13+ shows only
      // with this permission. Asked once; reading goes ahead either way.
      if (!askedNotifications && VexBridge.requestPermission) {
        askedNotifications = true;
        try { await VexBridge.requestPermission('notifications'); } catch { /* reads without it */ }
      }
      state.parts = lines;
      state.title = title;
      state.url = url;
      state.loaded = true;
      return speakFrom(0);
    },

    /** Pause, or carry on from where it stopped. */
    async toggle() {
      if (!state.loaded) return this.readPage();
      if (state.speaking) {
        state.speaking = false;
        changed();
        await VexBridge.speakPause().catch(() => {});
        return false;
      }
      return speakFrom(state.index);
    },

    /** Back or forward a line. Paused stays paused, at the new line. */
    async skip(by) {
      if (!state.loaded) return false;
      const next = Math.max(0, Math.min(state.index + by, state.parts.length - 1));
      if (!state.speaking) {
        state.index = next;
        state.base = next;
        changed();
        return true;
      }
      return speakFrom(next);
    },

    /**
     * Coming back to Vex: catch up with what the reading did while the chrome
     * was not looking — it may have read on, or been paused from the lock
     * screen, and the events for that can arrive late or not at all.
     */
    async resync() {
      if (!state.loaded) return;
      const now = await VexBridge.speakState().catch(() => null);
      if (!now) return;
      if (Number.isFinite(now.index) && now.index >= 0) {
        state.index = Math.min(state.base + now.index, Math.max(0, state.parts.length - 1));
      }
      state.speaking = now.speaking;
      changed();
    },

    /** Put the bar away and stop talking. */
    async stop() {
      state.loaded = false;
      state.speaking = false;
      state.index = 0;
      state.base = 0;
      state.parts = [];
      changed();
      await VexBridge.speakStop().catch(() => {});
    },

    /** Step through the speeds; reading carries on from the same line. */
    async cycleRate() {
      const current = rate();
      const next = RATES[(RATES.findIndex(value => value >= current) + 1) % RATES.length];
      await this.setRate(next);
      return next;
    },

    async setRate(value) {
      await VexStore.set('vex.speakRate', value);
      if (state.speaking) await speakFrom(state.index);
      else changed();
    },

    async setVoice(name) {
      await VexStore.set('vex.speakVoice', name);
      if (state.speaking) await speakFrom(state.index);
      else changed();
    },

    bind() {
      VexBridge.onSpeak('speaking', data => {
        // The index the engine reports is relative to what was last sent, which
        // after carrying on or skipping is not the start of the article.
        const at = Number(data && data.index);
        if (!Number.isFinite(at) || at < 0) return;
        state.index = Math.min(state.base + at, Math.max(0, state.parts.length - 1));
        changed();
      });
      VexBridge.onSpeak('finished', () => {
        // The bar stays up, offering to read it again — the article is still
        // the one on screen, and a finished read is not a closed one.
        state.speaking = false;
        state.index = 0;
        state.base = 0;
        changed();
      });
      // Paused, carried on or stopped from the notification, the lock screen,
      // the headset — or by a phone call or headphones coming out.
      VexBridge.onSpeak('paused', () => {
        if (!state.loaded) return;
        state.speaking = false;
        changed();
      });
      VexBridge.onSpeak('resumed', () => {
        if (!state.loaded) return;
        state.speaking = true;
        changed();
      });
      VexBridge.onSpeak('stopped', () => {
        state.loaded = false;
        state.speaking = false;
        state.index = 0;
        state.base = 0;
        state.parts = [];
        changed();
      });
      VexBridge.onSpeak('speakError', () => {
        state.speaking = false;
        changed();
        VexUI.toast('The speech engine stopped');
      });
    }
  };
})();

if (typeof window !== 'undefined') window.VexSpeak = VexSpeak;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSpeak };
