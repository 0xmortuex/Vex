// @vitest-environment jsdom
//
// The Job Profiles catalogue: hundreds of professions, each with a real theme
// and a short list of tools that exist in the Toolbox (hand-built tools plus
// every pack). Saved `vex.job` ids must keep working, so the original ids —
// and their name, category and theme — are pinned here.

import { describe, it, expect } from 'vitest';

// renderButtons draws its icons with VexIcons, so the top-bar tests below need
// the icon set present.
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons;
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
// Under jsdom a pack registers itself on window.ToolboxPacks when first
// required, so load them all, then reset and register each exactly once.
const PACKS = ['text', 'dev-data-web', 'money-date-health', 'units-math-science']
  .map(p => require(`../../src/renderer/js/toolbox-pack-${p}.js`));
ToolboxPacks.specs = [];
for (const pack of PACKS) ToolboxPacks.add(pack);
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
const { JobProfiles } = require('../../src/renderer/js/job-profiles.js');

const THEMES = ['oxford', 'default', 'midnight', 'forest', 'ocean', 'dracula', 'nord', 'catppuccin', 'sunset', 'rose',
  'matrix', 'mocha', 'solarized', 'vaporwave', 'aurora', 'crimson', 'gold', 'sakura', 'cyberpunk', 'monochrome',
  'slate', 'emerald', 'amethyst', 'volcano', 'sapphire', 'honey', 'mint', 'obsidian', 'ruby', 'lime', 'bronze',
  'plum', 'arctic', 'wine'];

// The catalogue as it shipped before the expansion: id -> [name, cat, theme].
const ORIGINAL = {
  'software-dev': ['Software Developer', 'Tech', 'matrix'],
  'web-dev': ['Web Developer', 'Tech', 'cyberpunk'],
  'data-analyst': ['Data Analyst', 'Tech', 'solarized'],
  'devops': ['DevOps Engineer', 'Tech', 'obsidian'],
  'qa': ['QA / Test Engineer', 'Tech', 'slate'],
  'security': ['Cybersecurity Analyst', 'Tech', 'matrix'],
  'gamedev': ['Game Developer', 'Tech', 'amethyst'],
  'mobile-dev': ['Mobile Developer', 'Tech', 'mint'],
  'dba': ['Database Admin', 'Tech', 'sapphire'],
  'ux-designer': ['UX / UI Designer', 'Design', 'rose'],
  'graphic-designer': ['Graphic Designer', 'Design', 'vaporwave'],
  'product-designer': ['Product Designer', 'Design', 'arctic'],
  'writer': ['Writer / Author', 'Writing', 'oxford'],
  'journalist': ['Journalist', 'Writing', 'mocha'],
  'copywriter': ['Copywriter', 'Writing', 'honey'],
  'content': ['Content Creator', 'Writing', 'sunset'],
  'translator': ['Translator', 'Writing', 'nord'],
  'editor': ['Editor', 'Writing', 'bronze'],
  'accountant': ['Accountant', 'Business', 'emerald'],
  'financial-analyst': ['Financial Analyst', 'Business', 'gold'],
  'entrepreneur': ['Entrepreneur / Founder', 'Business', 'crimson'],
  'pm': ['Project Manager', 'Business', 'ocean'],
  'marketer': ['Marketer', 'Business', 'sunset'],
  'sales': ['Sales', 'Business', 'ruby'],
  'data-scientist': ['Data Scientist', 'Science', 'midnight'],
  'mech-eng': ['Mechanical Engineer', 'Science', 'slate'],
  'elec-eng': ['Electrical Engineer', 'Science', 'volcano'],
  'researcher': ['Researcher', 'Science', 'forest'],
  'scientist': ['Scientist', 'Science', 'aurora'],
  'doctor': ['Doctor / Physician', 'Health', 'arctic'],
  'nurse': ['Nurse', 'Health', 'mint'],
  'pharmacist': ['Pharmacist', 'Health', 'emerald'],
  'psychologist': ['Psychologist', 'Health', 'lime'],
  'teacher': ['Teacher', 'Education', 'forest'],
  'professor': ['Professor / Academic', 'Education', 'oxford'],
  'student': ['Student', 'Education', 'catppuccin'],
  'lawyer': ['Lawyer', 'Legal', 'wine'],
  'paralegal': ['Paralegal', 'Legal', 'mocha'],
  'photographer': ['Photographer', 'Creative', 'obsidian'],
  'video-editor': ['Video Editor', 'Creative', 'dracula'],
  'musician': ['Musician / Producer', 'Creative', 'amethyst'],
  'architect': ['Architect', 'Creative', 'slate'],
  'sre': ['Site Reliability Engineer', 'Tech', 'obsidian'],
  'ml-engineer': ['ML Engineer', 'Tech', 'amethyst'],
  'cloud-architect': ['Cloud Architect', 'Tech', 'sapphire'],
  'blockchain-dev': ['Blockchain Developer', 'Tech', 'gold'],
  'api-dev': ['API / Backend Developer', 'Tech', 'emerald'],
  'it-support': ['IT Support', 'Tech', 'slate'],
  'sysadmin': ['Systems Administrator', 'Tech', 'matrix'],
  'motion-designer': ['Motion Designer', 'Design', 'vaporwave'],
  '3d-artist': ['3D Artist', 'Design', 'plum'],
  'technical-writer': ['Technical Writer', 'Writing', 'nord'],
  'blogger': ['Blogger', 'Writing', 'honey'],
  'social-media': ['Social Media Manager', 'Writing', 'sunset'],
  'consultant': ['Consultant', 'Business', 'ocean'],
  'hr': ['HR / People Ops', 'Business', 'rose'],
  'recruiter': ['Recruiter', 'Business', 'mint'],
  'operations': ['Operations Manager', 'Business', 'slate'],
  'statistician': ['Statistician', 'Science', 'solarized'],
  'civil-eng': ['Civil Engineer', 'Science', 'bronze'],
  'dentist': ['Dentist', 'Health', 'arctic'],
  'veterinarian': ['Veterinarian', 'Health', 'forest'],
  'podcaster': ['Podcaster', 'Creative', 'crimson'],
  'streamer': ['Streamer', 'Creative', 'cyberpunk'],
  'general': ['General / Everyday', 'General', 'oxford'],
};

const JOBS = JobProfiles.list();
const TOOL_IDS = new Set(Toolbox.all().map(t => t.id));

describe('Job Profiles catalogue', () => {
  it('loads every Toolbox pack (sanity check for the tool-id assertions)', () => {
    expect(Toolbox.TOOLS.length).toBeGreaterThanOrEqual(15);
    expect(ToolboxPacks.specs.length).toBeGreaterThan(250);
    expect(TOOL_IDS.size).toBe(Toolbox.TOOLS.length + ToolboxPacks.specs.length);
  });

  it('has at least 250 jobs', () => {
    expect(JOBS.length).toBeGreaterThanOrEqual(250);
  });

  it('has unique kebab-case ids and unique names', () => {
    const ids = JOBS.map(j => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const names = JOBS.map(j => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // A saved `vex.job` must keep working: the id, name and theme stay. The
  // category may move to one of the new groups (Mechanical Engineer now sits
  // under Engineering, not Science) — that only changes where it's listed.
  it('keeps every original job id with its name and theme', () => {
    expect(Object.keys(ORIGINAL).length).toBe(65);
    for (const [id, [name, , theme]] of Object.entries(ORIGINAL)) {
      const job = JobProfiles.get(id);
      expect(job, `missing original job "${id}"`).not.toBeNull();
      expect({ id, name: job.name, theme: job.theme }).toEqual({ id, name, theme });
    }
  });

  it('puts every job in a known category and uses every category', () => {
    const cats = JobProfiles.CATEGORIES;
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats[0]).toBe('Tech');
    expect(cats[cats.length - 1]).toBe('General');
    for (const j of JOBS) expect(cats, `${j.id} has unknown category "${j.cat}"`).toContain(j.cat);
    for (const c of cats) expect(JOBS.some(j => j.cat === c), `category "${c}" has no jobs`).toBe(true);
  });

  it('uses only real theme ids, never custom', () => {
    for (const j of JOBS) {
      expect(THEMES, `${j.id} has theme "${j.theme}"`).toContain(j.theme);
      expect(j.theme).not.toBe('custom');
    }
  });

  it('gives every job 5–12 distinct tools that exist in the Toolbox', () => {
    for (const j of JOBS) {
      expect(Array.isArray(j.tools), j.id).toBe(true);
      expect(j.tools.length, `${j.id} tool count`).toBeGreaterThanOrEqual(5);
      expect(j.tools.length, `${j.id} tool count`).toBeLessThanOrEqual(12);
      expect(new Set(j.tools).size, `${j.id} has duplicate tools`).toBe(j.tools.length);
      for (const t of j.tools) expect(TOOL_IDS.has(t), `${j.id} lists unknown tool "${t}"`).toBe(true);
    }
  });
});

// The top bar draws the Toolbox button and the Vex AI button, and nothing else.
// It used to also draw up to three individual tool buttons out there, which is
// what looked wrong: they sat beside the Toolbox icon rendering a typographic
// mark rather than a drawn icon. Every tool belongs inside the Toolbox.
describe('the job buttons in the top bar', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="top-bar-right"><button id="btn-command"></button></div>';
    localStorage.clear();
    window.Toolbox = Toolbox;
  });

  const draw = (jobId) => {
    if (jobId) localStorage.setItem('vex.job', jobId);
    JobProfiles.renderButtons();
    return [...document.querySelectorAll('#top-bar-right .vex-job-btn')];
  };

  it('draws exactly two buttons: the Toolbox and Vex AI', () => {
    const job = JobProfiles.list().find(j => j.tools.length >= 6);
    localStorage.setItem('vex.jobTools', JSON.stringify(job.tools));
    const btns = draw(job.id);
    expect(btns.map(b => b.title)).toEqual(['Toolbox — your job tools', 'Ask Vex AI']);
  });

  it('puts Vex AI immediately after the Toolbox button', () => {
    const job = JobProfiles.list()[0];
    const btns = draw(job.id);
    expect(btns[1].title).toBe('Ask Vex AI');
    expect(btns[0].nextElementSibling).toBe(btns[1]);
  });

  it('draws no per-tool buttons, whatever the job has enabled', () => {
    const job = JobProfiles.list().find(j => j.tools.length >= 6);
    localStorage.setItem('vex.jobTools', JSON.stringify(job.tools));
    const titles = draw(job.id).map(b => b.title);
    const toolNames = job.tools.map(id => (Toolbox.get(id) || {}).name).filter(Boolean);
    for (const name of toolNames) expect(titles, name).not.toContain(name);
  });

  it('gives both buttons a drawn icon, never a typographic mark', () => {
    const btns = draw(JobProfiles.list()[0].id);
    for (const b of btns) {
      expect(b.querySelector('svg'), b.title).toBeTruthy();
      expect(b.textContent.trim(), b.title).toBe('');
    }
  });

  it('draws nothing at all when no job is set', () => {
    expect(draw(null)).toEqual([]);
  });

  it('is idempotent — redrawing does not stack duplicates', () => {
    const id = JobProfiles.list()[0].id;
    draw(id); draw(id); const btns = draw(id);
    expect(btns.length).toBe(2);
  });
});

// v2.31.58 shortened saved tool lists to only the tools with a drawn icon.
// That was reverted, but reverting code does not restore data — anyone who ran
// that version still has the shortened list until this puts it back.
describe('restoring tool lists shortened by v2.31.58', () => {
  const JOB = JobProfiles.list().find(j => j.tools.length >= 6);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('vex.job', JOB.id);
  });

  it('puts back the tools that version removed', () => {
    localStorage.setItem('vex.jobTools', JSON.stringify([JOB.tools[0]]));
    localStorage.setItem('vex.jobToolsIconMigrated', '1');

    expect(JobProfiles.restorePrunedTools()).toBe(true);
    const after = JSON.parse(localStorage.getItem('vex.jobTools'));
    for (const id of JOB.tools) expect(after, id).toContain(id);
  });

  it('keeps a tool added since, rather than overwriting the saved list', () => {
    localStorage.setItem('vex.jobTools', JSON.stringify([JOB.tools[0], 'added-later']));
    localStorage.setItem('vex.jobToolsIconMigrated', '1');

    JobProfiles.restorePrunedTools();
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))).toContain('added-later');
  });

  it('does not duplicate tools that are already there', () => {
    localStorage.setItem('vex.jobTools', JSON.stringify(JOB.tools));
    localStorage.setItem('vex.jobToolsIconMigrated', '1');

    JobProfiles.restorePrunedTools();
    const after = JSON.parse(localStorage.getItem('vex.jobTools'));
    expect(after.length).toBe(new Set(after).size);
  });

  it('runs once and then leaves the saved list alone', () => {
    localStorage.setItem('vex.jobTools', JSON.stringify([JOB.tools[0]]));
    localStorage.setItem('vex.jobToolsIconMigrated', '1');
    JobProfiles.restorePrunedTools();

    localStorage.setItem('vex.jobTools', JSON.stringify(['just-mine']));
    expect(JobProfiles.restorePrunedTools()).toBe(false);
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))).toEqual(['just-mine']);
  });

  it('does nothing for someone who never ran that version', () => {
    localStorage.setItem('vex.jobTools', JSON.stringify(['just-mine']));
    expect(JobProfiles.restorePrunedTools()).toBe(false);
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))).toEqual(['just-mine']);
  });

  it('clears the flag even when no job is set, so it cannot fire later', () => {
    localStorage.removeItem('vex.job');
    localStorage.setItem('vex.jobToolsIconMigrated', '1');
    expect(JobProfiles.restorePrunedTools()).toBe(true);
    expect(localStorage.getItem('vex.jobToolsIconMigrated')).toBe(null);
  });
});
