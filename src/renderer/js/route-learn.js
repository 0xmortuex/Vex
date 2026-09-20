// === Learning which of your sentences are tasks ============================
//
// Vex decides whether what you typed is a question (chat) or a job (agent)
// from the shape of the sentence. It is right most of the time and wrong in a
// way that is always the same for a given person: "check the build" is a task
// for one person and a question for another, and no fixed rule can know which.
//
// When it gets it wrong you correct it by typing /chat or /agent. That
// correction is the answer, so it is kept: the unusual words of that sentence
// are remembered with the side you chose, and next time a sentence made of
// those words goes that way without being told.
//
// It only ever holds words you typed at Vex, on this machine, and only when
// you explicitly overrode the guess. "Forget what Vex learned" empties it.
const RouteLearn = {
  KEY: 'vex.routeLearn',
  MAX_WORDS: 300,
  MIN_STRENGTH: 2,           // how sure before it changes a decision
  STOP: new Set(['the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'this', 'that', 'it', 'is', 'are', 'was', 'be', 'do', 'does', 'did', 'my', 'me', 'i', 'you', 'please', 'can', 'could', 'would', 'vex', 'hey', 'ok', 'okay']),

  all() { try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } },
  save(map) {
    // Oldest-weakest out first so this stays a small, honest list.
    const entries = Object.entries(map);
    if (entries.length > this.MAX_WORDS) {
      entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      map = Object.fromEntries(entries.slice(0, this.MAX_WORDS));
    }
    try { localStorage.setItem(this.KEY, JSON.stringify(map)); } catch {}
    return map;
  },
  forget() { try { localStorage.removeItem(this.KEY); } catch {} },

  // The words worth remembering: what is left after the filler.
  words(text) {
    return [...new Set(String(text || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])]
      .filter(w => !this.STOP.has(w))
      .slice(0, 8);
  },

  // A correction: +1 towards agent, -1 towards chat, per word.
  learn(text, wasAgent) {
    const words = this.words(text);
    if (!words.length) return null;
    const map = this.all();
    for (const w of words) {
      const at = Number(map[w]) || 0;
      // Capped, so one word repeated all week cannot outvote everything else.
      map[w] = Math.max(-5, Math.min(5, at + (wasAgent ? 1 : -1)));
      if (map[w] === 0) delete map[w];
    }
    return this.save(map);
  },

  // What this sentence looks like, from what was learned: a number where
  // positive leans agent and negative leans chat. Zero means nothing learned
  // applies, and the ordinary rules decide.
  lean(text) {
    const map = this.all();
    let score = 0;
    for (const w of this.words(text)) score += Number(map[w]) || 0;
    return score;
  },

  // The final say, given what the rules decided. Only a lean that is clearly
  // one way overturns a rule — a single weak word must not.
  decide(text, guessedAgent) {
    const score = this.lean(text);
    if (score >= this.MIN_STRENGTH && !guessedAgent) return { agent: true, changed: true, score };
    if (score <= -this.MIN_STRENGTH && guessedAgent) return { agent: false, changed: true, score };
    return { agent: guessedAgent, changed: false, score };
  },

  // How many words it has an opinion about, for the settings line.
  size() { return Object.keys(this.all()).length; },
};

if (typeof window !== 'undefined') window.RouteLearn = RouteLearn;
if (typeof module !== 'undefined' && module.exports) module.exports = { RouteLearn };
