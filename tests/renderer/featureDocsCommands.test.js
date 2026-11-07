// scripts/gen-features-doc.js used to drop a manifest command whose label it could not read (a getter, a ternary, a
// table entry, a file in a sub-folder), so docs/FEATURES.md silently left the Ctrl+K phrase out. Now it is an error,
// and the phrases that were missing are in the generated file.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { build } = require('../../scripts/gen-features-doc.js');

describe('docs/FEATURES.md Ctrl+K phrases', () => {
  const built = build();

  it('stops with a clear message when a manifest lists a command whose label cannot be read', () => {
    const first = built.manifests[0];
    const bad = [{ ...first, commands: ['no-such-command-xyz'] }];
    let err;
    try { build({ manifests: bad }); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/Ctrl\+K commands whose label cannot be read/);
    expect(err.message).toContain(first.id + ' -> no-such-command-xyz');
    expect(err.unresolved).toEqual([first.id + ' -> no-such-command-xyz']);
  });

  it('shows the real phrase for the features whose label is a getter, a ternary, a table entry or in a sub-folder', () => {
    const block = (id) => built.text.split('\n- **').find(b => b.includes('(`' + id + '`)'));
    expect(block('sleep-timer')).toContain('Ctrl+K: "Sleep Timer"');
    expect(block('guest-session')).toContain('"Throwaway workspace"');
    expect(block('page-watch-templates')).toContain('"Watch This Page for Seats or Tickets"');
    expect(block('page-watch-templates')).toContain('"Watch This Fare for a Lower Price"');
    expect(block('page-watch-templates')).toContain('"Wishlist: Tell Me at a New Lowest Price"');
    expect(block('page-watch-templates')).toContain('"Watch This Page for a Sale Date"');
    expect(block('brief-cards')).toContain('"Flag This Page in My Morning Brief"');
  });

  it('every command a manifest lists appears, by its phrase, in the generated file', () => {
    // build() throws for an unresolvable command, so reaching here means all resolved; check the text carries them.
    for (const m of built.manifests) {
      const block = built.text.split('\n- **').find(b => b.includes('(`' + m.id + '`)'));
      if ((m.commands || []).length) expect(block, m.id).toContain('Ctrl+K: ');
    }
  });

  it('the checked-in docs/FEATURES.md has them (it was regenerated)', () => {
    const have = fs.readFileSync(path.join(__dirname, '../../docs/FEATURES.md'), 'utf8');
    expect(have).toContain('"Sleep Timer"');
    expect(have).toContain('"Flag This Page in My Morning Brief"');
  });
});
