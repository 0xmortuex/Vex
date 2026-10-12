// === Vex Mobile — translating a page where it stands ===
//
// Chrome and Samsung Internet both translate by sending the page to a server.
// This does not: ML Kit's models run on the phone, and once a pair of languages
// has been downloaded a page can be translated with no connection at all — on a
// train, in another country, on a page you would rather nobody else read.
//
// How it works: the page's text nodes are collected in place and kept, with
// their original text, on the page itself. They go out in chunks, come back
// translated, and each chunk is written straight into the nodes it came from —
// so the page fills in as it goes, and "Show the original" is a loop over what
// was kept rather than a reload.
//
// Three deliberate limits:
//
//   • Models are never downloaded behind your back. A language pair is tens of
//     megabytes; it is asked for, and on Wi-Fi unless you say otherwise.
//   • 800 text nodes. A page with more than that is a feed, and the first 800
//     nodes of a feed are the part you are reading.
//   • Nothing in a <script>, <style>, <code>, <pre> or anything you are typing
//     into. Translating code is how you break a page.

const VexTranslate = (() => {
  const NODE_CAP = 800;
  const CHUNK = 40;

  const state = { tabId: '', from: '', to: '', showing: false, busy: false, nodes: 0 };

  // Collect, and remember. Returns the original strings, in node order.
  const COLLECT = `(function(){
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1 };
  if (!window.__vexTranslate) {
    var found = [], originals = [];
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var text = node.nodeValue;
        if (!text || text.trim().length < 2) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent || SKIP[parent.tagName]) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (parent.closest && parent.closest('[contenteditable=true]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode()) && found.length < ${NODE_CAP}) {
      found.push(node);
      originals.push(node.nodeValue);
    }
    window.__vexTranslate = { nodes: found, original: originals, title: document.title };
  }
  return JSON.stringify(window.__vexTranslate.original);
})()`;

  // JSON.stringify leaves U+2028 and U+2029 raw, and those two are line
  // terminators in JavaScript source: a page containing one would have ended the
  // statement this is built into. Every translated string came out of a page, so
  // every one of them goes through here.
  function literal(value) {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  const apply = (at, texts) => `(function(){
  var held = window.__vexTranslate;
  if (!held) return 'none';
  var next = ${literal(texts)};
  for (var index = 0; index < next.length; index++) {
    var node = held.nodes[${at} + index];
    // An empty answer means that one string did not translate; the original
    // stays, which is better than a hole in a paragraph.
    if (node && next[index]) node.nodeValue = next[index];
  }
  return 'ok';
})()`;

  const RESTORE = `(function(){
  var held = window.__vexTranslate;
  if (!held) return 'none';
  for (var index = 0; index < held.nodes.length; index++) {
    held.nodes[index].nodeValue = held.original[index];
  }
  if (held.title) document.title = held.title;
  return 'ok';
})()`;

  // evaluate() hands back a JSON string, sometimes double-encoded. Unlike the
  // reader's version of this, a plain string is a valid answer here ('ok'), so a
  // failed second parse keeps what the first one produced instead of giving up.
  function unwrap(raw) {
    let value = raw;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (typeof value !== 'string') break;
      try { value = JSON.parse(value); } catch { break; }
    }
    return value;
  }

  return {
    state,
    NODE_CAP,

    showing(tabId) { return state.showing && state.tabId === tabId; },

    wifiOnly() { return VexStore.get('vex.translateWifiOnly', true) !== false; },

    /** Every language ML Kit can do, and which are already on the phone. */
    async languages() {
      try {
        const result = await VexBridge.translateLanguages();
        return (result && result.languages) || [];
      } catch { return []; }
    },

    async deleteModel(language) {
      await VexBridge.translateDeleteModel(language);
    },

    /**
     * Translate the page in the active tab into `to`.
     *
     * Returns { ok, from, nodes } or { ok: false, why } — a sentence, because
     * every way this fails is something to say rather than throw: the page is in
     * a language nobody can identify, the pair is not supported, the model is not
     * here and there is no Wi-Fi.
     */
    async page(tab, to, { mobileData = false } = {}) {
      if (!tab || !tab.url || tab.url === 'about:blank') return { ok: false, why: 'Open a page first' };
      if (state.busy) return { ok: false, why: 'Still translating the last one' };
      state.busy = true;
      try {
        const collected = unwrap((await VexBridge.evaluate(tab.id, COLLECT)).result);
        if (!Array.isArray(collected) || !collected.length) {
          return { ok: false, why: 'There is no text on this page to translate' };
        }

        // Enough of the page to tell the language from, and no more: the
        // identifier wants a paragraph, not a book.
        const sample = collected.filter(text => text.trim().length > 20).slice(0, 12).join(' ')
          || collected.join(' ');
        const from = await VexBridge.translateIdentify(sample.slice(0, 1200));
        if (!from) return { ok: false, why: 'Vex could not tell what language this page is in' };
        if (from === to) return { ok: false, why: 'This page is already in that language' };

        // The model pair, which may be a download. Said out loud, because it is
        // tens of megabytes and the person should know why the wait happened.
        const wifiOnly = this.wifiOnly() && !mobileData;
        try {
          await VexBridge.translateEnsureModel(from, to, wifiOnly);
        } catch (error) {
          const needsWifi = wifiOnly && /wi-?fi/i.test(String((error && error.message) || ''));
          return {
            ok: false,
            needsWifi,
            why: needsWifi
              ? 'That language pair is not on the phone yet, and Vex only downloads models on Wi-Fi.'
              : (error.message || 'The translation model could not be downloaded')
          };
        }

        state.tabId = tab.id;
        state.from = from;
        state.to = to;
        state.nodes = collected.length;

        for (let at = 0; at < collected.length; at += CHUNK) {
          const slice = collected.slice(at, at + CHUNK);
          const translated = await VexBridge.translateTexts(from, to, slice);
          if (!Array.isArray(translated) || !translated.length) continue;
          await VexBridge.evaluate(tab.id, apply(at, translated));
        }
        state.showing = true;
        return { ok: true, from, to, nodes: collected.length };
      } catch (error) {
        return { ok: false, why: error.message || 'That page could not be translated' };
      } finally {
        state.busy = false;
      }
    },

    /** Put the page back the way it was written. */
    async original(tab) {
      if (!tab) return false;
      const result = unwrap((await VexBridge.evaluate(tab.id, RESTORE)).result);
      state.showing = false;
      return result === 'ok';
    },

    /** A navigation throws away what was collected, so forget it. */
    forget(tabId) {
      if (!tabId || state.tabId === tabId) {
        state.showing = false;
        state.tabId = '';
        state.from = '';
        state.nodes = 0;
      }
    }
  };
})();

if (typeof window !== 'undefined') window.VexTranslate = VexTranslate;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTranslate };
