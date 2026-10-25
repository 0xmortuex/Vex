// The marks a person puts on a PDF: what they are, how they are kept (with undo and redo), and how they are handed to main to be
// written into a copy. Pure: no page, no DOM; tests/renderer/pdfViewer.test.js drives it.
//
// Everything is in the PDF's own units (PDF user space: origin at the bottom left of the page, 1 unit = 1/72 inch) so a mark does
// not move when the zoom or the rotation of the view changes. See main/pdf-toolkit.js placeMarks for the shape main expects.

export const KINDS = Object.freeze(['highlight', 'underline', 'strike', 'ink', 'text', 'rect', 'ellipse', 'line', 'signature']);
export const LIMITS = Object.freeze({ marks: 400, rects: 400, points: 4000, text: 500 });

export function createMarkStore() {
  let marks = [];
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();
  let seq = 0;
  let revision = 0;      // changes with every edit; a save remembers it to know what is not saved yet
  let savedRevision = 0;

  const emit = (why) => { revision++; for (const fn of listeners) { try { fn(why); } catch (err) { console.error('[PDF viewer] a marks listener failed:', err); } } };
  const run = (command, why) => { command.redo(); undoStack.push(command); if (undoStack.length > 300) undoStack.shift(); redoStack.length = 0; emit(why); };

  return {
    list: () => marks.slice(),
    byPage: (page) => marks.filter((m) => m.page === page),
    get: (id) => marks.find((m) => m.id === id) || null,
    count: () => marks.length,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    add(mark) {
      if (marks.length >= LIMITS.marks) throw new Error('That is the most marks one copy can hold (' + LIMITS.marks + ')');
      const full = { ...mark, id: mark.id || 'm' + (++seq) };
      run({ redo: () => { marks.push(full); }, undo: () => { marks = marks.filter((m) => m !== full); } }, { type: 'add', id: full.id });
      return full;
    },
    // Several marks as one step (a selection that crosses lines).
    addMany(list) {
      if (marks.length + list.length > LIMITS.marks) throw new Error('That is more marks than one copy can hold (' + LIMITS.marks + ')');
      const fulls = list.map((m) => ({ ...m, id: m.id || 'm' + (++seq) }));
      run({ redo: () => { marks.push(...fulls); }, undo: () => { marks = marks.filter((m) => !fulls.includes(m)); } }, { type: 'add', id: fulls[0] && fulls[0].id });
      return fulls;
    },
    remove(id) {
      const target = marks.find((m) => m.id === id);
      if (!target) return null;
      const index = marks.indexOf(target);
      run({ redo: () => { marks = marks.filter((m) => m !== target); }, undo: () => { marks.splice(index, 0, target); } }, { type: 'remove', id });
      return target;
    },
    // patch: the fields to change. One undo step undoes the whole patch.
    update(id, patch) {
      const target = marks.find((m) => m.id === id);
      if (!target) return null;
      const before = {};
      for (const key of Object.keys(patch)) before[key] = target[key];
      run({ redo: () => { Object.assign(target, patch); }, undo: () => { Object.assign(target, before); } }, { type: 'update', id });
      return target;
    },
    // Changes shown while a mark is being dragged, with no undo step of their own (the end of the drag is one `update`).
    preview(id, patch) {
      const target = marks.find((m) => m.id === id);
      if (target) Object.assign(target, patch);
      return target;
    },
    undo() {
      const command = undoStack.pop();
      if (!command) return false;
      command.undo();
      redoStack.push(command);
      emit({ type: 'undo' });
      return true;
    },
    redo() {
      const command = redoStack.pop();
      if (!command) return false;
      command.redo();
      undoStack.push(command);
      emit({ type: 'redo' });
      return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() { marks = []; undoStack.length = 0; redoStack.length = 0; emit({ type: 'clear' }); },
    isDirty: () => revision !== savedRevision,
    markSaved() { savedRevision = revision; },
  };
}

// ---- geometry (PDF units) ---------------------------------------------------

// The box a mark covers: { x, y, w, h } with (x, y) its lower left corner. Text and signature boxes need the frame they were made in.
export function boundsOf(mark) {
  const box = (xs, ys) => { const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  switch (mark.kind) {
    case 'highlight': return box(mark.rects.flatMap((r) => [r.x, r.x + r.w]), mark.rects.flatMap((r) => [r.y, r.y + r.h]));
    case 'underline': case 'strike': return box(mark.lines.flatMap((l) => [l.x1, l.x2]), mark.lines.flatMap((l) => [l.y1, l.y2]));
    case 'ink': return box(mark.points.map((p) => p[0]), mark.points.map((p) => p[1]));
    case 'line': return box([mark.x1, mark.x2], [mark.y1, mark.y2]);
    case 'rect': case 'ellipse': case 'signature': case 'text': return { x: mark.x, y: mark.y, w: mark.w || 0, h: mark.h || 0 };
    default: throw new Error('Unknown mark kind ' + mark.kind);
  }
}

// Distance from a point to a segment.
export function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
}

// Whether a point (PDF units) is on a mark, with `tol` of leeway (PDF units). Lines and strokes by their path, areas by their box.
export function hits(mark, px, py, tol) {
  const inside = (b) => px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
  switch (mark.kind) {
    case 'highlight': return mark.rects.some((r) => inside(r));
    case 'underline': case 'strike': return mark.lines.some((l) => segmentDistance(px, py, l.x1, l.y1, l.x2, l.y2) <= tol + (mark.width || 1));
    case 'ink': { for (let i = 1; i < mark.points.length; i++) if (segmentDistance(px, py, mark.points[i - 1][0], mark.points[i - 1][1], mark.points[i][0], mark.points[i][1]) <= tol + (mark.width || 1.5)) return true; return false; }
    case 'line': return segmentDistance(px, py, mark.x1, mark.y1, mark.x2, mark.y2) <= tol + (mark.width || 1.5);
    case 'rect': case 'ellipse': case 'signature': case 'text': return inside(boundsOf(mark));
    default: return false;
  }
}

// Merges the rectangles of a text selection that sit on one line (the engine gives one per run of text) into one per line.
// rects: [{ x, y, w, h }] in any one coordinate system with y growing downward (a screen); returns the same shape.
export function mergeLineRects(rects) {
  const sorted = rects.filter((r) => r.w > 0.5 && r.h > 0.5).sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const overlap = last ? Math.min(last.y + last.h, r.y + r.h) - Math.max(last.y, r.y) : 0;
    if (last && overlap > Math.min(last.h, r.h) * 0.6 && r.x <= last.x + last.w + Math.max(last.h, r.h) * 0.6) {
      const x2 = Math.max(last.x + last.w, r.x + r.w), y1 = Math.min(last.y, r.y), y2 = Math.max(last.y + last.h, r.y + r.h);
      last.w = x2 - last.x; last.y = y1; last.h = y2 - y1;
    } else out.push({ ...r });
  }
  return out;
}

const round = (n) => Math.round(n * 100) / 100;

// The form main wants (main/pdf-toolkit.js placeMarks) from the marks kept here. Throws a plain sentence for something it cannot hold.
export function toSavePayload(list) {
  return list.map((m, i) => {
    const out = { kind: m.kind, page: m.page, color: m.color };
    if (m.width != null) out.width = round(m.width);
    switch (m.kind) {
      case 'highlight': out.rects = m.rects.map((r) => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) })); break;
      case 'underline': case 'strike': out.lines = m.lines.map((l) => ({ x1: round(l.x1), y1: round(l.y1), x2: round(l.x2), y2: round(l.y2) })); break;
      case 'ink': out.points = m.points.map((p) => [round(p[0]), round(p[1])]); break;
      case 'line': Object.assign(out, { x1: round(m.x1), y1: round(m.y1), x2: round(m.x2), y2: round(m.y2), arrow: !!m.arrow }); break;
      case 'rect': case 'ellipse': Object.assign(out, { x: round(m.x), y: round(m.y), w: round(m.w), h: round(m.h) }); break;
      case 'signature': Object.assign(out, { x: round(m.x), y: round(m.y), w: round(m.w), h: round(m.h), angle: m.angle || 0 }); break;
      case 'text': {
        const text = String(m.text || '').trim();
        if (!text) throw new Error('Mark ' + (i + 1) + ' is a text note with no text');
        if (text.length > LIMITS.text) throw new Error('A text note is at most ' + LIMITS.text + ' letters');
        Object.assign(out, { x: round(m.x), y: round(m.y), size: round(m.size), text, angle: m.angle || 0 });
        if (m.w) out.w = round(m.w);
        break;
      }
      default: throw new Error('Mark ' + (i + 1) + ' is of a kind that cannot be saved');
    }
    return out;
  });
}

// What a form answer from pdf.js's annotation storage comes to, by field name, for main/pdf-toolkit.js fillForm.
// fieldObjects: pdf.getFieldObjects() -> { name: [{ id, type, exportValue?, ... }] }; storage: { id: { value } }.
export function formValuesFrom(fieldObjects, storage) {
  const out = {};
  if (!fieldObjects) return out;
  for (const [name, objs] of Object.entries(fieldObjects)) {
    for (const obj of objs) {
      const entry = storage[obj.id];
      if (!entry || !('value' in entry)) continue;
      const v = entry.value;
      if (obj.type === 'text') { if (typeof v === 'string') out[name] = v; }
      else if (obj.type === 'checkbox') { if (typeof v === 'boolean') out[name] = v; }
      else if (obj.type === 'radiobutton') { if (v === true && obj.exportValue != null) out[name] = String(obj.exportValue); }
      else if (obj.type === 'combobox' || obj.type === 'listbox') {
        const value = Array.isArray(v) ? v[0] : v;
        if (typeof value === 'string' && value !== '') out[name] = value;
      }
    }
  }
  return out;
}
