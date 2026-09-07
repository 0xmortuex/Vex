document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement && event.target.hasAttribute('data-image-fallback')) event.target.style.visibility = 'hidden';
}, true);
