'use strict';
// Where an extension's toolbar popup goes. The popup is its own frameless
// window, so nothing kept it on screen: it was centred on the LEFT edge of the
// clicked button, and a button near the right edge (Dark Reader, opened from
// the extensions menu on a 1920px screen) put most of it past the screen
// (found 2026-11-01). Pure, so the maths is testable without a window.
//
// anchor: the clicked button in screen pixels {left, right, top, bottom};
// size: the popup's content size {w, h}; area: the rectangle the popup must stay
// inside {x, y, width, height} (the Vex window, cut to the screen's work area).
// Returns {x, y, w, h}: centred under the button, flipped above it when there
// is no room below, never outside the area; a popup bigger than the area is
// made smaller than it (its page scrolls).
function placePopup({ anchor, size, area }) {
  const nums = [anchor && anchor.left, anchor && anchor.right, anchor && anchor.top, anchor && anchor.bottom,
    size && size.w, size && size.h, area && area.x, area && area.y, area && area.width, area && area.height];
  if (!nums.every(Number.isFinite)) throw new TypeError('placePopup: anchor, size and area must be made of numbers');
  if (area.width <= 0 || area.height <= 0) throw new RangeError('placePopup: the area has no room');
  const w = Math.max(1, Math.min(Math.round(size.w), area.width));
  const h = Math.max(1, Math.min(Math.round(size.h), area.height));
  const areaRight = area.x + area.width;
  const areaBottom = area.y + area.height;

  const centre = (anchor.left + anchor.right) / 2;
  const x = Math.min(Math.max(Math.round(centre - w / 2), area.x), areaRight - w);

  let y = Math.round(anchor.bottom);
  if (y + h > areaBottom) {
    const above = Math.round(anchor.top) - h;
    // Flip up when it fits above; otherwise sit as low as the area allows.
    y = above >= area.y ? above : areaBottom - h;
  }
  y = Math.min(Math.max(y, area.y), areaBottom - h);
  return { x, y, w, h };
}

// The area a popup may use: the Vex window's content, cut to the work area of
// the screen the button is on. `windowBounds` may be null (no window).
function popupArea(windowBounds, workArea) {
  if (!workArea || !Number.isFinite(workArea.width)) throw new TypeError('popupArea: the screen has no work area');
  if (!windowBounds) return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
  const x = Math.max(windowBounds.x, workArea.x);
  const y = Math.max(windowBounds.y, workArea.y);
  const right = Math.min(windowBounds.x + windowBounds.width, workArea.x + workArea.width);
  const bottom = Math.min(windowBounds.y + windowBounds.height, workArea.y + workArea.height);
  // A window that has left the screen entirely: the screen's own area.
  if (right - x < 25 || bottom - y < 25) return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
  return { x, y, width: right - x, height: bottom - y };
}

module.exports = { placePopup, popupArea };
