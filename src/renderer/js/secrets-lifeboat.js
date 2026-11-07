// === Encrypted secrets file: the window's half ===============================
//
// Saved logins, authenticator codes and (if you tick them) cards live encrypted by
// Windows. A reinstall, a reset profile or a lost Windows key destroys them, and a
// normal backup deliberately holds none. This is the way out: one file sealed with
// a passphrase only you know (src/main/secrets-lifeboat.js does all of it in the
// main process; this window only sees counts, never a secret).
//
//   Export secrets (encrypted)   writes the file, then reads it back and decrypts it in
//                                memory to prove it holds what was exported. Failing that,
//                                the file is deleted and nothing is kept.
//   Check an encrypted file      decrypts a file in memory and compares it with what Vex has.
//   Restore from a file          adds what is missing (nothing already there is overwritten),
//                                after saying what it will do, and after saving an encrypted
//                                safety copy of what is there now.
//   Go back to before…           puts the safety copy back exactly.
//
// The passphrase is typed into a Vex prompt, sent to main for the one call, and not
// kept here, in a setting or in a log. There is no way to recover a forgotten one.
const VexSecretsLifeboat = {
  MIN_PASSPHRASE: 10,

  _api() { return window.vex && window.vex.lifeboat ? window.vex.lifeboat : null; },
  _tr(t) { return window.vexTr ? window.vexTr(t) : t; },

  open() {
    document.getElementById('vex-lifeboat')?.remove();
    const api = this._api();
    const tr = (t) => this._tr(t);
    const m = document.createElement('div');
    m.id = 'vex-lifeboat';
    m.className = 'vexsr-ov';
    m.innerHTML = '<div class="vexsr-card" role="dialog" aria-modal="true" aria-labelledby="lb-title"><div class="vexsr-head">'
      + '<span class="vexsr-title" id="lb-title">Encrypted secrets file</span>'
      + '<button class="vexsr-x" id="lb-close" aria-label="Close" title="Close">' + VexIcons.svg('x', { size: 13 }) + '</button></div>'
      + '<div class="vexsr-sub">Saved logins and authenticator codes are encrypted by Windows. If Windows is reinstalled, the profile is reset or the Windows key is lost, they are gone, and a normal backup does not hold them. This file does: it is sealed with a passphrase only you know. Nobody, including Vex, can open it without that passphrase, and a forgotten passphrase cannot be recovered.</div>'
      + '<div class="vexsr-row" style="margin-top:12px">'
      + '<label class="vexsr-check"><input type="checkbox" id="lb-cards"> Include my saved cards (the number, name and expiry; Vex never kept a security code)</label>'
      + '<button id="lb-export" class="vexsr-go">Export secrets (encrypted)</button>'
      + '</div>'
      + '<div class="vexsr-row" style="margin-top:8px">'
      + '<button id="lb-check" class="vexsr-x">Check an encrypted file</button>'
      + '<button id="lb-restore" class="vexsr-x">Restore from an encrypted file</button>'
      + '<button id="lb-undo" class="vexsr-x">Go back to before the last restore</button>'
      + '</div>'
      + '<div id="lb-report" class="vexsr-list" hidden></div>'
      + '<div id="lb-msg" class="vexsr-msg"></div>'
      + '<div class="vexsr-note">Passkeys: only the list of which accounts have one is saved. A passkey’s private key never leaves Vex, so after a reinstall each account needs a new passkey. The file is never part of a backup or of Vex Sync, and the passphrase is never stored.</div>'
      + '</div>';
    document.body.appendChild(m);

    const msg = (t, bad) => { const e = m.querySelector('#lb-msg'); e.textContent = t ? tr(t) : ''; e.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#lb-close').addEventListener('click', close);
    m.querySelector('#lb-close').focus({ preventScroll: true });

    if (!api) {
      msg('This window cannot reach the secrets file feature', true);
      for (const b of m.querySelectorAll('button.vexsr-go, #lb-check, #lb-restore, #lb-undo')) b.disabled = true;
      return m;
    }

    const report = (rows, notes = []) => {
      const box = m.querySelector('#lb-report');
      box.textContent = '';
      box.hidden = !rows.length && !notes.length;
      for (const [label, value] of rows) {
        const el = document.createElement('div');
        el.className = 'vexsr-rule';
        const a = document.createElement('span'); a.className = 'vexsr-host'; a.textContent = tr(label);
        const b = document.createElement('span'); b.className = 'vexsr-mode'; b.textContent = value;
        el.append(a, b);
        box.appendChild(el);
      }
      for (const n of notes) { const el = document.createElement('div'); el.className = 'vexsr-empty'; el.textContent = tr(n); box.appendChild(el); }
    };
    const countRows = (c) => [
      ['Saved logins', String(c.passwords)],
      ['Authenticator accounts', String(c.authenticator)],
      ['Saved cards', c.cardsIncluded === false ? tr('not included') : String(c.cards)],
      ['Passkeys listed (keys are not exported)', String(c.passkeys)],
    ];
    const busy = async (fn) => {
      const buttons = [...m.querySelectorAll('button')];
      buttons.forEach(b => { b.disabled = true; });
      try { await fn(); } finally { buttons.forEach(b => { b.disabled = false; }); }
    };

    // The passphrase, asked for here and sent for one call. Twice when it is a new one.
    const ask = async (title, message, again) => {
      const first = await window.vexPrompt({ title, message, label: 'Passphrase', password: true, okLabel: again ? 'Next' : 'Continue' });
      if (first == null || first === '') return null;
      if (again) {
        if (first.length < this.MIN_PASSPHRASE) { msg('Use a passphrase of at least 10 characters', true); return null; }
        const second = await window.vexPrompt({ title, message: 'Type the passphrase again.', label: 'Passphrase again', password: true, okLabel: 'Export' });
        if (second == null) return null;
        if (second !== first) { msg('The two passphrases are not the same, so nothing was exported', true); return null; }
      }
      return first;
    };

    m.querySelector('#lb-export').addEventListener('click', () => busy(async () => {
      msg('');
      report([]);
      const pass = await ask('Export secrets (encrypted)', 'Choose a passphrase of at least 10 characters. Without it the file cannot be opened, and Vex cannot recover it for you. Use something you will still know after a reinstall.', true);
      if (!pass) return;
      const r = await api.exportSecrets(pass, m.querySelector('#lb-cards').checked);
      if (r && r.canceled) { msg('Nothing was saved'); return; }
      if (!r || !r.ok) { msg((r && r.error) || 'The export failed', true); return; }
      msg('Saved and verified: Vex read the file back, decrypted it and checked it holds exactly what was exported.');
      report(countRows(r.counts), r.counts.passkeys ? ['Passkeys cannot be exported: after a reinstall, add a new passkey on each of those accounts.'] : []);
    }));

    const pickAndAsk = async (title, message) => {
      const picked = await api.pick();
      if (!picked || picked.canceled) return null;
      if (!picked.ok) { msg(picked.error || 'That file could not be chosen', true); return null; }
      const pass = await ask(title, message, false);
      return pass ? { token: picked.token, pass } : null;
    };

    m.querySelector('#lb-check').addEventListener('click', () => busy(async () => {
      msg('');
      report([]);
      const got = await pickAndAsk('Check an encrypted file', 'The passphrase the file was saved with. The file is opened in memory only; nothing is written or changed.');
      if (!got) return;
      const r = await api.verify(got.token, got.pass);
      if (!r || !r.ok) { msg((r && r.error) || 'The file could not be checked', true); return; }
      msg(tr('The passphrase opens this file.') + ' ' + tr('Saved') + ': ' + new Date(r.createdAt).toLocaleString());
      const rows = countRows(r.counts).map(([l, v]) => [l, v]);
      const live = r.live || {};
      rows.push(['Now in Vex: logins, authenticator accounts, cards, passkeys', [live.passwords, live.authenticator, live.cards, live.passkeys].map(x => (x == null ? '-' : x)).join(' / ')]);
      report(rows);
    }));

    const restoreWith = async (got, replace) => {
      const plan = await api.plan(got.token, got.pass);
      if (!plan || !plan.ok) { msg((plan && plan.error) || 'The file could not be opened', true); return; }
      const rows = [
        ['Logins to add', String(plan.passwords.add)], ['Logins already in Vex (left as they are)', String(plan.passwords.have)],
        ['Authenticator accounts to add', String(plan.authenticator.add)], ['Authenticator accounts already in Vex (left as they are)', String(plan.authenticator.have)],
      ];
      if (plan.cards.included) rows.push(['Cards to add', String(plan.cards.add)], ['Cards already in Vex (left as they are)', String(plan.cards.have)]);
      report(rows, [].concat(
        plan.unreadable.length ? ['Part of what Vex has now cannot be read by Windows any more. It is set aside under another name, not deleted, and replaced.'] : [],
        plan.passkeys.length ? ['Passkeys cannot be restored: add a new passkey on each of those accounts.'] : []));
      const ok = await window.vexConfirm({
        title: replace ? 'Go back to before the last restore?' : 'Restore these secrets?',
        message: tr(replace ? 'Your saved logins, authenticator accounts and cards become exactly what the safety copy holds.' : 'What is missing is added to Vex. Nothing that is already there is changed. Before anything is added, Vex saves an encrypted safety copy of what you have now, in the backups folder, so you can come back to it.'),
        okLabel: replace ? 'Go back' : 'Restore', cancelLabel: 'Cancel', danger: true,
      });
      if (!ok) { msg('Nothing was changed'); return; }
      const r = await api.restore(got.token, got.pass, true, replace);
      if (!r || !r.ok) { msg((r && r.error) || 'The restore failed', true); return; }
      const done = [
        ['Logins added', String(r.restored.passwords)], ['Authenticator accounts added', String(r.restored.authenticator)],
      ];
      if (plan.cards.included) done.push(['Cards added', String(r.restored.cards)]);
      if (r.before) done.push(['Safety copy of what you had', r.before.name]);
      for (const name of r.setAside) done.push(['Set aside (unreadable)', name]);
      report(done, r.failed.length ? [tr('Part of the restore failed:') + ' ' + r.failed.join('; ')] : []);
      msg(r.failed.length ? 'Part of the restore did not work. Nothing was deleted.' : 'Restored.', r.failed.length > 0);
    };

    m.querySelector('#lb-restore').addEventListener('click', () => busy(async () => {
      msg('');
      report([]);
      const got = await pickAndAsk('Restore from an encrypted file', 'The passphrase the file was saved with. Nothing changes until you have seen what it would do and said yes.');
      if (got) { try { await restoreWith(got, false); } finally { got.pass = null; } }
    }));
    m.querySelector('#lb-undo').addEventListener('click', () => busy(async () => {
      msg('');
      report([]);
      const last = await api.pickLast();
      if (!last || !last.ok) { msg((last && last.error) || 'There is no safety copy from an earlier restore', true); return; }
      const pass = await ask('Go back to before the last restore', 'The passphrase you used for that restore.', false);
      if (pass) { const g = { token: last.token, pass }; try { await restoreWith(g, true); } finally { g.pass = null; } }
    }));
    return m;
  },
};

if (typeof window !== 'undefined') window.VexSecretsLifeboat = VexSecretsLifeboat;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSecretsLifeboat };
