// === Vex Mobile — the tools ===
//
// The things a phone browser does that a desktop one does not have to: read a
// QR code with the camera, hand this page to another device as a QR code,
// dictate into the address bar, keep a page for the tunnel, put a site on the
// home screen, photograph a page, and read a page in another language.
//
// Each is small on its own; they share a file because they all follow the same
// shape — ask native for a capability, do one thing with it, get out of the way.

const VexTools = (() => {
  const { $, el, icon, clear } = VexDom;

  // ── QR: reading one ──────────────────────────────────────────────────────
  let scanStream = null;
  let scanTimer = null;

  async function startScan(onResult) {
    if (typeof jsQR !== 'function') throw new Error('The QR decoder did not load');
    const granted = await VexBridge.requestPermission('camera');
    if (!granted) throw new Error('Vex needs the camera to read a QR code');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch {
      throw new Error('Could not open the camera');
    }
    scanStream = stream;

    const video = $('scan-video');
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    scanTimer = setInterval(() => {
      if (!video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
      if (found && found.data) {
        stopScan();
        onResult(found.data);
      }
    }, 260);
  }

  function stopScan() {
    clearInterval(scanTimer);
    scanTimer = null;
    if (scanStream) {
      for (const track of scanStream.getTracks()) track.stop();
      scanStream = null;
    }
    const video = $('scan-video');
    if (video) video.srcObject = null;
  }

  // ── QR: drawing one ──────────────────────────────────────────────────────
  // Hands this page to the machine next to you without typing a URL: the same
  // job the desktop's QR share does.
  function drawQr(text, size = 240) {
    if (typeof qrcode !== 'function') return null;
    const code = qrcode(0, 'M');
    code.addData(String(text));
    code.make();
    const modules = code.getModuleCount();
    const scale = Math.max(2, Math.floor(size / (modules + 8)));
    const quiet = scale * 4;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = modules * scale + quiet * 2;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    for (let row = 0; row < modules; row++) {
      for (let column = 0; column < modules; column++) {
        if (code.isDark(row, column)) {
          context.fillRect(quiet + column * scale, quiet + row * scale, scale, scale);
        }
      }
    }
    return canvas;
  }

  return {
    startScan, stopScan, drawQr,

    // ── Dictation ──────────────────────────────────────────────────────────
    async dictate() {
      const spoken = await VexBridge.voiceInput();
      return String(spoken || '').trim();
    },

    // ── Keep a page ────────────────────────────────────────────────────────
    // The whole document, stored on the device, openable with no network —
    // Samsung's "Save page" and the desktop's single-file save.
    async savePage(tab) {
      if (!tab || !tab.url || tab.url === 'about:blank') throw new Error('Open a page first');
      const { result } = await VexBridge.evaluate(tab.id,
        "(function(){return '<!DOCTYPE html>' + document.documentElement.outerHTML})()");
      let html = typeof result === 'string' ? result : '';
      // evaluate() hands back a JSON string; unwrap it once.
      if (html.startsWith('"')) { try { html = JSON.parse(html); } catch { /* already raw */ } }
      if (!html || html.length < 200) throw new Error('There was nothing to save');
      const record = {
        url: tab.url,
        title: tab.title || VexSearch.prettyHost(tab.url),
        html: html.slice(0, 4 * 1024 * 1024),
        at: Date.now(),
        size: html.length,
        icon: tab.icon || ''
      };
      await VexDB.add('pages', record);
      return record;
    },

    savedPages(limit = 200) { return VexDB.scan('pages', { limit }); },

    async openSaved(page) {
      const tab = VexTabStore.active();
      if (!tab) return;
      await VexBridge.loadHtml(tab.id, page.html, page.url);
      VexTabStore.update(tab.id, { url: page.url, title: page.title, loading: false, progress: 100 });
    },

    deleteSaved(id) { return VexDB.delete('pages', id); },

    // ── A picture of the page ──────────────────────────────────────────────
    async capture(tab, { full = false, share = true } = {}) {
      if (!tab) throw new Error('Open a page first');
      const shot = await VexBridge.capturePage(tab.id, full);
      if (!shot || !shot.path) throw new Error('Could not capture the page');
      if (share) await VexBridge.shareFile(shot.path, 'image/png', tab.title || 'Page');
      return shot.path;
    },

    // ── On the home screen ─────────────────────────────────────────────────
    async addToHomeScreen(tab) {
      if (!tab || !tab.url || tab.url === 'about:blank') throw new Error('Open a page first');
      await VexBridge.addShortcut(tab.url, tab.title || VexSearch.prettyHost(tab.url), tab.icon || '');
    },

    // ── Another language ───────────────────────────────────────────────────
    LANGUAGES: [
      ['en', 'English'], ['tr', 'Türkçe'], ['es', 'Español'], ['fr', 'Français'],
      ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'], ['ru', 'Русский'],
      ['ar', 'العربية'], ['hi', 'हिन्दी'], ['zh-CN', '中文'], ['ja', '日本語'], ['ko', '한국어']
    ],

    // Vex translates through your own AI worker, because the alternative is
    // handing the page you are reading to a translation service. If no worker
    // is configured it offers the web one, and says that is what it is doing.
    async translate(tab, language) {
      const name = (this.LANGUAGES.find(pair => pair[0] === language) || [, language])[1];
      // Whether this page may be read at all depends on where the answer comes
      // from. ai.js settles that for a question typed into the assistant; this
      // path reads the page itself, so it has to ask the same question — and
      // mark what it read, so the worker's payload can refuse it.
      const staysHere = VexAI.staysHere('translate');
      if (tab.incognito && !staysHere) {
        throw new Error('A private tab is not sent to your worker. Turn on on-device AI to translate it here.');
      }
      if (staysHere || await VexAI.configured()) {
        const text = await VexReader.pageText(tab.id, 5000);
        if (!text) throw new Error('There was no text to translate');
        const reply = await VexAI.ask('Translate this page into ' + name + '.', {
          action: 'translate', targetLanguage: name,
          context: { url: tab.url, title: tab.title, text, private: !!tab.incognito }
        });
        return { via: staysHere ? 'device' : 'worker', text: reply };
      }
      return { via: 'web', url: 'https://translate.google.com/translate?sl=auto&tl='
        + encodeURIComponent(language) + '&u=' + encodeURIComponent(tab.url) };
    }
  };
})();

if (typeof window !== 'undefined') window.VexTools = VexTools;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTools };
