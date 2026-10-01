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
// It deliberately stops when you leave Vex. Carrying on from a backgrounded app
// needs a foreground service and a notification, at which point a browser is
// pretending to be a music player — and the only way to silence one of those is
// to find it in the notification shade.

const VexSpeak = (() => {
  const state = {
    available: null,       // null until asked
    voices: [],
    reading: false,
    index: 0,
    parts: [],
    title: '',
    url: ''
  };

  const listeners = new Set();
  function changed() { for (const fn of listeners) { try { fn(state); } catch { /* a gone panel */ } } }

  function rate() { return Number(VexStore.get('vex.speakRate', 1)) || 1; }
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

  return {
    state,

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async check() {
      const result = await VexBridge.speakAvailable();
      state.available = !!(result && result.available);
      state.voices = (result && result.voices) || [];
      changed();
      return state.available;
    },

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

    /** Read the page in the active tab. */
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

      state.parts = lines;
      state.index = 0;
      state.title = (article && article.title) || tab.title || '';
      state.url = tab.url;
      state.reading = true;
      changed();
      try {
        await VexBridge.speak(lines, { rate: rate(), voice: voice() });
      } catch (error) {
        state.reading = false;
        changed();
        VexUI.toast(error.message || 'It could not read that', 4000);
        return false;
      }
      return true;
    },

    async stop() {
      state.reading = false;
      state.index = 0;
      changed();
      await VexBridge.speakStop();
    },

    /** Start again from a given line — which is what a speed change needs. */
    async resumeFrom(index) {
      if (!state.parts.length) return;
      state.index = Math.max(0, Math.min(index, state.parts.length - 1));
      state.reading = true;
      changed();
      await VexBridge.speak(state.parts.slice(state.index), { rate: rate(), voice: voice() });
    },

    async setRate(value) {
      await VexStore.set('vex.speakRate', value);
      if (state.reading) await this.resumeFrom(state.index);
    },

    async setVoice(name) {
      await VexStore.set('vex.speakVoice', name);
      if (state.reading) await this.resumeFrom(state.index);
    },

    bind() {
      VexBridge.onSpeak('speaking', data => {
        // The index is relative to whatever was last sent, which after a resume
        // is not the whole article.
        const offset = state.parts.length && state.reading ? state.index : 0;
        const at = Number(data && data.index);
        if (!Number.isFinite(at) || at < 0) return;
        state.index = Math.min(offset + at, Math.max(0, state.parts.length - 1));
        changed();
      });
      VexBridge.onSpeak('finished', () => {
        state.reading = false;
        state.index = 0;
        changed();
      });
      VexBridge.onSpeak('speakError', () => {
        state.reading = false;
        changed();
        VexUI.toast('The speech engine stopped');
      });
    }
  };
})();

if (typeof window !== 'undefined') window.VexSpeak = VexSpeak;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSpeak };
