// === Two things every page has and no browser lets you take ================
//
//   A table. Copying one out of a page gives you run-together text; the
//   columns are in the markup and nothing offers them to you. This reads the
//   real cells — colspan included — and gives you CSV.
//
//   A video's speed. Sites that have a speed control put it three menus deep,
//   and sites that do not have one leave you at 1x. Chromium can set any rate
//   on any <video>; the page simply never offers it. Vex remembers the rate
//   per site, so the next lecture starts at the speed you watch lectures at.
const PageTools = {
  // ---- tables ---------------------------------------------------------------
  // Runs in the page: returns every table with its real cell text.
  TABLE_SCRIPT: `(() => {
    const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const out = [];
    for (const table of document.querySelectorAll('table')) {
      const rows = [];
      for (const tr of table.rows) {
        const cells = [];
        for (const cell of tr.cells) {
          const text = clean(cell.innerText || cell.textContent);
          cells.push(text);
          // A cell spanning columns must leave the later ones empty, or every
          // row below it lines up one column to the left.
          for (let i = 1; i < (cell.colSpan || 1); i++) cells.push('');
        }
        if (cells.some(c => c)) rows.push(cells);
      }
      if (rows.length < 2) continue;                       // a layout table, not data
      const caption = clean(table.caption && table.caption.textContent);
      out.push({ caption, rows, columns: Math.max(...rows.map(r => r.length)) });
    }
    return out;
  })()`,

  async tables(webview) {
    const wv = webview || (typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null);
    if (!wv) throw new Error('No page is open');
    const found = await window.vexGuestEval(wv, this.TABLE_SCRIPT);
    return Array.isArray(found) ? found : [];
  },

  // Proper CSV: a field with a comma, a quote or a line break is quoted, and a
  // quote inside it is doubled. Spreadsheets are unforgiving about this.
  toCsv(rows) {
    const field = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map(r => r.map(field).join(',')).join('\r\n');
  },

  // Markdown, for a note: the first row becomes the header.
  toMarkdown(rows) {
    if (!rows.length) return '';
    const width = Math.max(...rows.map(r => r.length));
    const pad = (r) => Array.from({ length: width }, (_, i) => String(r[i] == null ? '' : r[i]).replace(/\|/g, '\\|'));
    const head = pad(rows[0]);
    const body = rows.slice(1).map(pad);
    return ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...body.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
  },

  // ---- video speed ----------------------------------------------------------
  SPEED_KEY: 'vex.videoSpeeds',     // { [host]: rate }
  RATES: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3],

  speeds() { try { const m = JSON.parse(localStorage.getItem(this.SPEED_KEY) || '{}'); return (m && typeof m === 'object') ? m : {}; } catch { return {}; } },
  speedFor(url) { try { return Number(this.speeds()[new URL(url).host]) || 1; } catch { return 1; } },

  setSpeedFor(url, rate) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0.1 || r > 5) throw new Error('A speed between 0.1 and 5 makes sense');
    let host;
    try { host = new URL(url).host; } catch { throw new Error('That tab has no address yet'); }
    const map = this.speeds();
    if (r === 1) delete map[host]; else map[host] = r;
    try { localStorage.setItem(this.SPEED_KEY, JSON.stringify(map)); }
    catch (err) { VexProblems?.note('Video speed', 'Could not save the speed', err); }
    return r;
  },

  // Applies to every video on the page, now and as they appear — a site that
  // swaps the player out on the next episode would otherwise go back to 1x.
  speedScript(rate) {
    return `(() => {
      const rate = ${Number(rate) || 1};
      window.__vexRate = rate;
      const put = () => document.querySelectorAll('video,audio').forEach(v => { try { if (v.playbackRate !== window.__vexRate) v.playbackRate = window.__vexRate; } catch {} });
      put();
      if (!window.__vexRateWired) {
        window.__vexRateWired = true;
        document.addEventListener('play', put, true);
        document.addEventListener('ratechange', (e) => { try { if (e.target.playbackRate !== window.__vexRate) e.target.playbackRate = window.__vexRate; } catch {} }, true);
        try { new MutationObserver(put).observe(document.documentElement, { childList: true, subtree: true }); } catch {}
      }
      return document.querySelectorAll('video,audio').length;
    })()`;
  },

  async applySpeed(webview, url, rate) {
    const wv = webview || (typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null);
    if (!wv) return 0;
    const r = rate == null ? this.speedFor(url || (wv.getURL ? wv.getURL() : '')) : Number(rate);
    if (r === 1 && rate == null) return 0;              // nothing to impose
    try { return await window.vexGuestEval(wv, this.speedScript(r)); }
    catch (err) { VexProblems?.note('Video speed', 'Could not set the speed on this page', err); return 0; }
  },
};

if (typeof window !== 'undefined') window.PageTools = PageTools;
if (typeof module !== 'undefined' && module.exports) module.exports = { PageTools };
