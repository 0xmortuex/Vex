// A .pptx drawn slide by slide as ordinary HTML at the size the file says (EMU / 9525 = px), scaled to fit by the page.
//
// What is drawn: backgrounds (solid and the first stop of a gradient), text boxes and placeholders (position, size, colour,
// bold, italic, underline, alignment, bullets, numbering, the text sizes of the layout and master), pictures, tables, groups,
// lines and the common shapes (rectangle, rounded rectangle, ellipse, triangle, diamond, arrows, hexagon). Speaker notes are read.
// What is NOT drawn, and the viewer says so: animations and transitions, charts, SmartArt, embedded video and audio, 3-D, WordArt
// effects, shadows and glows, picture crops and effects, and any shape outside that list (shown as an outlined box).
//
// Safe by construction: nodes are made with createElement / textContent; pictures are blobs from the file itself; a link is never
// followed from a slide; nothing runs.

import { NS, parseXml, parseRels, kids, kid, all, attr, dirOf, imageMime, isUndrawable, EMU_PER_PX, readableOn } from './xml.js';
import { t } from './strings.js';

const A = NS.a, P = NS.p;
const emu = (v) => (Number(v) || 0) / EMU_PER_PX;
const aattr = (el, name) => (el ? el.getAttribute(name) : null);

// ---- loading -------------------------------------------------------------------------------------------------
export async function loadPptx(pkg) {
  let mainPath = 'ppt/presentation.xml';
  const rootRels = pkg.has('_rels/.rels') ? parseRels(await pkg.text('_rels/.rels'), '') : {};
  for (const r of Object.values(rootRels)) if (r.type === 'officeDocument') mainPath = r.target;
  if (!pkg.has(mainPath)) throw Object.assign(new Error('This file has no presentation. It may not be a PowerPoint file'), { code: 'corrupt' });
  const base = dirOf(mainPath);
  const rels = parseRels(await pkg.text(base + '_rels/' + mainPath.slice(base.length) + '.rels'), base);
  const doc = parseXml(await pkg.text(mainPath), 'The presentation');
  const sz = all(doc, 'sldSz')[0];
  const model = {
    pkg, size: { w: emu(sz ? sz.getAttribute('cx') : 9144000) || 960, h: emu(sz ? sz.getAttribute('cy') : 6858000) || 720 }, slides: [], cache: new Map(), parts: new Map(), images: new Map(),
    macros: pkg.has('ppt/vbaProject.bin'), props: {},
  };
  for (const id of all(all(doc, 'sldIdLst')[0], 'sldId')) {
    const rel = rels[id.getAttributeNS(NS.r, 'id')];
    if (rel && pkg.has(rel.target)) model.slides.push({ path: rel.target });
  }
  if (!model.slides.length) throw Object.assign(new Error('This presentation has no slides'), { code: 'corrupt' });
  if (pkg.has('docProps/core.xml')) {
    try { const core = parseXml(await pkg.text('docProps/core.xml'), ''); const title = all(core, 'title')[0]; model.props = { title: title ? title.textContent.trim() : '' }; } catch { model.props = {}; }
  }
  return model;
}

export function releasePptx(model) { for (const u of model.images.values()) URL.revokeObjectURL(u); model.images.clear(); model.cache.clear(); }

async function part(model, path) {
  if (model.parts.has(path)) return model.parts.get(path);
  const p = (async () => {
    if (!model.pkg.has(path)) return null;
    const doc = parseXml(await model.pkg.text(path), path);
    const dir = dirOf(path);
    const relsPath = dir + '_rels/' + path.slice(dir.length) + '.rels';
    const rels = model.pkg.has(relsPath) ? parseRels(await model.pkg.text(relsPath), dir) : {};
    return { path, doc, rels };
  })();
  model.parts.set(path, p);
  return p;
}

// The slide with its layout, master and theme.
async function slideContext(model, index) {
  const slide = await part(model, model.slides[index].path);
  const layoutRel = Object.values(slide.rels).find((r) => r.type === 'slideLayout');
  const layout = layoutRel ? await part(model, layoutRel.target) : null;
  const masterRel = layout && Object.values(layout.rels).find((r) => r.type === 'slideMaster');
  const master = masterRel ? await part(model, masterRel.target) : null;
  const themeRel = master && Object.values(master.rels).find((r) => r.type === 'theme');
  const theme = themeRel ? await part(model, themeRel.target) : null;
  const notesRel = Object.values(slide.rels).find((r) => r.type === 'notesSlide');
  const notes = notesRel ? await part(model, notesRel.target) : null;
  return { slide, layout, master, theme, notes, palette: palette(theme, master) };
}

// ---- colours ---------------------------------------------------------------------------------------------------------
function palette(theme, master) {
  const scheme = {};
  const cs = theme && all(theme.doc, 'clrScheme')[0];
  if (cs) for (const c of kids(cs)) {
    const k = kid(c);
    if (!k) continue;
    scheme[c.localName] = k.localName === 'sysClr' ? (k.getAttribute('lastClr') || '000000') : (k.getAttribute('val') || '000000');
  }
  const map = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  const cm = master && all(master.doc, 'clrMap')[0];
  if (cm) for (const k of ['bg1', 'tx1', 'bg2', 'tx2']) if (cm.getAttribute(k)) map[k] = cm.getAttribute(k);
  const out = { dk1: '000000', lt1: 'ffffff', dk2: '44546a', lt2: 'e7e6e6', accent1: '4472c4', accent2: 'ed7d31', accent3: 'a5a5a5', accent4: 'ffc000', accent5: '5b9bd5', accent6: '70ad47', hlink: '0563c1', folHlink: '954f72', ...scheme };
  for (const [k, v] of Object.entries(map)) out[k] = out[v] || out[k];
  return out;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t0) => { let t1 = t0; if (t1 < 0) t1 += 1; if (t1 > 1) t1 -= 1; if (t1 < 1 / 6) return p + (q - p) * 6 * t1; if (t1 < 1 / 2) return q; if (t1 < 2 / 3) return p + (q - p) * (2 / 3 - t1) * 6; return p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
const PRESET = { black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', gray: '808080', grey: '808080' };

// A colour element (srgbClr, schemeClr, sysClr, prstClr) -> '#rrggbb' or null.
function colorOf(el, ctx) {
  if (!el) return null;
  let hex = null;
  const v = el.getAttribute('val');
  switch (el.localName) {
    case 'srgbClr': hex = v; break;
    case 'sysClr': hex = el.getAttribute('lastClr') || '000000'; break;
    case 'prstClr': hex = PRESET[v] || '000000'; break;
    case 'schemeClr': hex = (ctx.palette[v] || ctx.palette.accent1); break;
    default: return null;
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mods = kids(el);
  if (mods.length) {
    let [h, s, l] = rgbToHsl(r, g, b);
    for (const m of mods) {
      const n = (+m.getAttribute('val') || 0) / 100000;
      if (m.localName === 'lumMod') l *= n;
      else if (m.localName === 'lumOff') l += n;
      else if (m.localName === 'satMod') s *= n;
      else if (m.localName === 'tint') l = l + (1 - l) * (1 - n);
      else if (m.localName === 'shade') l *= n;
    }
    [r, g, b] = hslToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
  }
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
}

// spPr / bgPr / a:ln : the fill it names -> { color } | { none: true } | null (not said)
function fillOf(pr, ctx) {
  if (!pr) return null;
  for (const c of kids(pr)) {
    if (c.localName === 'noFill') return { none: true };
    if (c.localName === 'solidFill') { const col = colorOf(kid(c), ctx); return col ? { color: col } : null; }
    if (c.localName === 'gradFill') {
      const gs = all(c, 'gs')[0];
      const col = gs ? colorOf(kid(gs), ctx) : null;
      return col ? { color: col, gradient: true } : null;
    }
    if (c.localName === 'blipFill') return { picture: true };
  }
  return null;
}

// ---- positions ----------------------------------------------------------------------------------------------------
function xfrmOf(spPr) {
  const x = spPr && kid(spPr, 'xfrm');
  if (!x) return null;
  const off = kid(x, 'off'), ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return { x: emu(off.getAttribute('x')), y: emu(off.getAttribute('y')), w: emu(ext.getAttribute('cx')), h: emu(ext.getAttribute('cy')), rot: (+x.getAttribute('rot') || 0) / 60000, flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1', chOff: kid(x, 'chOff'), chExt: kid(x, 'chExt') };
}

function placeholderOf(sp) {
  const nv = kid(sp, 'nvSpPr') || kid(sp, 'nvPicPr') || kid(sp, 'nvGraphicFramePr');
  const ph = nv && all(nv, 'ph')[0];
  return ph ? { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') } : null;
}
function findPlaceholder(part0, ph) {
  if (!part0 || !ph) return null;
  const tree = all(part0.doc, 'spTree')[0];
  if (!tree) return null;
  let byType = null;
  for (const sp of kids(tree, 'sp')) {
    const p = placeholderOf(sp);
    if (!p) continue;
    if (ph.idx != null && p.idx === ph.idx) return sp;
    if (!byType && p.type === ph.type && (ph.type !== 'body' || ph.idx == null)) byType = sp;
    if (!byType && ph.type === 'ctrTitle' && p.type === 'title') byType = sp;
    if (!byType && ph.type === 'subTitle' && p.type === 'body') byType = sp;
  }
  return byType;
}

// ---- text -------------------------------------------------------------------------------------------------------------
function listStyleLevel(lst, lvl) {
  const el = lst && kid(lst, 'lvl' + (lvl + 1) + 'pPr');
  return el || null;
}
function defRPr(pPr) { return pPr ? kid(pPr, 'defRPr') : null; }

function textStyleFor(ctx, ph, lvl) {
  // master text styles: title / body / other
  const styles = ctx.master && all(ctx.master.doc, 'txStyles')[0];
  const group = !ph ? 'otherStyle' : (/title/i.test(ph.type) ? 'titleStyle' : (ph.type === 'body' || ph.type === 'subTitle' || ph.type === 'obj' ? 'bodyStyle' : 'otherStyle'));
  const g = styles && kid(styles, group);
  return g ? listStyleLevel(g, lvl) : null;
}

function resolveSize(ctx, chain, lvl, ph, run) {
  const runSz = run && aattr(run, 'sz');
  if (runSz) return +runSz;
  for (const lst of chain) {
    const sz = defRPr(listStyleLevel(lst, lvl));
    if (sz && sz.getAttribute('sz')) return +sz.getAttribute('sz');
  }
  const m = defRPr(textStyleFor(ctx, ph, lvl));
  if (m && m.getAttribute('sz')) return +m.getAttribute('sz');
  return 1800;
}

function buildText(txBody, host, ctx, model, opts) {
  const { ph, chain, fontScale } = opts;
  const bodyPr = kid(txBody, 'bodyPr');
  const box = document.createElement('div');
  box.className = 'od-ptext';
  const anchor = bodyPr && bodyPr.getAttribute('anchor');
  box.style.justifyContent = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
  const pad = (name, d) => (bodyPr && bodyPr.getAttribute(name) != null ? emu(bodyPr.getAttribute(name)) : d);
  box.style.padding = [pad('tIns', 4.8), pad('rIns', 9.6), pad('bIns', 4.8), pad('lIns', 9.6)].map((v) => v.toFixed(1) + 'px').join(' ');
  if (bodyPr && bodyPr.getAttribute('wrap') === 'none') box.style.whiteSpace = 'nowrap';
  const counters = [];
  const defaultBullets = !!ph && !/title|ctrTitle|subTitle|dt|ftr|sldNum/i.test(ph.type);
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = pPr && pPr.getAttribute('lvl') ? +pPr.getAttribute('lvl') : 0;
    const line = document.createElement('div');
    line.className = 'od-pp';
    const lvlProps = [pPr, ...chain.map((l) => listStyleLevel(l, lvl)), textStyleFor(ctx, ph, lvl)].filter(Boolean);
    const prop = (name) => { for (const e of lvlProps) { const v = e.getAttribute(name); if (v != null) return v; } return null; };
    const algn = prop('algn');
    line.style.textAlign = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';
    const marL = prop('marL'), indent = prop('indent');
    const left = marL != null ? emu(marL) : (defaultBullets ? lvl * 28.8 + 28.8 : 0);
    const ind = indent != null ? emu(indent) : (defaultBullets ? -28.8 : 0);
    line.style.paddingLeft = Math.max(0, left).toFixed(1) + 'px';
    line.style.textIndent = ind.toFixed(1) + 'px';
    const spc = pPr && kid(pPr, 'spcBef') ? kid(kid(pPr, 'spcBef'), 'spcPts') : null;
    if (spc) line.style.marginTop = ((+spc.getAttribute('val') || 0) / 75).toFixed(1) + 'px';
    // bullets
    let bullet = null;
    const bu = (name) => { for (const e of lvlProps) { const k = kid(e, name); if (k) return k; } return null; };
    if (bu('buNone')) bullet = null;
    else if (bu('buAutoNum')) { counters[lvl] = (counters[lvl] || 0) + 1; counters.length = lvl + 1; bullet = counters[lvl] + '.'; }
    else if (bu('buChar')) { const ch = bu('buChar').getAttribute('char'); const font = bu('buFont'); bullet = font && /wingdings|symbol/i.test(font.getAttribute('typeface') || '') ? '•' : (ch || '•'); }
    else if (defaultBullets && lvl >= 0) bullet = '•';
    if (!bullet) { counters.length = Math.min(counters.length, lvl); }
    if (bullet) { const b = document.createElement('span'); b.className = 'od-bu'; b.textContent = bullet; b.setAttribute('aria-hidden', 'true'); line.append(b, document.createTextNode(' ')); }
    let any = false, size = 1800;
    for (const child of kids(p)) {
      if (child.localName === 'r' || child.localName === 'fld') {
        const rPr = kid(child, 'rPr');
        const tEl = kid(child, 't');
        const text = tEl ? tEl.textContent : '';
        if (!text) continue;
        const span = document.createElement('span');
        span.textContent = text;
        const sz = resolveSize(ctx, chain, lvl, ph, rPr);
        size = sz;
        span.style.fontSize = (sz * fontScale / 75).toFixed(2) + 'px';
        const lvlR = lvlProps.map(defRPr).filter(Boolean);
        const flag = (name) => { if (rPr && rPr.getAttribute(name) != null) return rPr.getAttribute(name) === '1'; for (const e of lvlR) if (e.getAttribute(name) != null) return e.getAttribute(name) === '1'; return null; };
        if (flag('b')) span.style.fontWeight = '700';
        if (flag('i')) span.style.fontStyle = 'italic';
        const u = rPr && rPr.getAttribute('u');
        if (u && u !== 'none') span.style.textDecoration = 'underline';
        if (rPr && rPr.getAttribute('strike') && rPr.getAttribute('strike') !== 'noStrike') span.style.textDecoration = (span.style.textDecoration + ' line-through').trim();
        if (rPr && rPr.getAttribute('baseline') && +rPr.getAttribute('baseline') > 0) { span.style.verticalAlign = 'super'; span.style.fontSize = (sz * fontScale / 75 * 0.7).toFixed(2) + 'px'; }
        let col = rPr ? fillOf(rPr, ctx) : null;
        if (!col) for (const e of lvlR) { col = fillOf(e, ctx); if (col) break; }
        if (col && col.color) span.style.color = col.color;
        else if (opts.defaultColor) span.style.color = opts.defaultColor;
        line.append(span);
        any = true;
      } else if (child.localName === 'br') { line.append(document.createElement('br')); any = true; }
    }
    if (!any) { line.style.fontSize = (size * fontScale / 75).toFixed(2) + 'px'; line.append(document.createElement('br')); }
    box.append(line);
  }
  host.append(box);
  return box;
}

// ---- shapes --------------------------------------------------------------------------------------------------------------
const ARROW = {
  rightArrow: '0,30 60,30 60,10 100,50 60,90 60,70 0,70',
  leftArrow: '100,30 40,30 40,10 0,50 40,90 40,70 100,70',
  upArrow: '30,100 30,40 10,40 50,0 90,40 70,40 70,100',
  downArrow: '30,0 70,0 70,60 90,60 50,100 10,60 30,60',
  triangle: '50,0 100,100 0,100',
  rtTriangle: '0,0 100,100 0,100',
  diamond: '50,0 100,50 50,100 0,50',
  hexagon: '25,0 75,0 100,50 75,100 25,100 0,50',
  pentagon: '50,0 100,38 82,100 18,100 0,38',
  parallelogram: '20,0 100,0 80,100 0,100',
  trapezoid: '20,0 80,0 100,100 0,100',
  star5: '50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35',
};

function shapeNode(sp, box, ctx, model, st, kind) {
  const spPr = kid(sp, 'spPr');
  const geom = spPr && kid(spPr, 'prstGeom');
  const prst = geom ? geom.getAttribute('prst') : 'rect';
  const wrap = document.createElement('div');
  wrap.className = 'od-pshape';
  const style = kid(sp, 'style');
  let fill = fillOf(spPr, ctx);
  let line = spPr ? kid(spPr, 'ln') : null;
  let lineFill = line ? fillOf(line, ctx) : null;
  if (!fill && style) { const ref = kid(style, 'fillRef'); if (ref && +ref.getAttribute('idx') > 0) { const c = colorOf(kid(ref), ctx); if (c) fill = { color: c }; } }
  if (!lineFill && style) { const ref = kid(style, 'lnRef'); if (ref && +ref.getAttribute('idx') > 0) { const c = colorOf(kid(ref), ctx); if (c) lineFill = { color: c }; } }
  const lw = line && line.getAttribute('w') ? Math.max(0.5, emu(line.getAttribute('w'))) : (lineFill && lineFill.color ? 1 : 0);
  const polygon = ARROW[prst];
  const known = !geom || ['rect', 'roundRect', 'ellipse', 'line', 'straightConnector1', 'flowChartProcess', 'snip1Rect', 'round1Rect'].includes(prst) || polygon;
  if (polygon) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('od-psvg');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', polygon);
    poly.setAttribute('fill', fill && fill.color ? fill.color : 'none');
    if (lineFill && lineFill.color) { poly.setAttribute('stroke', lineFill.color); poly.setAttribute('stroke-width', String(lw)); poly.setAttribute('vector-effect', 'non-scaling-stroke'); }
    svg.append(poly);
    wrap.append(svg);
  } else {
    if (fill && fill.color) wrap.style.background = fill.color;
    if (lineFill && lineFill.color && lw) wrap.style.border = lw.toFixed(1) + 'px solid ' + lineFill.color;
    if (prst === 'ellipse') wrap.style.borderRadius = '50%';
    else if (prst === 'roundRect' || prst === 'round1Rect') wrap.style.borderRadius = (Math.min(box.w, box.h) * 0.1667).toFixed(1) + 'px';
    if (!known) {
      model.unsupportedNow.shape++;
      wrap.classList.add('od-pdraft');
      wrap.title = t('This shape ({name}) is drawn as a box', { name: prst });
      if (!lineFill) wrap.style.border = '1px dashed currentColor';
    }
  }
  return wrap;
}

function place(el, b) {
  el.style.left = b.x.toFixed(2) + 'px';
  el.style.top = b.y.toFixed(2) + 'px';
  el.style.width = b.w.toFixed(2) + 'px';
  el.style.height = b.h.toFixed(2) + 'px';
  const tf = [];
  if (b.rot) tf.push('rotate(' + b.rot + 'deg)');
  if (b.flipH) tf.push('scaleX(-1)');
  if (b.flipV) tf.push('scaleY(-1)');
  if (tf.length) el.style.transform = tf.join(' ');
}

async function imageUrl(model, path) {
  if (model.images.has(path)) return model.images.get(path);
  if (!model.pkg.has(path) || !imageMime(path) || isUndrawable(path)) { model.images.set(path, null); return null; }
  const parts = await model.pkg.bytes([path]);
  const url = parts[path] ? URL.createObjectURL(new Blob([parts[path]], { type: imageMime(path) })) : null;
  model.images.set(path, url);
  return url;
}

function mapBox(b, tr) {
  return { x: tr.tx + (b.x - tr.cx) * tr.sx, y: tr.ty + (b.y - tr.cy) * tr.sy, w: b.w * tr.sx, h: b.h * tr.sy, rot: b.rot, flipH: b.flipH, flipV: b.flipV };
}

async function drawTree(tree, layer, ctx, model, tr, partOf) {
  for (const node of kids(tree)) {
    const name = node.localName;
    if (name === 'sp') await drawSp(node, layer, ctx, model, tr, partOf);
    else if (name === 'pic') await drawPic(node, layer, ctx, model, tr, partOf);
    else if (name === 'graphicFrame') await drawFrame(node, layer, ctx, model, tr, partOf);
    else if (name === 'cxnSp') drawLine(node, layer, ctx, model, tr);
    else if (name === 'grpSp') {
      const gp = kid(node, 'grpSpPr');
      const x = xfrmOf(gp);
      if (!x) continue;
      const co = x.chOff, ce = x.chExt;
      const cw = ce ? emu(ce.getAttribute('cx')) : x.w, ch = ce ? emu(ce.getAttribute('cy')) : x.h;
      const own = mapBox(x, tr);
      const inner = { cx: co ? emu(co.getAttribute('x')) : x.x, cy: co ? emu(co.getAttribute('y')) : x.y, sx: cw ? (own.w / cw) : tr.sx, sy: ch ? (own.h / ch) : tr.sy, tx: own.x, ty: own.y };
      await drawTree(node, layer, ctx, model, inner, partOf);
    }
  }
}

function resolveBox(sp, ctx, tr) {
  const own = xfrmOf(kid(sp, 'spPr') || kid(sp, 'grpSpPr'));
  if (own) return mapBox(own, tr);
  const ph = placeholderOf(sp);
  if (!ph) return null;
  for (const src of [ctx.layout, ctx.master]) {
    const found = findPlaceholder(src, ph);
    const x = found && xfrmOf(kid(found, 'spPr'));
    if (x) return mapBox(x, { cx: 0, cy: 0, sx: 1, sy: 1, tx: 0, ty: 0 });
  }
  return null;
}

async function drawSp(sp, layer, ctx, model, tr) {
  const box = resolveBox(sp, ctx, tr);
  if (!box) return;
  const ph = placeholderOf(sp);
  if (ph && /^(dt|ftr|sldNum)$/.test(ph.type)) return;
  const el = shapeNode(sp, box, ctx, model);
  place(el, box);
  layer.append(el);
  const tx = kid(sp, 'txBody');
  if (tx) {
    const chain = [kid(tx, 'lstStyle')];
    if (ph) for (const src of [ctx.layout, ctx.master]) { const f = findPlaceholder(src, ph); const l = f && kid(kid(f, 'txBody'), 'lstStyle'); if (l) chain.push(l); }
    const bp = kid(tx, 'bodyPr');
    const af = bp && kid(bp, 'normAutofit');
    const fontScale = af && af.getAttribute('fontScale') ? (+af.getAttribute('fontScale') / 100000) : 1;
    const spPrFill = fillOf(kid(sp, 'spPr'), ctx);
    const defaultColor = spPrFill && spPrFill.color ? readableOn(spPrFill.color) : null;
    buildText(tx, el, ctx, model, { ph, chain, fontScale, defaultColor });
  }
}

async function drawPic(pic, layer, ctx, model, tr, partOf) {
  const box = resolveBox(pic, ctx, tr);
  if (!box) return;
  const blip = all(pic, 'blip')[0];
  const el = document.createElement('div');
  el.className = 'od-ppic';
  place(el, box);
  const media = all(pic, 'videoFile').length || all(pic, 'audioFile').length;
  const rel = blip && partOf.rels[blip.getAttributeNS(NS.r, 'embed')];
  const url = rel && !rel.external ? await imageUrl(model, rel.target) : null;
  if (media) { model.unsupportedNow.media++; el.classList.add('od-pmissing'); el.textContent = t('Video or audio (not played)'); }
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    const cnv = all(pic, 'cNvPr')[0];
    img.alt = (cnv && (cnv.getAttribute('descr') || '')) || '';
    img.decoding = 'async';
    el.append(img);
  } else if (!media) {
    model.unsupportedNow.picture++;
    el.classList.add('od-pmissing');
    el.textContent = rel && rel.external ? t('Picture on the web (not loaded)') : t('Picture not shown');
  }
  layer.append(el);
}

function drawLine(cx, layer, ctx, model, tr) {
  const spPr = kid(cx, 'spPr');
  const x = xfrmOf(spPr);
  if (!x) return;
  const box = mapBox(x, tr);
  const ln = spPr && kid(spPr, 'ln');
  const col = (ln && fillOf(ln, ctx)) || null;
  const style = kid(cx, 'style');
  let color = col && col.color;
  if (!color && style) { const ref = kid(style, 'lnRef'); color = ref ? colorOf(kid(ref), ctx) : null; }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'od-pline');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  l.setAttribute('x1', box.flipH ? '100' : '0'); l.setAttribute('x2', box.flipH ? '0' : '100');
  l.setAttribute('y1', box.flipV ? '100' : '0'); l.setAttribute('y2', box.flipV ? '0' : '100');
  l.setAttribute('stroke', color || '#7f7f7f');
  l.setAttribute('stroke-width', String(Math.max(1, ln && ln.getAttribute('w') ? emu(ln.getAttribute('w')) : 1)));
  l.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(l);
  const el = document.createElement('div');
  el.className = 'od-pshape';
  place(el, { ...box, flipH: false, flipV: false });
  el.append(svg);
  layer.append(el);
}

async function drawFrame(gf, layer, ctx, model, tr) {
  const xf = kid(gf, 'xfrm');
  if (!xf) return;
  const off = kid(xf, 'off'), ext = kid(xf, 'ext');
  if (!off || !ext) return;
  const box = mapBox({ x: emu(off.getAttribute('x')), y: emu(off.getAttribute('y')), w: emu(ext.getAttribute('cx')), h: emu(ext.getAttribute('cy')) }, tr);
  const gd = all(gf, 'graphicData')[0];
  const uri = gd ? gd.getAttribute('uri') || '' : '';
  const tbl = all(gf, 'tbl')[0];
  const el = document.createElement('div');
  place(el, box);
  if (tbl) {
    el.className = 'od-ptable';
    el.append(tableNode(tbl, ctx, model, box));
  } else {
    const kind = /chart/i.test(uri) ? 'chart' : /diagram/i.test(uri) ? 'diagram' : 'object';
    model.unsupportedNow[kind]++;
    el.className = 'od-ppic od-pmissing';
    el.textContent = kind === 'chart' ? t('Chart (not shown)') : kind === 'diagram' ? t('Diagram (not shown)') : t('Embedded object (not shown)');
  }
  layer.append(el);
}

function tableNode(tbl, ctx, model, box) {
  const table = document.createElement('table');
  const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => emu(c.getAttribute('w')));
  const total = cols.reduce((a, b) => a + b, 0) || 1;
  const cg = document.createElement('colgroup');
  for (const w of cols) { const c = document.createElement('col'); c.style.width = ((w / total) * 100).toFixed(2) + '%'; cg.append(c); }
  table.append(cg);
  const rows = kids(tbl, 'tr');
  const heights = rows.map((r) => emu(r.getAttribute('h')));
  const ht = heights.reduce((a, b) => a + b, 0) || 1;
  rows.forEach((tr, i) => {
    const row = document.createElement('tr');
    row.style.height = ((heights[i] / ht) * box.h).toFixed(1) + 'px';
    for (const tc of kids(tr, 'tc')) {
      if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') continue;
      const td = document.createElement('td');
      if (tc.getAttribute('gridSpan')) td.colSpan = +tc.getAttribute('gridSpan');
      if (tc.getAttribute('rowSpan')) td.rowSpan = +tc.getAttribute('rowSpan');
      const pr = kid(tc, 'tcPr');
      const f = fillOf(pr, ctx);
      if (f && f.color) { td.style.background = f.color; td.style.color = readableOn(f.color); }
      const tx = kid(tc, 'txBody');
      if (tx) buildText(tx, td, ctx, model, { ph: null, chain: [], fontScale: 1, defaultColor: f && f.color ? readableOn(f.color) : null });
      row.append(td);
    }
    table.append(row);
  });
  return table;
}

// ---- one slide -------------------------------------------------------------------------------------------------------------
// Draws slide `index` into `host` (an element sized by the caller to model.size). -> { text, notes, unsupported, flags }
export async function renderSlide(model, index, host) {
  const ctx = await slideContext(model, index);
  model.unsupportedNow = { shape: 0, chart: 0, diagram: 0, object: 0, media: 0, picture: 0 };
  host.textContent = '';
  const stage = document.createElement('div');
  stage.className = 'od-pslide';
  stage.style.width = model.size.w + 'px';
  stage.style.height = model.size.h + 'px';
  // background: the slide's, else the layout's, else the master's
  let bg = null;
  for (const src of [ctx.slide, ctx.layout, ctx.master]) {
    const bgPr = src && all(src.doc, 'bg')[0] && all(all(src.doc, 'bg')[0], 'bgPr')[0];
    const f = bgPr && fillOf(bgPr, ctx);
    if (f && f.color) { bg = f.color; break; }
    if (f && f.none) break;
  }
  stage.style.background = bg || '#ffffff';
  const identity = { cx: 0, cy: 0, sx: 1, sy: 1, tx: 0, ty: 0 };
  // The master's and layout's own pictures and decorations (not their empty placeholders) sit under the slide's shapes.
  for (const src of [ctx.master, ctx.layout]) {
    if (!src) continue;
    const tree = all(src.doc, 'spTree')[0];
    if (!tree) continue;
    const layer = document.createElement('div');
    layer.className = 'od-player';
    stage.append(layer);
    const decor = document.createElement('spTree');
    for (const n of kids(tree)) {
      if (n.localName === 'sp' && placeholderOf(n)) continue;
      if (n.localName === 'sp' && !kid(n, 'spPr')) continue;
      decor.append(n.cloneNode(true));
    }
    await drawTree(decor, layer, ctx, model, identity, src);
  }
  const layer = document.createElement('div');
  layer.className = 'od-player';
  stage.append(layer);
  const tree = all(ctx.slide.doc, 'spTree')[0];
  if (tree) await drawTree(tree, layer, ctx, model, identity, ctx.slide);
  host.append(stage);
  const text = slideTextOf(ctx.slide.doc);
  const flags = { animations: all(ctx.slide.doc, 'timing').length > 0, transition: all(ctx.slide.doc, 'transition').length > 0 };
  return { text, notes: ctx.notes ? notesTextOf(ctx.notes.doc) : '', unsupported: model.unsupportedNow, flags, stage };
}

// ---- text of a slide without drawing it (find, copy, the list) ----------------------------------------------------------------
export function slideTextOf(doc) {
  const out = [];
  for (const p of all(doc, 'p')) {
    if (p.namespaceURI !== A) continue;
    const s = all(p, 't').map((x) => x.textContent).join('');
    if (s) out.push(s);
  }
  return out.join('\n');
}
function notesTextOf(doc) {
  const out = [];
  for (const sp of all(doc, 'sp')) {
    const ph = placeholderOf(sp);
    if (!ph || ph.type !== 'body') continue;
    for (const p of all(sp, 'p')) { const s = all(p, 't').map((x) => x.textContent).join(''); if (s) out.push(s); }
  }
  return out.join('\n');
}

// Titles for the thumbnail list: the title placeholder's text, else the first line.
export async function slideTitle(model, index) {
  const slide = await part(model, model.slides[index].path);
  for (const sp of all(slide.doc, 'sp')) {
    const ph = placeholderOf(sp);
    if (ph && /title/i.test(ph.type)) { const s = all(sp, 't').map((x) => x.textContent).join('').trim(); if (s) return s; }
  }
  const text = slideTextOf(slide.doc);
  return text.split('\n')[0] || '';
}
export async function slideText(model, index) {
  const slide = await part(model, model.slides[index].path);
  return slideTextOf(slide.doc);
}
export async function slideNotes(model, index) {
  const ctx = await slideContext(model, index);
  return ctx.notes ? notesTextOf(ctx.notes.doc) : '';
}
