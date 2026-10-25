// The arithmetic of the viewer, apart from the page so it can be tested: sizes, zoom and pan.
// "Effective" size = the picture's size as it is SHOWN, after a quarter turn swaps its sides.

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const clampZoom = (zoom) => clamp(zoom, MIN_ZOOM, MAX_ZOOM);

export function effective(width, height, turn) {
  return Math.round(turn / 90) % 2 ? { w: height, h: width } : { w: width, h: height };
}

// Fit never enlarges a small picture past its own size (as every browser's picture view).
export function fitZoom(ew, eh, stageW, stageH) {
  if (!(ew > 0 && eh > 0 && stageW > 0 && stageH > 0)) return 1;
  return clampZoom(Math.min(1, stageW / ew, stageH / eh));
}

// Fill covers the whole window; the part that overflows is reached by panning.
export function fillZoom(ew, eh, stageW, stageH) {
  if (!(ew > 0 && eh > 0 && stageW > 0 && stageH > 0)) return 1;
  return clampZoom(Math.max(stageW / ew, stageH / eh));
}

// Pan is the offset of the picture's centre from the window's centre. A picture smaller than the window on an axis stays centred on it.
export function clampPan(pan, ew, eh, zoom, stageW, stageH) {
  const mx = Math.max(0, (ew * zoom - stageW) / 2);
  const my = Math.max(0, (eh * zoom - stageH) / 2);
  return { x: clamp(pan.x, -mx, mx), y: clamp(pan.y, -my, my) };
}

// The pan that keeps the point under (cx, cy) (measured from the window's centre) where it is while the zoom changes.
export function panForZoomAt(pan, oldZoom, newZoom, cx, cy) {
  const k = newZoom / oldZoom;
  return { x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k };
}

// A wheel turn as a factor: smooth for a trackpad's small steps, one notch for a mouse wheel.
export function wheelFactor(event) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
  const delta = clamp(event.deltaY * unit, -240, 240);
  return Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0016));
}

// "150", "150%", " 1.5x " -> 1.5 (a zoom factor), or null when it says nothing usable.
export function parsePercent(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(%|x)?\s*$/i.exec(String(text));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const zoom = m[2] && m[2].toLowerCase() === 'x' ? n : n / 100;
  return clampZoom(zoom);
}

export const formatPercent = (zoom) => (zoom >= 0.995 || zoom < 0.1 ? Math.round(zoom * 100) : Math.round(zoom * 1000) / 10) + '%';

// A rectangle (left, top, width, height) kept inside a picture of w x h, whole pixels, at least 1 x 1.
export function clampRect(rect, w, h) {
  const x = clamp(Math.round(rect.x), 0, Math.max(0, w - 1));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, h - 1));
  return { x, y, w: clamp(Math.round(rect.w), 1, w - x), h: clamp(Math.round(rect.h), 1, h - y) };
}

// The size a resize comes to when one side is typed and the proportions are kept.
export function scaledSide(value, from, to) {
  return Math.max(1, Math.round((value * to) / from));
}
