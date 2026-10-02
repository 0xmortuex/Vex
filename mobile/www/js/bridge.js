// === Vex Mobile — native bridge ===
//
// One object between the chrome and the four native plugins:
//   VexTabs   — the Android WebViews that render pages, one per tab
//   VexBlock  — request blocking, inside shouldInterceptRequest
//   VexSecrets— secrets under an Android Keystore key
//   VexSystem — the device: biometrics, shortcuts, dictation, PiP, permissions
//
// The desktop chrome talks to Electron through window.vex (src/preload.js);
// this is its counterpart, and the method names are kept close on purpose so
// ported code reads the same.
//
// With no Capacitor present — the page opened in a desktop browser — every
// call falls back to something harmless, and page rendering falls back to
// iframes. That is for building the chrome on a laptop: sites that refuse
// framing will not load, and blocking, snapshots, find, downloads, biometrics
// and the Keystore are all no-ops.

const VexBridge = (() => {
  const listeners = new Map();              // event -> Set<fn>
  const devSecrets = Object.create(null);   // fallback only; never persisted
  const plugins = {
    VexTabs: null, VexBlock: null, VexSecrets: null, VexSystem: null,
    VexRemind: null, VexLocalAI: null, VexSpeak: null, VexTranslate: null
  };
  let native = false;

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload || {}); } catch (error) { console.error('[bridge]', event, error); }
    }
  }

  // ── Fallback: iframes standing in for native WebViews ────────────────────
  const fallback = (() => {
    const frames = new Map();
    let host = null, seq = 0, bounds = { x: 0, y: 0, width: 0, height: 0 };

    function ensureHost() {
      if (host) return host;
      host = document.createElement('div');
      host.id = 'fallback-webviews';
      Object.assign(host.style, { position: 'fixed', left: '0', top: '0', zIndex: '4', overflow: 'hidden' });
      document.body.appendChild(host);
      return host;
    }

    return {
      create({ url }) {
        const id = 'fb' + (++seq);
        const frame = document.createElement('iframe');
        frame.src = url || 'about:blank';
        Object.assign(frame.style, {
          position: 'absolute', inset: '0', width: '100%', height: '100%',
          border: '0', display: 'none', background: '#fff'
        });
        frame.addEventListener('load', () => {
          // A page from this origin can be read like a WebView's: its real
          // address (links followed inside it) and its title.
          let url = frame.src;
          let title = frame.src;
          try { url = frame.contentWindow.location.href; title = frame.contentDocument.title || url; } catch { /* cross-origin */ }
          emit('loadEnd', { id, url, title, canGoBack: false, canGoForward: false });
        });
        ensureHost().appendChild(frame);
        frames.set(id, frame);
        return { id };
      },
      close({ id }) { const frame = frames.get(id); if (frame) frame.remove(); frames.delete(id); return {}; },
      activate({ id }) {
        for (const [key, frame] of frames) frame.style.display = key === id ? 'block' : 'none';
        return {};
      },
      setBounds(rect) {
        bounds = rect;
        Object.assign(ensureHost().style, {
          left: bounds.x + 'px', top: bounds.y + 'px',
          width: bounds.width + 'px', height: bounds.height + 'px'
        });
        return {};
      },
      setVisible({ visible }) { ensureHost().style.display = visible ? 'block' : 'none'; return {}; },
      load({ id, url }) {
        const frame = frames.get(id);
        if (!frame) return {};
        emit('loadStart', { id, url });
        frame.src = url;
        return {};
      },
      back({ id }) { try { frames.get(id).contentWindow.history.back(); } catch { /* cross-origin */ } return {}; },
      forward({ id }) { try { frames.get(id).contentWindow.history.forward(); } catch { /* cross-origin */ } return {}; },
      // A frame's history cannot be listed, only walked.
      navList() { return { entries: [], current: -1 }; },
      go({ id, steps }) { try { frames.get(id).contentWindow.history.go(steps); } catch { /* cross-origin */ } return {}; },
      reload({ id }) { const frame = frames.get(id); if (frame) frame.src = frame.src; return {}; },
      state({ id }) { const frame = frames.get(id); return { url: frame ? frame.src : '', title: '', canGoBack: false, canGoForward: false }; },
      loadHtml({ id, html }) {
        const frame = frames.get(id);
        if (frame) frame.srcdoc = html;
        return {};
      },
      // Like WebView.evaluateJavascript: the value, JSON-encoded. Only a page
      // from this origin can be reached; anything else answers null, as before.
      evaluate({ id, code }) {
        const frame = frames.get(id);
        try {
          const value = frame.contentWindow.eval(code);
          return { result: value === undefined || (value && typeof value.then === 'function') ? null : JSON.stringify(value) };
        } catch { return { result: null }; }
      },
      snapshot() { return { dataUrl: '' }; },
      // Downloads have nowhere to go here; the ids are enough for the chrome to
      // draw them, and the walkthrough drives the stream's events by hand.
      save() { return { downloadId: String(9000 + (++seq)) }; },
      mediaStream() { return { stream: '' }; },
      downloadStream() { return { jobId: 'stream-dev-' + (++seq) }; },
      cancelStream() { return {}; }
    };
  })();

  // A stand-in for the on-device model, for development without a phone.
  //
  // It is not a model: it streams a canned answer a word at a time. But it is the
  // whole shape of one — supported, nothing installed, import, load, stream,
  // stop — so the settings panel, the routing and the streaming bubble can all
  // be driven in a desktop browser and in the walkthrough. On a device the
  // plugin is there and none of this runs.
  const localFallback = (() => {
    const state = { models: {}, loaded: false, busy: false, model: '', backend: '', vision: false, audio: false, clip: 0 };
    let cancelled = false;
    let tools = [];                 // what the conversation declared
    let nextCall = 1;
    const waiting = new Map();      // callId -> resolve

    // A model that "decides" to call a tool: the first declared tool whose name
    // shares a word with the prompt, with arguments read off the prompt as
    // plainly as possible — plot numbers, a flower, a quoted string. Enough to
    // drive a tool loop end to end without a phone.
    function pickTool(prompt) {
      const text = String(prompt || '').toLowerCase();
      const tool = tools.find(entry => String(entry.name).split('_').some(word => word.length > 3 && text.includes(word)))
        || null;
      if (!tool) return null;
      const args = {};
      const properties = (tool.parameters && tool.parameters.properties) || {};
      for (const [key, spec] of Object.entries(properties)) {
        if (spec.type === 'array') args[key] = (text.match(/\d+/g) || []).map(Number);
        else if (key === 'seed') args[key] = (text.match(/sunflower|daisy|rose|secret/) || ['sunflower'])[0];
        else if (key === 'skill_name') args[key] = (text.match(/[a-z]+-[a-z-]+/) || [''])[0];
        else args[key] = (String(prompt).match(/"([^"]*)"/) || [, ''])[1];
      }
      return { name: tool.name, args };
    }

    const ANSWER = 'This is the development stand-in for the on-device model. '
      + 'It streams a few words so the chrome can be driven without a phone.';

    function emitLocal(event, payload) { emit('localai:' + event, payload); }

    return {
      status: () => ({
        supported: true, loaded: state.loaded, busy: state.busy,
        model: state.model, backend: state.backend, vision: state.vision, audio: state.audio,
        recording: false, clipMillis: state.clip,
        models: state.models, directory: '(development)'
      }),
      nanoStatus: () => ({ status: 'unavailable' }),
      nanoDownload: () => ({ ok: false }),
      // Pretending to pick a file: it "arrives" a moment later, as a real import
      // would, so the progress and ready events are exercised too.
      pickModel: ({ name }) => {
        setTimeout(() => {
          emitLocal('modelProgress', { name, received: 300 << 20, total: 600 << 20 });
          state.models[name] = 600 << 20;
          emitLocal('modelReady', { name, bytes: state.models[name] });
        }, 60);
        return { picked: true };
      },
      download: ({ name }) => {
        setTimeout(() => {
          state.models[name] = 600 << 20;
          emitLocal('modelReady', { name, bytes: state.models[name] });
        }, 60);
        return { started: true, resumingFrom: 0 };
      },
      cancelDownload: () => ({}),
      deleteModel: ({ name }) => { delete state.models[name]; return { deleted: true }; },
      load: ({ name, backend, vision, audio, tools: declared }) => {
        if (state.models[name] === undefined) throw new Error('That model is not on this device');
        state.loaded = true;
        state.model = name;
        state.backend = backend || 'cpu';
        state.vision = !!vision;
        state.audio = !!audio;
        tools = declared ? JSON.parse(declared) : [];
        return { loaded: true, model: name, backend: state.backend, vision: state.vision, audio: state.audio };
      },
      reset: ({ tools: declared }) => {
        if (!state.loaded) throw new Error('No model is loaded');
        tools = declared ? JSON.parse(declared) : [];
        return { loaded: true, model: state.model, backend: state.backend, vision: state.vision, audio: state.audio };
      },
      toolResult: ({ callId, result }) => {
        const resolve = waiting.get(callId);
        if (resolve) { waiting.delete(callId); resolve(result); }
        return {};
      },
      unload: () => { state.loaded = false; state.model = ''; state.backend = ''; state.vision = false; state.audio = false; return {}; },
      // A grey square stands in for a photo.
      pickImage: () => ({
        picked: true, width: 1, height: 1,
        base64: '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
      }),
      recordAudio: () => new Promise(resolve => setTimeout(() => { state.clip = 2000; resolve({ millis: 2000 }); }, 50)),
      stopAudio: () => ({}),
      clearAudio: () => { state.clip = 0; return {}; },
      importAudio: () => { state.clip = 3000; return { picked: true, millis: 3000 }; },
      scrapOpen: ({ model }) => {
        if (state.models[model] === undefined) throw new Error('The cut-out model is not on this phone yet');
        return { picked: true, width: 4, height: 3, base64: '' };
      },
      scrapCut: () => ({
        found: true, x: 1, y: 1, w: 1, h: 1,
        png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
      }),
      scrapClose: () => ({}),
      deviceAction: ({ name }) => ({ text: 'Did ' + String(name).replace(/_/g, ' ') }),
      stop: () => { cancelled = true; return {}; },
      generate: async ({ id, prompt }) => {
        if (!state.loaded) throw new Error('No model is loaded');
        cancelled = false;
        state.busy = true;
        const call = tools.length ? pickTool(prompt) : null;
        let words = ANSWER.split(' ');
        if (call) {
          const callId = 'tool-' + (nextCall++);
          const answer = new Promise(resolve => waiting.set(callId, resolve));
          emitLocal('toolCall', { callId, name: call.name, args: JSON.stringify(call.args) });
          const result = await answer;
          words = ('Called ' + call.name + ': ' + result).split(' ');
        }
        return new Promise(resolve => {
          let at = 0;
          const tick = () => {
            if (cancelled || at >= words.length) {
              state.busy = false;
              const text = words.slice(0, at).join(' ');
              emitLocal('generated', { id, text });
              resolve({ id, text });
              return;
            }
            const chunk = (at ? ' ' : '') + words[at++];
            emitLocal('token', { id, text: chunk });
            setTimeout(tick, 15);
          };
          setTimeout(tick, 15);
        });
      }
    };
  })();

  // Reading aloud, without a phone. The browser's own speechSynthesis stands in
  // for Android's TextToSpeech: the same events in the same order, so the bar
  // and the skipping can be driven in a desktop browser. Where there is no
  // speechSynthesis either — a headless run — it reports itself unavailable,
  // which is a state the chrome has to handle anyway.
  const speakFallback = (() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    let queue = [];

    function emitSpeak(event, payload) { emit('speak:' + event, payload); }

    return {
      available: () => ({
        available: !!synth,
        voices: synth ? (synth.getVoices() || []).map(voice => ({
          name: voice.name, language: voice.lang || '', label: voice.name
        })) : []
      }),
      speak: ({ parts, rate }) => {
        if (!synth) throw new Error('This browser cannot speak');
        synth.cancel();
        queue = (parts || []).filter(Boolean);
        queue.forEach((text, index) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = Number(rate) || 1;
          utterance.onstart = () => emitSpeak('speaking', { index });
          utterance.onend = () => { if (index === queue.length - 1) emitSpeak('finished', {}); };
          utterance.onerror = () => emitSpeak('speakError', { index });
          synth.speak(utterance);
        });
        return { parts: queue.length };
      },
      stop: () => { if (synth) synth.cancel(); return {}; },
      // Carrying on re-sends the rest, so a pause here is a cancel too.
      pause: () => { if (synth) synth.cancel(); return {}; },
      speaking: () => ({ speaking: !!(synth && synth.speaking), index: -1 })
    };
  })();

  // Translating, without a phone. There is no on-device model in a desktop
  // browser, so the stand-in marks each string with the language it was asked
  // for: visibly not a translation, which is the point — it exercises the
  // collect / translate / write-back loop and the "show the original" path
  // without pretending to be ML Kit.
  const translateFallback = (() => {
    const downloaded = new Set(['en']);
    return {
      languages: () => ({
        languages: ['en', 'de', 'fr', 'es', 'tr', 'ja'].map(language => ({
          language,
          label: language,
          downloaded: downloaded.has(language)
        }))
      }),
      // Non-ASCII means "not English" and that is as far as a stand-in should go.
      identify: ({ text }) => ({ language: /[^\u0000-\u007f]/.test(String(text || '')) ? 'tr' : 'en' }),
      ensureModel: ({ from, to }) => { downloaded.add(from); downloaded.add(to); return { ready: true }; },
      translate: ({ to, texts }) => ({
        texts: (texts || []).map(text => (text ? '[' + to + '] ' + text : ''))
      }),
      deleteModel: ({ language }) => { downloaded.delete(language); return { deleted: true }; }
    };
  })();

  // A valid one-page PDF reading "Vex reads PDFs", for development and for the
  // walkthrough. Built rather than downloaded, so it depends on nothing.
  const DEVELOPMENT_PDF = 'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyNDAgMTIwXS9Db250ZW50cyA0IDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+Pj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDQ0Pj5zdHJlYW0KQlQgL0YxIDI0IFRmIDI0IDUyIFRkIChWZXggcmVhZHMgUERGcykgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCjAwMDAwMDAyMTcgMDAwMDAgbiAKMDAwMDAwMDMwOCAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjM3MQolJUVPRgo=';

  // Plugins, or single methods, whose failures are the caller's to handle. The
  // rest are forgiving — a tab call that fails resolves to {} — because the
  // chrome calls them on every page event and has nothing useful to say.
  const STRICT = new Set([
    'VexLocalAI', 'VexTranslate', 'VexSpeak',
    'VexTabs.openDownload', 'VexTabs.cancelDownload', 'VexTabs.openDownloadsFolder',
    'VexTabs.saveData', 'VexTabs.writeDownload', 'VexTabs.save', 'VexTabs.downloadStream'
  ]);

  function call(pluginName, method, args) {
    const plugin = plugins[pluginName];
    if (!plugin) {
      const stub = pluginName === 'VexTabs' ? fallback[method]
        : pluginName === 'VexLocalAI' ? localFallback[method]
        : pluginName === 'VexSpeak' ? speakFallback[method]
        : pluginName === 'VexTranslate' ? translateFallback[method] : null;
      if (!stub) return Promise.resolve({});
      // The stand-in throws the way the plugin rejects, so callers see one shape.
      try { return Promise.resolve(stub(args || {})); } catch (error) { return Promise.reject(error); }
    }
    return plugin[method](args || {}).catch(error => {
      console.error('[' + pluginName + '.' + method + ']', error);
      // The stand-in throws, every caller of these was written against it, and
      // on a phone the failure used to arrive as {} instead: a model that would
      // not load on the GPU never fell back to the CPU, and a translation whose
      // language pair was missing reported success having changed nothing.
      if (STRICT.has(pluginName) || STRICT.has(pluginName + '.' + method)) throw error;
      return {};
    });
  }

  const tabs = (method, args) => call('VexTabs', method, args);
  const system = (method, args) => call('VexSystem', method, args);

  const api = {
    get isNative() { return native; },

    /**
     * Stand in for native, for development and for the walkthrough.
     *
     * Every event the chrome reacts to — a page finishing, a download starting, a
     * page asking for the camera — arrives through emit(), and without a way in
     * there is no way to drive any of it from a desktop browser. Refused on a
     * device, where the events are real and a second source of them would be a
     * way to lie to the chrome.
     */
    emitNative(event, payload) {
      if (native) return false;
      emit(event, payload || {});
      return true;
    },

    async init() {
      const capacitor = window.Capacitor;
      native = !!(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform()
        && capacitor.Plugins && capacitor.Plugins.VexTabs);
      if (!native) return false;
      for (const name of Object.keys(plugins)) plugins[name] = capacitor.Plugins[name] || null;
      for (const event of ['loadStart', 'loadProgress', 'loadEnd', 'title', 'urlChange', 'icon',
        'newTab', 'download', 'error', 'blocked', 'findResult', 'permission', 'edgeSwipe',
        'longPress', 'fullscreen', 'scroll', 'selection', 'command',
        'streamProgress', 'streamDone', 'streamFailed', 'openedInApp']) {
        plugins.VexTabs.addListener(event, data => emit(event, data));
      }
      if (plugins.VexBlock) plugins.VexBlock.addListener('blocked', data => emit('blocked', data));
      return true;
    },

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },

    // ── Tabs ───────────────────────────────────────────────────────────────
    createTab(url, options = {}) { return tabs('create', { url: url || 'about:blank', incognito: !!options.incognito }); },
    closeTab(id) { return tabs('close', { id }); },
    activateTab(id) { return tabs('activate', { id }); },
    setBounds(rect) { return tabs('setBounds', rect); },
    setVisible(visible) { return tabs('setVisible', { visible: !!visible }); },
    load(id, url) { return tabs('load', { id, url }); },
    loadHtml(id, html, baseUrl) { return tabs('loadHtml', { id, html, baseUrl: baseUrl || '' }); },
    back(id) { return tabs('back', { id }); },
    forward(id) { return tabs('forward', { id }); },
    // The tab's own back/forward list: { entries: [{ url, title }], current }.
    async navList(id) {
      const result = await tabs('navList', { id });
      return {
        entries: Array.isArray(result && result.entries) ? result.entries : [],
        current: Number.isInteger(result && result.current) ? result.current : -1
      };
    },
    go(id, steps) { return tabs('go', { id, steps }); },
    reload(id, options = {}) { return tabs('reload', { id, bypassCache: !!options.bypassCache }); },
    stop(id) { return tabs('stop', { id }); },
    state(id) { return tabs('state', { id }); },
    snapshot(id) { return tabs('snapshot', { id }); },
    find(id, text) { return tabs('find', { id, text }); },
    findNext(id, forward) { return tabs('findNext', { id, forward: forward !== false }); },
    clearFind(id) { return tabs('clearFind', { id }); },
    setDesktopMode(id, enabled) { return tabs('setDesktopMode', { id, enabled: !!enabled }); },
    setDarkMode(id, enabled) { return tabs('setDarkMode', { id, enabled: !!enabled }); },
    setScriptsEnabled(id, enabled) { return tabs('setScriptsEnabled', { id, enabled: enabled !== false }); },
    setImagesEnabled(id, enabled) { return tabs('setImagesEnabled', { id, enabled: enabled !== false }); },
    // Off everywhere by default: a page that starts a video at you is the thing
    // this prevents. On per site, for the sites that are the reason you went.
    setAutoplayAllowed(id, allowed) { return tabs('setAutoplayAllowed', { id, allowed: allowed === true }); },
    setZoom(id, factor) { return tabs('setZoom', { id, factor: Number(factor) || 1 }); },
    setUserAgent(id, userAgent) { return tabs('setUserAgent', { id, userAgent: userAgent || '' }); },
    setTextZoom(percent) { return tabs('setTextZoom', { percent }); },
    print(id) { return tabs('print', { id }); },
    download(id, url) { return tabs('download', { id, url }); },
    scrollPosition(id) { return tabs('scrollPosition', { id }); },
    restoreScroll(id, y) { return tabs('restoreScroll', { id, y: Math.round(y) || 0 }); },
    setDocumentStartScript(script) { return tabs('setDocumentStartScript', { script: script || '' }); },
    setPrivacy(options = {}) { return tabs('setPrivacy', options); },
    setPullToRefresh(enabled) { return tabs('setPullToRefresh', { enabled: !!enabled }); },
    setScrollButtons(enabled) { return tabs('setScrollButtons', { enabled: !!enabled }); },
    setOpenInApps(enabled) { return tabs('setOpenInApps', { enabled: !!enabled }); },
    setBackgroundAudio(enabled) { return tabs('setBackgroundAudio', { enabled: !!enabled }); },
    evaluate(id, code) { return tabs('evaluate', { id, code }); },
    clearData(options = {}) { return tabs('clearData', options); },
    clearSiteData(host, origin) { return tabs('clearSiteData', { host: host || '', origin: origin || '' }); },
    // What the chrome decided about a page's request for the camera, the
    // microphone or your location. Anything not named is denied.
    answerPermission(requestId, granted) {
      return tabs('answerPermission', { requestId, granted: granted || [] });
    },
    capturePage(id, full) { return tabs('capturePage', { id, full: !!full }); },
    downloadStatus() { return tabs('downloadStatus', {}); },
    // The queue's id when there is one — native asks the queue for a Uri
    // another app may read — or a saved file's own Uri.
    openDownload({ downloadId = '', localUri = '' } = {}) {
      return tabs('openDownload', { downloadId: String(downloadId || ''), localUri: localUri || '' });
    },
    // DownloadManager has no pause: removing it is what cancelling is.
    cancelDownload(id) { return tabs('cancelDownload', { id: String(id) }); },
    openDownloadsFolder() { return tabs('openDownloadsFolder', {}); },
    // A file the chrome made itself — a backup, an export — written into
    // Downloads. The chrome's own WebView has no download handler, so an <a
    // download> there went nowhere.
    writeToDownloads(filename, mimeType, base64) {
      return tabs('writeDownload', { filename, mimeType, base64 });
    },
    // Bytes the chrome read out of a page, written into Downloads.
    saveData(tabId, filename, mimeType, base64) {
      return tabs('saveData', { id: tabId, filename, mimeType, base64 });
    },
    setWindowBackground(color, dark) {
      if (!plugins.VexTabs) return Promise.resolve({});
      return tabs('setWindowBackground', { color, dark: dark !== false });
    },

    // ── Blocking ───────────────────────────────────────────────────────────
    async setBlocking(enabled) { await call('VexBlock', 'setEnabled', { enabled: !!enabled }); },
    async setSiteAllowed(host, allowed) { await call('VexBlock', 'setSiteAllowed', { host, allowed: !!allowed }); },
    async blockStats() { return call('VexBlock', 'stats', {}); },
    async loadRules(payload) { return call('VexBlock', 'loadRules', payload); },

    // ── Secrets ────────────────────────────────────────────────────────────
    // In the browser fallback there is no keystore, so a secret is kept in
    // memory for the session and forgotten after it.
    async vaultSet(key, value) {
      if (plugins.VexSecrets) { await plugins.VexSecrets.set({ key, value: value || '' }); return; }
      devSecrets[key] = value || '';
    },
    // `strict` makes a failed read an error rather than an empty answer — for
    // the callers that would write over the secret if they took '' for
    // "nothing stored": the password vault, and the sync key.
    async vaultGet(key, { strict = false } = {}) {
      if (plugins.VexSecrets) {
        const result = await plugins.VexSecrets.get({ key }).catch(error => {
          if (strict) throw new Error((error && error.message) || 'The secure store could not be read just now');
          return { value: '' };
        });
        return (result && result.value) || '';
      }
      return devSecrets[key] || '';
    },
    async vaultClear() {
      if (plugins.VexSecrets) { await plugins.VexSecrets.clear(); return; }
      for (const key of Object.keys(devSecrets)) delete devSecrets[key];
    },

    // ── The device ─────────────────────────────────────────────────────────
    async biometricsAvailable() {
      const result = await system('biometricsAvailable', {});
      return !!(result && result.available);
    },
    async authenticate(title, subtitle) {
      if (!plugins.VexSystem) return { ok: true, simulated: true };   // fallback: nothing to guard
      return system('authenticate', { title, subtitle });
    },
    addShortcut(url, title, icon) { return system('addShortcut', { url, title, icon }); },
    async voiceInput() {
      const result = await system('voiceInput', {});
      return (result && result.text) || '';
    },
    enterPictureInPicture(width, height) { return system('enterPictureInPicture', { width, height }); },
    async hasPermission(name) {
      const result = await system('hasPermission', { name });
      return !!(result && result.granted);
    },
    async requestPermission(name) {
      if (!plugins.VexSystem) {
        // In a desktop browser the platform prompt is the browser's own.
        return true;
      }
      const result = await system('requestPermission', { name });
      return !!(result && result.granted);
    },
    // What the app was launched to do, when it was not a URL: text shared from
    // another app, or a tap on the home-screen widget. Asked once on boot,
    // because a cold start delivers the intent before the chrome exists.
    async pendingIntent() {
      const result = await system('pendingIntent', {});
      return { text: (result && result.text) || '', widget: (result && result.widget) || '' };
    },
    async isDefaultBrowser() {
      const result = await system('isDefaultBrowser', {});
      return !!(result && result.value);
    },
    openDefaultBrowserSettings() { return system('openDefaultBrowserSettings', {}); },

    // Fetch a file into the cache for the chrome to render — a PDF — carrying
    // the page's cookies, because a PDF behind a login is the common case.
    async fetchFile(url, name, { cookies = true } = {}) {
      if (!plugins.VexSystem) {
        // Development: there is no native fetch and no network in the
        // walkthrough, so hand back a real one-page PDF. It is 551 bytes, it is
        // valid, and it means the reader can be driven end to end — pdf.js and
        // all — without a phone or a server.
        return { path: 'data:application/pdf;base64,' + DEVELOPMENT_PDF, bytes: 551, type: 'application/pdf' };
      }
      return system('fetchFile', { url, name, cookies: !!cookies });
    },

    // ── Sleeping tabs ──────────────────────────────────────────────────────
    // onPause on a background tab's WebView: its timers and animations stop and
    // the page stays loaded, so waking it is instant.
    sleepTab(tabId) { return tabs('sleepTab', { id: tabId }); },
    wakeTab(tabId) { return tabs('wakeTab', { id: tabId }); },
    async sleepingTabs() {
      const result = await tabs('sleeping', {});
      return (result && result.ids) || [];
    },

    // A file the chrome was shown and decided to keep after all.
    // Resolves with the queue's id, so the downloads list can follow it.
    saveFile(tabId, url, filename) { return tabs('save', { id: tabId, url, filename }); },

    // ── Saving a video ─────────────────────────────────────────────────────
    // The HLS playlist the page last asked for, seen in its requests — the only
    // way to find the source of a player that hands its <video> a blob: URL.
    async mediaStream(tabId) {
      const result = await tabs('mediaStream', { id: tabId });
      return (result && result.stream) || '';
    },
    // Starts a job; streamProgress, streamDone and streamFailed follow.
    downloadStream(tabId, url, filename) { return tabs('downloadStream', { id: tabId, url, filename }); },
    cancelStream(jobId) { return tabs('cancelStream', { jobId }); },

    // ── Translating on the device ──────────────────────────────────────────
    translateLanguages() { return call('VexTranslate', 'languages', {}); },
    async translateIdentify(text) {
      const result = await call('VexTranslate', 'identify', { text });
      return (result && result.language) || '';
    },
    translateEnsureModel(from, to, wifiOnly = true) {
      return call('VexTranslate', 'ensureModel', { from, to, wifiOnly });
    },
    async translateTexts(from, to, texts) {
      const result = await call('VexTranslate', 'translate', { from, to, texts });
      return (result && result.texts) || [];
    },
    translateDeleteModel(language) { return call('VexTranslate', 'deleteModel', { language }); },

    // ── Reading aloud ──────────────────────────────────────────────────────
    async speakAvailable() {
      const result = await call('VexSpeak', 'available', {});
      return { available: !!(result && result.available), voices: (result && result.voices) || [] };
    },
    // The title is what the notification and the lock screen show.
    speak(parts, { rate = 1, voice = '', title = '' } = {}) {
      return call('VexSpeak', 'speak', { parts, rate, voice, title });
    },
    speakPause() { return call('VexSpeak', 'pause', {}); },
    speakStop() { return call('VexSpeak', 'stop', {}); },
    async speakState() {
      const result = await call('VexSpeak', 'speaking', {});
      return { speaking: !!(result && result.speaking), index: Number(result && result.index) };
    },
    onSpeak(event, fn) {
      const plugin = plugins.VexSpeak;
      if (!plugin) {
        const key = 'speak:' + event;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(fn);
        return () => { const set = listeners.get(key); if (set) set.delete(fn); };
      }
      const handle = plugin.addListener(event, fn);
      return () => { try { if (handle && handle.remove) handle.remove(); } catch { /* gone */ } };
    },

    // What this phone is, for the diagnostics page and a bug report.
    async deviceReport() {
      if (!plugins.VexSystem) {
        return {
          android: '—', sdk: 0, device: 'development fallback', abi: '',
          webview: 'the browser you are running this in', webviewVersion: '',
          webviewFeatures: { multiProfile: false, documentStartScript: false, algorithmicDarkening: false },
          freeBytes: -1, version: ''
        };
      }
      return system('deviceReport', {});
    },

    // A plain GET through native, for the search engine's suggestions: the
    // endpoints send no CORS header, so the chrome cannot ask them itself.
    async fetchText(url, { purpose = '' } = {}) {
      if (!plugins.VexSystem) {
        if (purpose === 'list') return { ok: false, status: 0, body: '' };
        // Development: no native, and the engines would refuse a cross-origin
        // request anyway. Answer with the shape they answer with, so the
        // omnibox can be driven here.
        const query = decodeURIComponent((String(url).match(/[?&]q(?:uery)?=([^&]*)/) || [])[1] || '');
        if (!query) return { ok: false, status: 0, body: '' };
        return {
          ok: true, status: 200,
          body: JSON.stringify([query, [query + ' meaning', query + ' in english', query + ' lyrics']])
        };
      }
      const result = await system('fetchText', { url, purpose });
      return { ok: !!(result && result.ok), status: (result && result.status) || 0, body: (result && result.body) || '' };
    },
    setFullscreen(value) { return system('setFullscreen', { value: !!value }); },
    setKeepAwake(value) { return system('setKeepAwake', { value: !!value }); },
    setStatusBarHidden(value) { return system('setStatusBarHidden', { value: !!value }); },
    // FLAG_SECURE: no screenshot, and nothing in the recents thumbnail.
    setScreenshotsBlocked(value) { return system('setScreenshotsBlocked', { value: !!value }); },
    shareFile(path, mimeType, title) { return system('shareFile', { path, mimeType, title }); },

    // ── The AI that stays on the phone ─────────────────────────────────────
    // One door for both backends: the model Vex runs itself, and Gemini Nano.
    // Generation reports its tokens as events, so the plugin's listeners are
    // exposed here too.
    localAI(method, args) { return call('VexLocalAI', method, args || {}); },

    onLocalAI(event, fn) {
      const plugin = plugins.VexLocalAI;
      if (!plugin) {
        // No plugin: the development stand-in emits through the same listener
        // table every other event goes through, namespaced so it cannot collide
        // with a tab event of the same name.
        const key = 'localai:' + event;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(fn);
        return () => { const set = listeners.get(key); if (set) set.delete(fn); };
      }
      const handle = plugin.addListener(event, fn);
      return () => { try { if (handle && handle.remove) handle.remove(); } catch { /* already gone */ } };
    },

    // ── Reminders ──────────────────────────────────────────────────────────
    // The time goes over as a string: a millisecond timestamp does not fit in
    // the int the bridge would otherwise make of it.
    scheduleReminder(entry) {
      return call('VexRemind', 'schedule', {
        id: entry.id, atMillis: String(entry.at), url: entry.url,
        title: entry.title || '', note: entry.note || ''
      });
    },
    cancelReminder(id) { return call('VexRemind', 'cancel', { id }); },

    // ── Platform odds and ends ─────────────────────────────────────────────
    async share(url, title) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
      if (plugin) {
        try { await plugin.share({ title: title || url, url, dialogTitle: 'Share link' }); } catch { /* dismissed */ }
        return;
      }
      if (navigator.share) {
        try { await navigator.share({ title, url }); } catch { /* dismissed */ }
      }
    },
    // `dark` describes the THEME, so the bar's icons have to be the opposite:
    // a dark theme gets light icons, which Capacitor calls style DARK.
    async setStatusBarStyle(dark, color) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
      if (!plugin) return;
      try {
        await plugin.setStyle({ style: dark ? 'DARK' : 'LIGHT' });
        if (color) await plugin.setBackgroundColor({ color });
      } catch { /* some devices refuse a coloured bar */ }
    },
    onAppEvent(name, fn) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (plugin) plugin.addListener(name, fn);
    }
  };

  // The chrome is driven by native events. In the browser fallback there is no
  // native to fire them, so the smoke run does — nothing else uses this, and on
  // a device the events come from the plugin.
  if (typeof window !== 'undefined') window.__vexEmit = emit;

  return api;
})();

if (typeof window !== 'undefined') window.VexBridge = VexBridge;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBridge };
