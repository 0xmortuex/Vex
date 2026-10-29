// When Vex blocks a Google tag script, the page it was meant for gets an inert dataLayer and gtag (2026-10-29).
//
// The ad blocker cancels googletagmanager.com and google-analytics.com. A page that calls dataLayer.push or gtag without checking that the script
// loaded then throws: https://app.3daimtrainer.com/quick-play never advanced past "I want to train for...", because the click handler's
// sendGtmEvent died on "Cannot read properties of undefined (reading 'push')" (found 2026-10-29: defining dataLayer by hand made the same click work).
// uBlock Origin answers these scripts with a neutered copy for the same reason. Chromium refuses to redirect a script to a data: address
// (net::ERR_UNSAFE_REDIRECT, measured), so the request is still cancelled and the stand-in is run in the page that asked: nothing is fetched from
// Google and nothing is sent; dataLayer, gtag and ga only exist and do nothing.
const STUB_SOURCE = '(function(w){w.dataLayer=w.dataLayer||[];'
  + 'w.gtag=w.gtag||function(){w.dataLayer.push(arguments);};'
  + 'w.ga=w.ga||function(){};'
  + 'w.google_tag_manager=w.google_tag_manager||{};})(window);';

// The scripts that make dataLayer / gtag / ga: Google Tag Manager's gtm.js, gtag.js, and Universal Analytics' analytics.js and ga.js.
const TAG_SCRIPTS = [
  /^https:\/\/(?:www\.)?googletagmanager\.com\/(?:gtag\/js|gtm\.js)(?:[?#]|$)/i,
  /^https:\/\/(?:www|ssl)\.google-analytics\.com\/(?:analytics|ga)\.js(?:[?#]|$)/i,
];

function isTagScript(details) {
  return !!details && details.resourceType === 'script' && typeof details.url === 'string' && TAG_SCRIPTS.some(re => re.test(details.url));
}

// Runs the stand-in in the frame that asked for the blocked script (its own, not the page around it). `contentsOf(id)` finds a webContents by id.
// A page that is gone or cannot run it is not an error: the request is blocked either way.
function provide(details, contentsOf) {
  if (!isTagScript(details)) return false;
  try {
    const frame = details.frame && typeof details.frame.executeJavaScript === 'function' ? details.frame : null;
    const contents = frame ? null : contentsOf(details.webContentsId);
    const target = frame || (contents && !contents.isDestroyed() ? contents : null);
    if (!target) return false;
    Promise.resolve(target.executeJavaScript(STUB_SOURCE)).catch((err) => console.warn('[Analytics stub] the page could not take it:', err && err.message));
    return true;
  } catch (err) {
    console.warn('[Analytics stub] could not be given to the page:', err && err.message);
    return false;
  }
}

module.exports = { isTagScript, provide, STUB_SOURCE, TAG_SCRIPTS };
