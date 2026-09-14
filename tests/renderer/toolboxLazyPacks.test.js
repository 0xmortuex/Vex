// @vitest-environment jsdom
//
// The Toolbox's packs and reference tables (~800 KB) load on first use
// instead of on every launch. Only where scripts are fetched at all: under a
// harness with no <script src="js/toolbox.js"> the Toolbox works with whatever
// packs the test loaded, synchronously, as before.

import { describe, it, expect, beforeEach } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons;
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { Toolbox } = require('../../src/renderer/js/toolbox.js');

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  Toolbox._packsLoaded = false;
  Toolbox._packsLoading = null;
  ToolboxPacks.specs.length = 0;
});

describe('lazy packs', () => {
  it('does not fetch anything under a harness, and reports the packs as absent', async () => {
    expect(Toolbox._canLoadPacks()).toBe(false);
    expect(await Toolbox.ensurePacks()).toBe(false);
    expect(document.querySelectorAll('script').length).toBe(0);
  });

  it('in the real page, fetches the pack scripts once, in order, and not again while loading', () => {
    document.head.innerHTML = '<script src="js/toolbox.js"></script>';
    expect(Toolbox._canLoadPacks()).toBe(true);
    const p1 = Toolbox.ensurePacks();
    const p2 = Toolbox.ensurePacks();
    expect(p2).toBe(p1);
    const added = [...document.querySelectorAll('script')].map(s => s.getAttribute('src')).filter(s => s !== 'js/toolbox.js');
    // Scripts are appended one at a time as each loads; the first is queued at once.
    expect(added).toEqual([Toolbox.PACK_SCRIPTS[0]]);
    expect(Toolbox.PACK_SCRIPTS[0]).toBe('js/toolbox-reference.js');
    expect(Toolbox.PACK_SCRIPTS).toHaveLength(7);
  });

  it('is ready once the last pack script is in the page — a few registered specs prove nothing', async () => {
    document.head.innerHTML = '<script src="js/toolbox.js"></script>';
    // Some specs are registered by scripts that still load at launch.
    ToolboxPacks.specs.push({ id: 'x', name: 'X', family: 'text', fields: [], run: () => '' });
    expect(Toolbox._packsReady()).toBe(false);
    document.head.insertAdjacentHTML('beforeend', `<script src="${Toolbox.PACK_SCRIPTS[Toolbox.PACK_SCRIPTS.length - 1]}"></script>`);
    expect(Toolbox._packsReady()).toBe(true);
    expect(await Toolbox.ensurePacks()).toBe(true);
    expect(document.querySelectorAll('script').length).toBe(2);
  });
});
