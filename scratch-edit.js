const fs = require('fs');
function edit(f, a, b) { let s = fs.readFileSync(f, 'utf8'); if (!s.includes(a)) throw new Error(f + ' missing ' + a.slice(0, 50)); s = s.replace(a, () => b); fs.writeFileSync(f, s); }
edit('src/renderer/js/game-mode.js', ", stillVex: 'vex.game.stillVex', commitGuard: 'vex.game.commitGuard' };", ", stillVex: 'vex.game.stillVex' };");
edit('src/renderer/js/game-mode.js', "    ['commitGuard', 'Protect Windows from running out of memory', 'If Windows has less than about 8 GB of memory left to promise while a game runs, Vex sleeps its own tabs, unloads its AI model and holds its background work, and tells you once. It never touches the game or any other program.'],\n", "");
edit('src/renderer/js/game-session.js', "    host.appendChild(not);\n    if (typeof GameDossier", `    host.appendChild(not);
    // Commit-charge guard (js/commit-guard.js): its own switch, on unless turned off.
    if (typeof CommitGuard !== 'undefined') {
      const grow = add('div', 'setting-toggle-row');
      const glabel = add('span', null, t('Protect Windows from running out of memory'));
      glabel.title = t('If Windows has less than about 8 GB of memory left to promise while a game runs, Vex sleeps its own tabs, unloads its AI model and holds its background work, and tells you once. It never touches the game or any other program.');
      const gsw = document.createElement('label');
      gsw.className = 'toggle';
      gsw.innerHTML = '<input type="checkbox" id="setting-commit-guard" aria-label="Protect Windows from running out of memory"><span class="toggle-slider"></span>';
      const gbox = gsw.querySelector('input');
      gbox.checked = CommitGuard.enabled();
      gbox.addEventListener('change', () => {
        try { CommitGuard.setEnabled(gbox.checked); }
        catch (err) { gbox.checked = !gbox.checked; window.showToast?.(err.message, 'error'); }
      });
      grow.append(glabel, gsw);
      host.appendChild(grow);
    }
    if (typeof GameDossier`);
