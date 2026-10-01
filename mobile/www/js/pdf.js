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
    document: null
  };

  let library = null;

  async function load() {
    if (library) return library;
    // A WebView too old for pdf.js's modules fails here rather than halfway
    // through a page, which is the difference between "download it instead" and
    // a blank screen.
    await import('../vendor/pdf/vex-polyfills.mjs');
    library = await import('../vendor/pdf/pdf.min.mjs');
    library.GlobalWorkerOptions.workerSrc = '../vendor/pdf/vex-worker.mjs';
    return library;
  }

  function src(path) {
    const convert = window.Capacitor && window.Capacitor.convertFileSrc;
    return convert ? convert(path) : path;
  }

  // ── Drawing, a screenful at a time ──────────────────────────────────────
  // Every page drawn up front was a canvas at the phone's real pixels each:
  // around 8 MB a page on a Galaxy, so a 200-page textbook asked for more
  // than a gigabyte and took the WebView down with it. Now each page is a slot
  // of the right size, a page is drawn when it comes near the screen, and one
  // that has scrolled far away gives its canvas back.

  // What the slots were sized for. Zoom bumps it; a page drawn at an older one
  // is drawn again when it is next on screen.
  let generation = 0;
  let observer = null;
  let queue = Promise.resolve();
  const drawn = new Map();          // page number → generation it was drawn at
  let firstSize = null;             // CSS size of page 1, for slots not yet measured

  function cssWidth() { return Math.max(100, $('pdf-pages').clientWidth - 16); }

  async function viewportOf(number, ratio) {
    const page = await state.document.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const scale = (cssWidth() / base.width) * state.scale;
    return { page, viewport: page.getViewport({ scale: scale * ratio }), css: { width: base.width * scale, height: base.height * scale } };
  }

  function sizeSlot(slot, css) {
    slot.style.width = Math.round(css.width) + 'px';
    slot.style.height = Math.round(css.height) + 'px';
  }

  function release(slot) {
    const canvas = slot.querySelector('canvas');
    // A zero-sized canvas is the one way to make a WebView let go of its
    // backing store now rather than at the next collection.
    if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
    drawn.delete(Number(slot.dataset.page));
  }

  function draw(slot) {
    const number = Number(slot.dataset.page);
    const mine = generation;
    queue = queue.then(async () => {
      if (!state.open || mine !== generation || drawn.get(number) === mine || !slot.isConnected) return;
      if (!slot.__vexNear) return;                 // scrolled past before its turn
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const { page, viewport, css } = await viewportOf(number, ratio);
      if (!state.open || mine !== generation) return;
      sizeSlot(slot, css);
      const canvas = el('canvas', 'pdf-canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (!state.open || mine !== generation || !slot.__vexNear) { canvas.width = 0; canvas.height = 0; return; }
      const old = slot.querySelector('canvas');
      if (old) { old.width = 0; old.height = 0; old.remove(); }
      slot.appendChild(canvas);
      drawn.set(number, mine);
    }).catch(error => {
      VexReport.note('PDF render failed: ' + (error.message || error), state.url);
    });
    return queue;
  }

  function watch() {
    if (observer) observer.disconnect();
    if (typeof IntersectionObserver === 'undefined') {
      // No observer: draw them all, the old way, rather than nothing.
      for (const slot of $('pdf-pages').children) { slot.__vexNear = true; draw(slot); }
      return;
    }
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const slot = entry.target;
        slot.__vexNear = entry.isIntersecting;
        if (entry.isIntersecting) draw(slot);
        else if (drawn.has(Number(slot.dataset.page))) release(slot);
      }
    }, { root: $('pdf-pages'), rootMargin: '150% 0px' });
    for (const slot of $('pdf-pages').children) observer.observe(slot);
  }

  /** Lay out a slot per page, sized like page 1 until each is measured. */
  async function layout() {
    generation++;
    drawn.clear();
    const box = clear($('pdf-pages'));
    const { css } = await viewportOf(1, 1);
    firstSize = css;
    for (let number = 1; number <= state.pages; number++) {
      const slot = el('div', 'pdf-page');
      slot.dataset.page = String(number);
      sizeSlot(slot, firstSize);
      box.appendChild(slot);
    }
    watch();
  }

  async function renderAll() {
    try {
      await layout();
    } catch (error) {
      VexReport.note('PDF render failed: ' + (error.message || error), state.url);
      VexUI.toast('That PDF could not be drawn', 4000);
    }
  }

  /** Zoom: every slot scales with it, and what is on screen is drawn again. */
  async function rescale(from, to) {
    generation++;
    const factor = to / from;
    for (const slot of $('pdf-pages').children) {
      sizeSlot(slot, { width: parseFloat(slot.style.width) * factor, height: parseFloat(slot.style.height) * factor });
    }
    // The old drawings stay, stretched, until the sharp ones replace them:
    // better than a page going white under your thumb.
    for (const slot of $('pdf-pages').children) {
      const canvas = slot.querySelector('canvas');
      if (canvas) drawn.delete(Number(slot.dataset.page));
    }
    watch();
  }

  function setCount() {
    $('pdf-count').textContent = state.pages ? state.page + ' / ' + state.pages : '';
  }

  return {
    state,

    isOpen() { return state.open; },

    /** Show a PDF the page tried to download. */
    async open(url, name, { incognito = false } = {}) {
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
        // A private tab's PDF is fetched without the cookies, which are the
        // normal profile's.
        const file = await VexBridge.fetchFile(url, state.name, { cookies: !incognito });
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
      generation++;
      if (observer) { observer.disconnect(); observer = null; }
      for (const slot of [...$('pdf-pages').children]) release(slot);
      if (state.document && state.document.destroy) state.document.destroy().catch(() => {});
      state.document = null;
      state.pages = 0;
      clear($('pdf-pages'));
      $('pdfview').hidden = true;
      VexUI.cover(false);
    },

    zoom(by) {
      const next = Math.max(0.5, Math.min(4, state.scale + by));
      if (next === state.scale) return;        // already at the end of the range
      const from = state.scale;
      state.scale = next;
      rescale(from, next);
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
