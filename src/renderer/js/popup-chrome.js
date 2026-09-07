document.querySelectorAll('[data-act]').forEach(button => button.addEventListener('click', () => window.popupChrome.action(button.dataset.act)));
window.popupChrome.onUrl(url => { const element = document.getElementById('url'); element.textContent = url; element.title = url; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.popupChrome.action('close'); });
