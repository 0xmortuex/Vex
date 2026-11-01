// @vitest-environment jsdom
//
// Turkish for the job picker ("A Vex built for your work": js/job-setup.js, opened from the setup wizard's "Choose my job" and from
// Settings). Owner report 2026-11-01: the whole dialog was English in the Turkish interface. Two causes, both covered here:
//   - the dialog's container had no role, so the translation observer's scopes (js/i18n-ui.js SCOPES) never reached it;
//   - nothing held Turkish for the ~420 professions, the categories or the tools, so a scope would not have helped.
// The Turkish is js/job-picker-tr.js (loaded when the picker opens). The same rule as tests/renderer/setupTourLocale.test.js:
// every English text the picker can draw has a Turkish entry, and a new profession or tool with none fails here.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = path.join(__dirname, '..', '..', 'src', 'renderer', 'js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { VexJobPickerTr } = require('../../src/renderer/js/job-picker-tr.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons;
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const PACKS = ['text', 'dev-data-web', 'money-date-health', 'units-math-science']
  .map(p => require(`../../src/renderer/js/toolbox-pack-${p}.js`));
ToolboxPacks.specs = [];
for (const pack of PACKS) ToolboxPacks.add(pack);
// These two register themselves (js/toolbox.js loads them with the other packs).
require('../../src/renderer/js/toolbox-pack-encoding-net-css.js');
require('../../src/renderer/js/toolbox-pack-formats-text.js');
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
globalThis.Toolbox = Toolbox;
const { JobProfiles } = require('../../src/renderer/js/job-profiles.js');
globalThis.JobProfiles = JobProfiles;
const { JobSetup } = require('../../src/renderer/js/job-setup.js');

// Words that read the same in Turkish.
const SAME = new Set(['Barista', 'DJ', 'Pilot', 'Diplomat', 'Sommelier', 'Scrum Master', 'YouTuber', 'Optometrist', 'Base64', 'Cron', 'UUID', 'ROT13', 'Base32',
  'CRC-32', 'Adler-32', 'Pig Latin', 'Lorem Ipsum', 'Punycode / IDN', 'px / rem / em', 'umask', '.gitignore', 'Slug', 'JSON → YAML', 'YAML → JSON',
  'JSON → TypeScript', 'CSV → JSON', 'JSON → CSV', 'TSV ⇄ CSV', 'CSV → SQL INSERT', 'XML → JSON', 'JSON → XML', '.env ⇄ JSON', 'cURL → fetch()', 'User-Agent']);

const tr = (s) => VexI18nUI.lookup(s, 'tr');

describe('the Turkish table of the job picker', () => {
  it('has a Turkish name for every profession and every category', () => {
    const jobs = JobProfiles.list();
    expect(jobs.length).toBeGreaterThan(400);
    const names = [...new Set(jobs.map(j => j.name))];
    const noJob = names.filter(n => !VexJobPickerTr.jobs[n]);
    expect(noJob, 'Add these to VexJobPickerTr.jobs in js/job-picker-tr.js:\n' + noJob.join('\n')).toEqual([]);
    const noCat = JobProfiles.CATEGORIES.filter(c => !VexJobPickerTr.cats[c]);
    expect(noCat, 'Add these to VexJobPickerTr.cats in js/job-picker-tr.js:\n' + noCat.join('\n')).toEqual([]);
    const same = names.filter(n => VexJobPickerTr.jobs[n] === n && !SAME.has(n));
    expect(same, 'These professions were left in English:\n' + same.join('\n')).toEqual([]);
  });

  it('holds no Turkish for a profession that no longer exists (a stale entry is a typo)', () => {
    const names = new Set(JobProfiles.list().map(j => j.name));
    expect(Object.keys(VexJobPickerTr.jobs).filter(k => !names.has(k))).toEqual([]);
  });

  it('has Turkish for every Toolbox tool the picker lists: name, description and family', () => {
    VexJobPickerTr.table && Object.assign(VexI18nUI.TABLE.tr, VexJobPickerTr.table);
    const all = Toolbox.all();
    expect(all.length).toBeGreaterThan(300);
    const bad = new Set();
    for (const t of all) {
      if (!tr(t.name) && !SAME.has(t.name)) bad.add('name: ' + t.name);
      if (t.desc && !tr(t.desc)) bad.add('desc: ' + t.desc);
    }
    for (const f of Object.values(ToolboxPacks.FAMILIES)) if (!tr(f.label)) bad.add('family: ' + f.label);
    expect([...bad], 'Add these to VexJobPickerTr.table in js/job-picker-tr.js:\n' + [...bad].join('\n')).toEqual([]);
  });

  it('has Turkish for every sentence job-setup.js and the job strip draw through _L()', () => {
    Object.assign(VexI18nUI.TABLE.tr, VexJobPickerTr.table);
    const src = fs.readFileSync(path.join(JS, 'job-setup.js'), 'utf8');
    const used = [...src.matchAll(/this\._L\(\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'"));
    expect(used.length).toBeGreaterThan(10);
    const bad = [...new Set(used)].filter(s => !tr(s));
    expect(bad, 'Add these to VexJobPickerTr.table:\n' + bad.join('\n')).toEqual([]);
  });
});

describe('searching the professions', () => {
  beforeEach(() => { localStorage.setItem('vex.lang', JSON.stringify('tr')); });
  const find = (q) => JobProfiles.list().filter(j => JobSetup._jobMatches(j, q)).map(j => j.id);

  it('finds a profession by its English name and by its Turkish name, with or without Turkish letters', () => {
    expect(find('software')).toContain('software-dev');
    expect(find('yazilim')).toContain('software-dev');
    expect(find('Yazılım')).toContain('software-dev');
    expect(find('YAZILIM geliştirici')).toContain('software-dev');
    expect(find('hemsire')).toContain(JobProfiles.list().find(j => j.name === 'Nurse').id);
    expect(find('Veri Analisti')).toContain('data-analyst');
  });

  it('finds the members of a category by the Turkish category name (Sağlık, saglik)', () => {
    const health = JobProfiles.list().filter(j => j.cat === 'Health').map(j => j.id);
    expect(health.length).toBeGreaterThan(10);
    for (const q of ['sağlık', 'saglik', 'SAĞLIK', 'health']) {
      const hit = find(q);
      for (const id of health) expect(hit, q + ' should find ' + id).toContain(id);
    }
  });

  it('finds nothing for a word that is in no profession', () => {
    expect(find('zzzqqq')).toEqual([]);
  });
});

describe('the dialog in a Turkish Vex', () => {
  const flush = () => new Promise(r => setTimeout(r, 0));
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    document.body.innerHTML = '';
    // Stand in for VexLazy: the late file is the one in the source tree. Start as a Vex that has not loaded it.
    delete globalThis.VexJobPickerTr;
    delete require.cache[require.resolve('../../src/renderer/js/job-picker-tr.js')];
    globalThis.VexLazy = { ensure: async (src) => { expect(src).toBe('js/job-picker-tr.js'); require('../../src/renderer/js/job-picker-tr.js'); return true; } };
  });

  it('loads the Turkish file when it opens, and draws the title, intro, search box, categories and professions in Turkish', async () => {
    expect(JobSetup.needsTr()).toBe(true);
    JobSetup.open();
    await flush(); await flush();
    const dlg = document.getElementById('vex-jobsetup');
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(JobSetup.needsTr()).toBe(false);
    const text = dlg.textContent;
    expect(text).toContain('İşinize göre kurulan bir Vex');
    expect(text).toContain('Mesleğinizi seçin');
    expect(dlg.querySelector('#jsx-search').placeholder).toBe('Meslek ara…');
    expect(text).toContain('Teknoloji');
    expect(text).toContain('Yazılım Geliştirici');
    expect(text).toContain('Veri Analisti');
    expect(text).toContain('Açık Kaynak Proje Sorumlusu');
    expect(text).not.toContain('Software Developer');
    expect(text).not.toContain('Pick your profession');
  });

  it('searching "yazilim" in the open dialog narrows the list to the matching professions', async () => {
    JobSetup.open();
    await flush(); await flush();
    const search = document.querySelector('#jsx-search');
    search.value = 'yazilim';
    search.dispatchEvent(new Event('input'));
    const shown = [...document.querySelectorAll('.jsx-job')].map(b => b.textContent);
    expect(shown).toContain('Yazılım Geliştirici');
    expect(shown).not.toContain('Hemşire');
    expect(document.querySelector('#jsx-search').value).toBe('yazilim');
  });

  it('the screen after a profession is chosen (theme, tools, buttons) is in Turkish too', async () => {
    JobSetup.open();
    await flush(); await flush();
    document.querySelector('.jsx-job[data-id="software-dev"]').click();
    const dlg = document.getElementById('vex-jobsetup');
    const text = dlg.textContent;
    expect(text).toContain('← Tüm meslekler');
    expect(text).toContain('Yazılım Geliştirici');
    expect(text).toContain('Tema:');
    expect(text).toContain('için önerilenler açık');
    expect(text).toContain('Uygula');
    expect(text).toContain('Düzenli İfade (Regex) Test Aracı');
    expect(text).toContain('önerilen');
    expect(dlg.querySelector('#jsx-tool-search').placeholder).toMatch(/^Araç ekleyin: \d+ araç içinde arayın…$/);
    // an English tool name from the same screen would mean a tool escaped the table
    expect(text).not.toContain('Regex Tester');
    // searching for a tool in Turkish
    const q = dlg.querySelector('#jsx-tool-search');
    q.value = 'kelime sayacı';
    q.dispatchEvent(new Event('input'));
    expect(dlg.querySelector('#jsx-tool-results').textContent).toContain('Kelime Sayacı');
    q.value = 'zzzqqq';
    q.dispatchEvent(new Event('input'));
    expect(dlg.querySelector('#jsx-tool-results').textContent).toBe('Eşleşen araç yok.');
  });

  it('stays English, and loads nothing, in an English Vex', async () => {
    localStorage.setItem('vex.lang', JSON.stringify('en'));
    let asked = 0;
    globalThis.VexLazy = { ensure: async () => { asked++; } };
    expect(JobSetup.needsTr()).toBe(false);
    JobSetup.open();
    await flush();
    expect(asked).toBe(0);
    expect(document.getElementById('vex-jobsetup').textContent).toContain('Software Developer');
  });
});

describe('the dialog is inside a scope of the translation observer', () => {
  it('its container is a role="dialog", which VexI18nUI.SCOPES covers', () => {
    expect(VexI18nUI.SCOPES).toContain('[role="dialog"]');
    const src = fs.readFileSync(path.join(JS, 'job-setup.js'), 'utf8');
    expect(src).toMatch(/m\.setAttribute\('role', 'dialog'\)/);
  });
});
