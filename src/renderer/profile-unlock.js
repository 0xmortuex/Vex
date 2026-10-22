// The unlock window's page (main/profile-unlock.js). Nothing here leaves the window except
// through window.vexUnlock (preload-profile-unlock.js).
(function () {
  const $ = (id) => document.getElementById(id);
  // The language Vex is in comes from the main process in the address (?lang=tr); English is the page as written.
  const TR = {
    'Unlock Vex': 'Vex’in kilidini aç',
    'Your profile is encrypted. Type your passphrase to open it.': 'Profiliniz şifreli. Açmak için parolanızı yazın.',
    'Type the recovery code you were shown when you encrypted the profile. After it opens, set a new passphrase in Settings.': 'Profili şifrelerken size gösterilen kurtarma kodunu yazın. Açıldıktan sonra Ayarlar’dan yeni bir parola belirleyin.',
    'Passphrase': 'Parola', 'Recovery code': 'Kurtarma kodu', 'Unlock': 'Kilidi aç', 'Quit': 'Çık',
    'Use the recovery code instead': 'Bunun yerine kurtarma kodunu kullan', 'Use the passphrase instead': 'Bunun yerine parolayı kullan',
    'Opening...': 'Açılıyor...', 'That did not work': 'Olmadı', 'Could not unlock: ': 'Kilit açılamadı: ',
  };
  const turkish = new URLSearchParams(location.search).get('lang') === 'tr';
  const t = (s) => (turkish && TR[s]) || s;
  if (turkish) {
    document.documentElement.lang = 'tr';
    document.title = t('Unlock Vex');
    $('h1').textContent = t('Unlock Vex');
    $('go').textContent = t('Unlock');
    $('quit').textContent = t('Quit');
  }
  let mode = 'passphrase';
  function setMode(next) {
    mode = next;
    $('label').textContent = t(mode === 'recovery' ? 'Recovery code' : 'Passphrase');
    $('intro').textContent = t(mode === 'recovery'
      ? 'Type the recovery code you were shown when you encrypted the profile. After it opens, set a new passphrase in Settings.'
      : 'Your profile is encrypted. Type your passphrase to open it.');
    $('switch').textContent = t(mode === 'recovery' ? 'Use the passphrase instead' : 'Use the recovery code instead');
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
      if (r.ok) { $('msg').style.color = 'inherit'; $('msg').textContent = t('Opening...'); return; }
      $('msg').textContent = r.error || t('That did not work');
      $('secret').select();
    } catch (err) {
      $('msg').textContent = t('Could not unlock: ') + ((err && err.message) || String(err));
    }
    $('go').disabled = false;
  });
  setMode('passphrase');
})();
