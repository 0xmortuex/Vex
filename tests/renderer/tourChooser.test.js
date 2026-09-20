// @vitest-environment jsdom
//
// "Take a tour" now asks which tour, and the full one asks which areas first.
// What matters: the chooser really offers both, the area picker is built from
// the live feature catalogue (so a feature added there is toured without being
// listed twice), and a tour of nothing never starts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { VexTour } = require('../../src/renderer/js/tour.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-command"></button>';
  globalThis.VexFeatures = VexFeatures;
  globalThis.VexTour = VexTour;
  VexTour.end();
  VexTour._closePick();
  // jsdom gives every element a zero-sized rect; the tour drops a step whose
  // target it cannot see, so give the ones that exist a size.
  Element.prototype.getBoundingClientRect = function () { return { left: 10, top: 10, width: 40, height: 30, right: 50, bottom: 40 }; };
});

const pick = () => document.querySelector('.vex-tour-pick');

describe('which tour?', () => {
  it('offers the quick one and the full one', () => {
    VexTour.offer();
    expect(pick()).toBeTruthy();
    expect(pick().querySelector('[data-pick="quick"]')).toBeTruthy();
    expect(pick().querySelector('[data-pick="full"]')).toBeTruthy();
  });

  it('the quick one is the built-in walkthrough', () => {
    const run = vi.spyOn(VexTour, 'run').mockReturnValue(3);
    VexTour.offer();
    pick().querySelector('[data-pick="quick"]').click();
    expect(pick()).toBeNull();
    expect(run).toHaveBeenCalledWith(VexTour.steps, { markSeen: true });
    run.mockRestore();
  });

  it('“Not now” from an offer Vex made itself is not asked again', () => {
    VexTour.offer({ markSeen: true });
    pick().querySelector('[data-cancel]').click();
    expect(localStorage.getItem('vex.tourSeen')).toBe('1');
  });

  it('“Not now” from a tour the user asked for leaves no mark', () => {
    VexTour.offer();
    pick().querySelector('[data-cancel]').click();
    expect(localStorage.getItem('vex.tourSeen')).toBeNull();
  });
});

describe('which areas?', () => {
  it('lists every catalogue category, with how many features are in it', () => {
    VexTour.offer();
    pick().querySelector('[data-pick="full"]').click();
    const boxes = [...pick().querySelectorAll('.vex-tour-areas input')];
    expect(boxes.map(b => b.value)).toEqual(VexFeatures.CATS.map(c => c.id));
    const first = pick().querySelector('.vex-tour-area-n').textContent;
    expect(Number(first)).toBe(VexFeatures.byCat(VexFeatures.CATS[0].id).length);
  });

  it('starts nothing until an area is ticked, and says how long it will be', () => {
    VexTour.offer();
    pick().querySelector('[data-pick="full"]').click();
    const start = pick().querySelector('[data-start]');
    expect(start.disabled).toBe(true);
    const box = pick().querySelector('.vex-tour-areas input[value="tabs"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(start.disabled).toBe(false);
    expect(start.textContent).toMatch(new RegExp(String(VexFeatures.byCat('tabs').length) + ' cards'));
  });

  it('“Everything” ticks the lot', () => {
    VexTour.offer();
    pick().querySelector('[data-pick="full"]').click();
    pick().querySelector('[data-all]').click();
    expect([...pick().querySelectorAll('.vex-tour-areas input')].every(b => b.checked)).toBe(true);
  });

  it('Back returns to the choice', () => {
    VexTour.offer();
    pick().querySelector('[data-pick="full"]').click();
    pick().querySelector('[data-back]').click();
    expect(pick().querySelector('[data-pick="quick"]')).toBeTruthy();
  });

  it('runs the areas that were ticked, and remembers them for next time', () => {
    const full = vi.spyOn(VexTour, 'full').mockReturnValue(9);
    VexTour.offer();
    pick().querySelector('[data-pick="full"]').click();
    for (const id of ['tabs', 'privacy']) {
      const box = pick().querySelector(`.vex-tour-areas input[value="${id}"]`);
      box.checked = true;
      box.dispatchEvent(new Event('change'));
    }
    pick().querySelector('[data-start]').click();
    expect(full).toHaveBeenCalledWith(['tabs', 'privacy']);
    full.mockRestore();

    VexTour.full(['tabs']);
    VexTour.end();
    VexTour.offer();
    pick().querySelector('[data-pick="full"]').click();
    expect(pick().querySelector('.vex-tour-areas input[value="tabs"]').checked).toBe(true);
    expect(pick().querySelector('.vex-tour-areas input[value="privacy"]').checked).toBe(false);
  });
});

describe('the full tour itself', () => {
  it('introduces each area, then walks its features, in catalogue order', () => {
    const steps = VexTour.fullSteps(['privacy', 'tabs']);
    const tabs = VexFeatures.CATS.find(c => c.id === 'tabs');
    expect(steps[0].title).toBe(tabs.name);                       // catalogue order, not click order
    const titles = steps.map(s => s.title);
    for (const f of VexFeatures.byCat('tabs')) expect(titles).toContain(VexFeatures.nameOf(f));
    for (const f of VexFeatures.byCat('privacy')) expect(titles).toContain(VexFeatures.nameOf(f));
    expect(steps[steps.length - 1].title).toBe('That is the tour');
    expect(steps.length).toBe(VexFeatures.byCat('tabs').length + VexFeatures.byCat('privacy').length + 3);
  });

  it('points at a control only when it is really on screen', () => {
    const steps = VexTour.fullSteps(['tabs']);
    // #tabs-list is not in this document; #btn-command is.
    const withSel = steps.filter(s => s.sel);
    expect(withSel.length).toBeGreaterThan(0);
    expect(withSel.every(s => document.querySelector(s.sel))).toBe(true);
  });

  it('a step Vex cannot show is still a card, never a dropped feature', () => {
    const steps = VexTour.fullSteps(['tabs']);
    expect(VexTour.run(steps, { markSeen: false })).toBe(steps.length);
    VexTour.end();
  });

  it('no areas means no tour', () => {
    expect(VexTour.fullSteps([])).toEqual([]);
    expect(VexTour.full([])).toBe(0);
  });
});
