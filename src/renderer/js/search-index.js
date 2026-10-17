// === The shared search index service (T3-108) ======================================
//
// Notes, history, the library, mail headers, clips and bookmarks each searched
// themselves: every keystroke rebuilt its list from storage and scanned it. This
// is ONE small in-memory index they can share:
//
//   - one tokenizer: text is folded the way the rest of Vex folds it (VexTr.fold,
//     so "istanbul" finds "İstanbul") and cut into 3-letter grams;
//   - named SOURCES (each consumer owns one or more) that are filled with
//     { id, type, title, subtitle, body, ... } items, replaced only when their
//     signature changed, and updated one item at a time (upsert / remove);
//   - candidates(): for a search term of 3 letters or more, only the items that
//     contain every gram of it. That is a SUPERSET of the substring matches, so a
//     consumer that then scores the candidates gets exactly the results a full
//     scan would (shorter terms scan the source);
//   - a global size CAP with least-recently-used eviction: when the index is over
//     the cap, the source used longest ago is dropped whole. A dropped source is
//     reported as not indexed and its consumer scans, as it did before this
//     existed. Nothing is ever lost: the index holds copies, never the only copy;
//   - stats(): every source with its item count and size, and the cap.
//
// Memory only. Nothing is written to disk and nothing leaves the window. The cap
// (vex.searchIndex.capMB) is the only stored setting.
//
// Consumers using it: UniversalSearch (js/universal-search.js) and the open-tab text search
// (TabContentIndex.searchText, source 'tabs:text').
// Deliberately NOT moved, because moving would change what they find or hold the same corpus twice:
//   - Recall (src/main/recall-index.js) and the knowledge base (src/main/knowledge-base.js) live in the main
//     process, are saved to disk, rank by stemmed BM25 (and by meaning, with embeddings) and hold tens of
//     thousands of pages; this index is renderer memory, 3-letter grams and capped at 24 MB;
//   - the history indexer writes AI summaries and is not a search structure (its summaries are searched
//     through the 'universal:history' source);
//   - tab title search (js/tab-search.js) ranks fuzzy matches, which a gram filter would drop.
(function () {
  const CAP_KEY = 'vex.searchIndex.capMB';
  const DEFAULT_CAP_MB = 24;
  const GRAM = 3;
  const BODY_MAX = 20000;
  const BODY_LIMIT = 200000;     // the most any one item may ask for
  const ITEM_OVERHEAD = 220;
  const GRAM_BYTES = 18;

  const foldFn = () => {
    const tr = (typeof globalThis !== 'undefined' && globalThis.VexTr) || (typeof require === 'function' ? require('./vex-tr.js').VexTr : null);
    if (!tr || typeof tr.fold !== 'function') throw new Error('The search index needs the folding rules (js/vex-tr.js)');
    return (s) => tr.fold(String(s == null ? '' : s));
  };

  function gramsOf(text) {
    const out = new Set();
    for (let i = 0; i + GRAM <= text.length; i++) out.add(text.substr(i, GRAM));
    return out;
  }

  // A cheap 32-bit signature of a string, for "did the source change".
  function signature(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return s.length + ':' + (h >>> 0).toString(36);
  }

  function create(opts = {}) {
    const fold = opts.fold || foldFn();
    const now = opts.now || (() => Date.now());
    let capBytes = opts.capBytes != null ? opts.capBytes : DEFAULT_CAP_MB * 1024 * 1024;
    const sources = new Map();   // name -> { name, sig, docs: Map(id -> {item, grams, bytes}), grams: Map(gram -> Set(id)), bytes, lastUsed, evicted }

    const total = () => { let t = 0; for (const s of sources.values()) t += s.bytes; return t; };

    function addDoc(src, item) {
      if (!item || item.id == null) throw new Error('An indexed item needs an id');
      const id = String(item.id);
      if (src.docs.has(id)) removeDoc(src, id);
      // bodyMax: a source whose consumer searches more than the first 20 000 letters says so (open-tab page text).
      const bodyMax = Number.isFinite(item.bodyMax) ? Math.min(Math.max(item.bodyMax, 0), BODY_LIMIT) : BODY_MAX;
      const text = fold(item.title) + ' ' + fold(item.subtitle) + ' ' + fold(String(item.body == null ? '' : item.body).slice(0, bodyMax));
      const grams = gramsOf(text);
      for (const g of grams) { let set = src.grams.get(g); if (!set) src.grams.set(g, set = new Set()); set.add(id); }
      const bytes = text.length * 2 + grams.size * GRAM_BYTES + ITEM_OVERHEAD;
      src.docs.set(id, { item, grams, bytes });
      src.bytes += bytes;
    }
    function removeDoc(src, id) {
      const d = src.docs.get(id);
      if (!d) return false;
      for (const g of d.grams) { const set = src.grams.get(g); if (set) { set.delete(id); if (!set.size) src.grams.delete(g); } }
      src.bytes -= d.bytes;
      src.docs.delete(id);
      return true;
    }
    function evictOver(keep) {
      while (total() > capBytes) {
        let oldest = null;
        for (const s of sources.values()) {
          if (s.evicted || s.bytes === 0) continue;
          if (s.name === keep && sources.size > 1 && [...sources.values()].some(o => o !== s && !o.evicted && o.bytes > 0)) continue;
          if (!oldest || s.lastUsed < oldest.lastUsed) oldest = s;
        }
        if (!oldest) return;
        oldest.docs.clear(); oldest.grams.clear(); oldest.bytes = 0; oldest.evicted = true; oldest.sig = null;
      }
    }
    const need = (name) => {
      if (typeof name !== 'string' || !name) throw new Error('A source needs a name');
      let s = sources.get(name);
      if (!s) { s = { name, sig: null, docs: new Map(), grams: new Map(), bytes: 0, lastUsed: now(), evicted: false }; sources.set(name, s); }
      return s;
    };

    return {
      signature,

      // Is this source's content current with `sig`? (Skip rebuilding it when so.)
      isCurrent(name, sig) { const s = sources.get(name); return !!s && !s.evicted && s.sig === sig; },
      isIndexed(name) { const s = sources.get(name); return !!s && !s.evicted && s.sig !== null; },

      // Replaces the whole source. -> true when it is indexed afterwards, false when the cap dropped it.
      replace(name, items, sig) {
        const s = need(name);
        s.docs.clear(); s.grams.clear(); s.bytes = 0; s.evicted = false;
        for (const item of items) addDoc(s, item);
        s.sig = sig == null ? signature(JSON.stringify(items.map(i => i.id))) : sig;
        s.lastUsed = now();
        evictOver(name);
        return this.isIndexed(name);
      },
      upsert(name, item) {
        const s = need(name);
        if (s.evicted) return false;
        addDoc(s, item);
        s.lastUsed = now();
        s.sig = (s.sig || '') + '+';          // no longer the signature of any stored copy
        evictOver(name);
        return this.isIndexed(name);
      },
      remove(name, id) {
        const s = sources.get(name);
        if (!s || s.evicted) return false;
        s.sig = (s.sig || '') + '-';
        return removeDoc(s, String(id));
      },
      clear(name) { const s = sources.get(name); if (!s) return false; s.docs.clear(); s.grams.clear(); s.bytes = 0; s.sig = null; s.evicted = false; return true; },
      drop(name) { return sources.delete(name); },

      // The items of `name` that could contain every term (already folded). null when the source is not indexed.
      candidates(name, terms) {
        const s = sources.get(name);
        if (!s || s.evicted || s.sig === null) return null;
        s.lastUsed = now();
        let ids = null;
        for (const term of terms) {
          if (term.length < GRAM) continue;
          for (const g of gramsOf(term)) {
            const set = s.grams.get(g);
            if (!set) return [];
            ids = ids === null ? new Set(set) : new Set([...ids].filter(x => set.has(x)));
            if (!ids.size) return [];
          }
        }
        return ids === null ? [...s.docs.values()].map(d => d.item) : [...ids].map(id => s.docs.get(id).item);
      },
      count(name) { const s = sources.get(name); return s && !s.evicted ? s.docs.size : 0; },
      all(name) { const s = sources.get(name); return s && !s.evicted ? [...s.docs.values()].map(d => d.item) : null; },

      setCap(bytes) {
        if (!Number.isFinite(bytes) || bytes < 1024 * 1024) throw new Error('The search index cap is at least 1 MB');
        capBytes = bytes;
        evictOver(null);
        return capBytes;
      },
      cap() { return capBytes; },
      stats() {
        return {
          capBytes, bytes: total(),
          sources: [...sources.values()].map(s => ({ name: s.name, items: s.docs.size, bytes: s.bytes, evicted: s.evicted, lastUsed: s.lastUsed })).sort((a, b) => b.bytes - a.bytes),
        };
      },
    };
  }

  // The window's one shared index; its cap is the person's setting.
  function sharedCap() {
    let raw = null;
    try { raw = localStorage.getItem(CAP_KEY); }
    catch (err) { throw new Error('The search index cap could not be read: ' + err.message); }
    if (raw === null) return DEFAULT_CAP_MB * 1024 * 1024;
    const mb = Number(raw);
    if (!Number.isFinite(mb) || mb < 1) throw new Error('The search index cap "' + raw + '" is not a number of megabytes');
    return mb * 1024 * 1024;
  }

  const VexSearchIndex = {
    CAP_KEY, DEFAULT_CAP_MB, GRAM, create, signature,
    _shared: null,
    shared() { return this._shared || (this._shared = create({ capBytes: sharedCap() })); },
    setCapMB(mb) {
      localStorage.setItem(CAP_KEY, String(mb));
      return this.shared().setCap(mb * 1024 * 1024);
    },
    group(el) {
      el.appendChild(VexSettingsGroups.note('One in-memory index shared by Ctrl+K search over history, notes, clips, mail headers, read-later and bookmarks. It is rebuilt each start and never written to disk. When it is over its limit, the source used longest ago is dropped and searched the slow way instead.'));
      const st = this.shared().stats();
      el.appendChild(VexSettingsGroups.note('In use: ' + Math.round(st.bytes / 1024 / 1024 * 10) / 10 + ' MB of ' + Math.round(st.capBytes / 1024 / 1024) + ' MB.'));
      for (const s of st.sources) el.appendChild(VexSettingsGroups.note(s.name + ': ' + s.items + ' items, ' + Math.round(s.bytes / 1024) + ' KB' + (s.evicted ? ' (dropped to stay under the limit)' : '')));
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center';
      const input = document.createElement('input');
      input.type = 'number'; input.min = '1'; input.max = '256'; input.value = String(Math.round(st.capBytes / 1024 / 1024));
      input.className = 'vexsr-input';
      input.setAttribute('aria-label', 'Search index limit in megabytes');
      row.append(input, VexSettingsGroups.button('Set limit (MB)', () => {
        try { this.setCapMB(Number(input.value)); window.showToast?.('Search index limit set', 'success'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      }));
      el.appendChild(row);
    },
  };

  if (typeof window !== 'undefined') {
    window.VexSearchIndex = VexSearchIndex;
    if (typeof VexSettingsGroups !== 'undefined') {
      VexSettingsGroups.register({ id: 'search-index', title: 'Search index', keywords: 'search index memory limit cap universal search size', before: 'about', build: (el) => VexSearchIndex.group(el) });
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexSearchIndex, create, signature };
})();
