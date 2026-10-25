// The preview pane: what is selected, shown. A picture, a sound, a video, the start of a text or Markdown file, a page of a PDF, or
// the facts of a folder. Everything the pane draws from a file is set with textContent or as the source of a media element, never as markup.

import { t } from './strings.js';
import { el, iconSpan } from './ui.js';
import { formatSize, formatDateLong, formatNumber } from './format.js';
import { renderMarkdown } from './md.js';

export function createPane(ctx) {
  const { root, host, data, actions } = ctx;
  let ticket = 0;
  let timer = 0;

  function stopMedia() {
    for (const m of root.querySelectorAll('audio, video')) { try { m.pause(); } catch { /* vex-allow-empty-catch: pausing an element that was never playing is not an event */ } m.removeAttribute('src'); m.load(); }
  }
  function clear() { stopMedia(); root.replaceChildren(); }

  function fact(list, label, value) {
    if (value === '' || value == null) return;
    list.append(el('dt', { text: label }), el('dd', { text: value }));
  }

  function buttons(names, e, kind) {
    const bar = el('div', { class: 'fv-pane-actions' });
    const single = names.length === 1;
    const b = (label, run, extra) => bar.append(el('button', { class: 'fv-btn-text' + (extra ? ' ' + extra : ''), type: 'button', text: label, onclick: run }));
    if (single) {
      if (kind.open === 'folder') {
        b(t('Open'), () => actions.open(names[0]), 'primary');
        b(t('Open in a new tab'), () => actions.openInTab(names[0]));
      } else if (kind.open === 'tab') {
        b(t('Open'), () => actions.open(names[0]), 'primary');
        b(t('Open in a new tab'), () => actions.openInTab(names[0]));
        b(t('Open with Windows'), () => actions.external(names[0]));
      } else if (kind.open === 'external') {
        b(t('Open with Windows'), () => actions.external(names[0]), 'primary');
      }
      b(t('Show in File Explorer'), () => actions.reveal(names[0]));
      b(t('Copy path'), () => actions.copy([names[0]], 'path'));
    }
    return bar;
  }

  function warningFor(kind, name) {
    if (kind.open !== 'runnable') return null;
    const box = el('div', { class: 'fv-warn', role: 'group', 'aria-label': t('Warning') },
      iconSpan('warning', 18, 'fv-ico'),
      el('div', { class: 'fv-warn-text' },
        el('strong', { text: t('This kind of file can run programs') }),
        el('p', { text: t('Vex will not run it for you. Open it with Windows only if you made it or trust where it came from.') }),
        el('button', { class: 'fv-btn-text danger', type: 'button', text: t('Open with Windows…'), onclick: () => actions.external(name) })));
    return box;
  }

  async function show() {
    const mine = ++ticket;
    stopMedia();
    const names = [...data.selected];
    if (!names.length) { root.replaceChildren(summaryOfFolder()); return; }
    if (names.length > 1) { root.replaceChildren(summaryOfMany(names)); return; }
    const name = names[0];
    const i = data.byName.get(name);
    if (i === undefined) { root.replaceChildren(); return; }
    const e = data.entries[i], kind = data.kinds[i];
    const head = el('div', { class: 'fv-pane-head' }, iconSpan(kind.icon, 28, 'fv-ico big'), el('div', { class: 'fv-pane-title', dir: 'auto', text: name }));
    const stage = el('div', { class: 'fv-stage' });
    const facts = el('dl', { class: 'fv-facts' });
    fact(facts, t('Type'), t(kind.label, kind.args));
    if (!e.d) fact(facts, t('Size'), data.size[i] >= 0 ? formatSize(data.size[i]) + ' (' + formatNumber(data.size[i]) + ' B)' : '');
    else {
      const f = data.folderSizes.get(name);
      if (f) fact(facts, t('Size'), sizeText(f));
    }
    fact(facts, t('Modified'), data.mtime[i] ? formatDateLong(data.mtime[i]) : '');
    if (data.flags[i] & 1) fact(facts, t('Attributes'), t('Read-only'));
    if (e.h) fact(facts, t('Attributes'), t('Hidden'));
    if (e.l) fact(facts, t('Attributes'), e.b ? t('A link that points nowhere') : t('A link'));
    root.replaceChildren(head, stage, facts, buttons([name], e, kind), warningFor(kind, name) || '');
    if (e.d) {
      stage.append(el('div', { class: 'fv-stage-icon' }, iconSpan('folder', 64, 'fv-ico huge')));
      const f = data.folderSizes.get(name);
      if (!f) stage.append(el('button', { class: 'fv-btn-text', type: 'button', text: t('Calculate the folder size'), onclick: () => actions.calcSize(name) }));
      return;
    }
    stage.append(el('div', { class: 'fv-stage-note', text: t('Reading the preview…') }));
    let r;
    try { r = await host.preview({ name }); }
    catch (err) { if (mine === ticket) stage.replaceChildren(el('div', { class: 'fv-stage-note', text: err.message })); return; }
    if (mine !== ticket) return;
    if (!r.ok) { stage.replaceChildren(el('div', { class: 'fv-stage-note', text: actions.explain(r) })); return; }
    const p = r.preview;
    if (p.kind === 'image') {
      const img = el('img', { class: 'fv-stage-img', alt: name, src: p.url });
      img.addEventListener('load', () => { const d = el('div', { class: 'fv-stage-note', text: img.naturalWidth + ' × ' + img.naturalHeight + ' px' }); stage.append(d); });
      img.addEventListener('error', () => stage.replaceChildren(el('div', { class: 'fv-stage-note', text: t('This picture could not be shown') })));
      stage.replaceChildren(img);
    } else if (p.kind === 'audio') {
      stage.replaceChildren(el('div', { class: 'fv-stage-icon' }, iconSpan('music', 64, 'fv-ico huge')), el('audio', { controls: true, src: p.url, 'aria-label': name, preload: 'metadata' }));
    } else if (p.kind === 'video') {
      stage.replaceChildren(el('video', { class: 'fv-stage-img', controls: true, src: p.url, 'aria-label': name, preload: 'metadata' }));
    } else if (p.kind === 'thumb') {
      if (p.thumb) stage.replaceChildren(el('img', { class: 'fv-stage-img', alt: name, src: p.thumb }));
      else stage.replaceChildren(el('div', { class: 'fv-stage-icon' }, iconSpan(kind.icon, 64, 'fv-ico huge')), el('div', { class: 'fv-stage-note', text: t('No picture of this file is available') }));
    } else if (p.kind === 'text') {
      stage.replaceChildren(el('pre', { class: 'fv-text', tabindex: '0', 'aria-label': t('The start of the file'), text: p.text || t('(empty)') }));
      if (p.truncated) stage.append(el('div', { class: 'fv-stage-note', text: t('Only the start of the file is shown') }));
    } else if (p.kind === 'markdown') {
      const md = renderMarkdown(p.text);
      md.tabIndex = 0;
      md.setAttribute('aria-label', t('The start of the file'));
      stage.replaceChildren(md);
      if (p.truncated) stage.append(el('div', { class: 'fv-stage-note', text: t('Only the start of the file is shown') }));
    } else {
      stage.replaceChildren(el('div', { class: 'fv-stage-icon' }, iconSpan(kind.icon, 64, 'fv-ico huge')), el('div', { class: 'fv-stage-note', text: t('There is no preview for this kind of file') }));
    }
  }

  function sizeText(f) {
    const tail = f.done ? (f.partial ? ' ' + t('(not all of it was counted)') : '') : ' …';
    return formatSize(f.bytes) + ' · ' + t('{files} files, {dirs} folders', { files: formatNumber(f.files), dirs: formatNumber(f.dirs) }) + tail;
  }

  function summaryOfFolder() {
    const folders = data.entries.filter((e) => e.d).length;
    return el('div', { class: 'fv-pane-empty' },
      iconSpan('folder-open', 48, 'fv-ico huge'),
      el('p', { class: 'fv-pane-count', text: t('{n} items', { n: formatNumber(data.entries.length) }) }),
      el('p', { class: 'fv-pane-sub', text: t('{folders} folders, {files} files', { folders: formatNumber(folders), files: formatNumber(data.entries.length - folders) }) }),
      el('p', { class: 'fv-pane-sub', text: t('Select a file to see what is in it.') }));
  }
  function summaryOfMany(names) {
    let bytes = 0, folders = 0;
    for (const n of names) { const i = data.byName.get(n); if (i === undefined) continue; if (data.entries[i].d) folders++; else if (data.size[i] > 0) bytes += data.size[i]; }
    return el('div', { class: 'fv-pane-empty' },
      iconSpan('copy', 48, 'fv-ico huge'),
      el('p', { class: 'fv-pane-count', text: t('{n} items selected', { n: formatNumber(names.length) }) }),
      el('p', { class: 'fv-pane-sub', text: t('{folders} folders, {size} in files', { folders: formatNumber(folders), size: formatSize(bytes) }) }));
  }

  // The pane follows the selection, a moment later: moving down a long list does not read a file for every row passed.
  function soon() { clearTimeout(timer); timer = setTimeout(() => { show().catch((err) => console.error('[Folder browser] the preview failed:', err)); }, 140); }
  return { soon, show, clear, sizeText };
}
