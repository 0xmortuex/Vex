// === Vex Mobile — reading a PDF ===
//
// Android's WebView cannot render a PDF. Every link to one is handed to the
// download manager, which is why tapping a timetable on a phone gets you a file
// in Downloads rather than a timetable. Samsung Internet has a viewer built in;
// so does this, with pdf.js.
//
// How it fits: the native side sees the download start, recognises a PDF and
// sends it here as an event instead. The file is fetched by native — with the
// page's own cookies, because a PDF behind a login is the common case and a
// fetch without them downloads an HTML sign-in page with a .pdf name — into the
// cache, where Capacitor's file proxy lets the chrome read it.
//
// pdf.js is loaded the first time one is opened, not at boot: it is 1.7 MB and
// most sessions never meet a PDF.

const VexPdf = (() => {
  const { $, el, clear, icon } = VexDom;

  const state = {
    open: false,
    url: '',
    name: '',
    pages: 0,
    page: 1,
    scale: 1,
    document: null,
    rendering: false
  };

  let library = null;

  async function load() {
    if (library) return library;
    // A WebView too old for pdf.js's modules fails here rather than halfway
    // through a page, which is the difference between "download it instead" and
    // a blank screen.
    library = await import('../vendor/pdf/pdf.min.mjs');
    library.GlobalWorkerOptions.workerSrc = '../vendor/pdf/pdf.worker.min.mjs';
    return library;
  }

  function src(path) {
    const convert = window.Capacitor && window.Capacitor.convertFileSrc;
    return convert ? convert(path) : path;
  }

  async function renderPage(number) {
    if (!state.document) return;
    const page = await state.document.getPage(number);
    // Render at the device's real pixels, then show at CSS pixels: a canvas
    // rendered at 1x and scaled up is what makes a phone PDF look like a fax.
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = $('pdf-pages').clientWidth - 16;
    const base = page.getViewport({ scale: 1 });
    const scale = (width / base.width) * state.scale;
    const viewport = page.getViewport({ scale: scale * ratio });

    const canvas = el('canvas', 'pdf-page');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = Math.round(viewport.width / ratio) + 'px';
    canvas.style.height = Math.round(viewport.height / ratio) + 'px';
    $('pdf-pages').appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  }

  // Which scale the pages on screen were drawn at. Zooming a long document
  // used to do nothing at all: renderAll() refused to start while a render was
  // in flight, and a fifty-page PDF is in flight for a while. Zoom bumps this
  // instead, and the loop that is already running starts over at the new scale.
  let wanted = 0;

  async function renderAll() {
    wanted++;
    if (state.rendering) return;          // the running loop will pick it up
    state.rendering = true;
    try {
      let drawing = -1;
      while (drawing !== wanted && state.open) {
        drawing = wanted;
        clear($('pdf-pages'));
        // Everything, in order, one at a time: a phone has no memory to spare
        // for a hundred canvases at once, and a reader scrolls.
        for (let number = 1; number <= state.pages; number++) {
          if (drawing !== wanted || !state.open) break;   // zoomed, or closed
          await renderPage(number);
        }
      }
    } catch (error) {
      VexReport.note('PDF render failed: ' + (error.message || error), state.url);
      VexUI.toast('That PDF could not be drawn', 4000);
    } finally {
      state.rendering = false;
    }
  }

  function setCount() {
    $('pdf-count').textContent = state.pages ? state.page + ' / ' + state.pages : '';
  }

  return {
    state,

    isOpen() { return state.open; },

    /** Show a PDF the page tried to download. */
    async open(url, name) {
      state.url = url;
      state.name = name || 'document.pdf';
      state.page = 1;
      state.scale = 1;
      state.open = true;

      $('pdfview').hidden = false;
      VexUI.cover(true);
      $('pdf-name').textContent = state.name;
      $('pdf-count').textContent = '';
      clear($('pdf-pages')).appendChild(el('div', 'pdf-waiting', 'Fetching…'));

      let path;
      try {
        const file = await VexBridge.fetchFile(url, state.name);
        path = file && file.path;
        if (!path) throw new Error('nothing came back');
      } catch (error) {
        this.close();
        VexUI.toast(error.message || 'That PDF could not be fetched', 4500);
        return;
      }

      clear($('pdf-pages')).appendChild(el('div', 'pdf-waiting', 'Opening…'));
      try {
        const pdfjs = await load();
        state.document = await pdfjs.getDocument({ url: src(path) }).promise;
        state.pages = state.document.numPages;
        setCount();
        await renderAll();
      } catch (error) {
        VexReport.note('PDF open failed: ' + (error.message || error), url);
        this.close();
        // Somewhere to go rather than a dead end: the file is real, Vex just
        // cannot draw it here.
        if (await VexUI.confirm('This PDF could not be opened in Vex. Download it instead?', 'PDF')) {
          this.download();
        }
      }
    },

    close() {
      if (!state.open) return;
      state.open = false;
      state.document = null;
      state.pages = 0;
      clear($('pdf-pages'));
      $('pdfview').hidden = true;
      VexUI.cover(false);
    },

    zoom(by) {
      const next = Math.max(0.5, Math.min(4, state.scale + by));
      if (next === state.scale) return;        // already at the end of the range
      state.scale = next;
      renderAll();
    },

    download() {
      const tab = VexTabStore.active();
      if (!tab) return null;
      return VexDownloads.queue(tab, state.url, state.name);
    },

    share() {
      return VexBridge.share(state.url, state.name);
    },

    bind() {
      $('pdf-close').onclick = () => this.close();
      $('pdf-in').onclick = () => this.zoom(0.25);
      $('pdf-out').onclick = () => this.zoom(-0.25);
      $('pdf-download').onclick = () => this.download();
      $('pdf-share').onclick = () => this.share();
      // Which page you are on, from where you have scrolled to.
      $('pdf-pages').addEventListener('scroll', () => {
        const pages = [...$('pdf-pages').children];
        if (!pages.length) return;
        const top = $('pdf-pages').scrollTop;
        let at = 1;
        let offset = 0;
        for (let index = 0; index < pages.length; index++) {
          offset += pages[index].offsetHeight + 8;
          if (offset > top + 80) { at = index + 1; break; }
          at = index + 1;
        }
        if (at !== state.page) { state.page = at; setCount(); }
      }, { passive: true });
    }
  };
})();

if (typeof window !== 'undefined') window.VexPdf = VexPdf;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPdf };
