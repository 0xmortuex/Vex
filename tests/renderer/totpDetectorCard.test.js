// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://shop.example.com/checkout" }
// Found 2026-10-12 by driving the field detector on pages like the ones people
// meet: a card's "Security code" (the CVV) was read as a one-time-code field, so
// on a site with a saved authenticator account the code was typed into the
// payment form, and name="hotpink" matched the loose "otp" pattern. The same
// detector serves the automatic fill and "Fill code from authenticator".
import { describe, it, expect, beforeEach } from 'vitest';
import { TotpAutofill } from '../../src/renderer/js/totp-autofill.js';

function fieldsFor(html) {
  Element.prototype.getBoundingClientRect = function () { return { width: 120, height: 30, top: 0, left: 0, right: 120, bottom: 30 }; };
  document.body.innerHTML = html;
  const D = window.eval('(' + TotpAutofill._detectorSource() + ')()');
  const f = D.fields();
  return { single: f.single.length, boxes: f.boxes.length };
}

describe('the one-time-code field detector', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('still finds a verification-code field and an otp-named field', () => {
    expect(fieldsFor('<form><label for=c>Enter the 6-digit code</label><input id=c name=code></form>').single).toBe(1);
    expect(fieldsFor('<input name="emailOtp">').single).toBe(1);
    expect(fieldsFor('<input name="otp_code">').single).toBe(1);
    expect(fieldsFor('<input autocomplete="one-time-code" name=x>').single).toBe(1);
  });

  it('does not take a card security code (CVV) for a one-time code', () => {
    expect(fieldsFor('<form><label for=c>Security code</label><input id=c name=sc><label>Card number</label><input autocomplete="cc-number"></form>').single).toBe(0);
    expect(fieldsFor('<form><input placeholder="Card security code" name="secCode"></form>').single).toBe(0);
    expect(fieldsFor('<form><label for=c>Security code</label><input id=c name=cvv></form>').single).toBe(0);
  });

  it('does not match "otp" inside another word', () => {
    expect(fieldsFor('<input name="hotpink">').single).toBe(0);
  });
});
