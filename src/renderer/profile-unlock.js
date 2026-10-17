// The unlock window's page (main/profile-unlock.js). Nothing here leaves the window except
// through window.vexUnlock (preload-profile-unlock.js).
(function () {
  const $ = (id) => document.getElementById(id);
  let mode = 'passphrase';
  function setMode(next) {
    mode = next;
    $('label').textContent = mode === 'recovery' ? 'Recovery code' : 'Passphrase';
    $('intro').textContent = mode === 'recovery'
      ? 'Type the recovery code you were shown when you encrypted the profile. After it opens, set a new passphrase in Settings.'
      : 'Your profile is encrypted. Type your passphrase to open it.';
    $('switch').textContent = mode === 'recovery' ? 'Use the passphrase instead' : 'Use the recovery code instead';
    $('secret').value = '';
    $('secret').focus();
    $('msg').textContent = '';
  }
  $('switch').addEventListener('click', () => setMode(mode === 'recovery' ? 'passphrase' : 'recovery'));
  $('quit').addEventListener('click', () => window.vexUnlock.quit());
  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('go').disabled = true;
    $('msg').textContent = '';
    try {
      const r = await window.vexUnlock.unlock(mode, $('secret').value);
      if (r.ok) { $('msg').style.color = 'inherit'; $('msg').textContent = 'Opening...'; return; }
      $('msg').textContent = r.error || 'That did not work';
      $('secret').select();
    } catch (err) {
      $('msg').textContent = 'Could not unlock: ' + ((err && err.message) || String(err));
    }
    $('go').disabled = false;
  });
  $('secret').focus();
})();
