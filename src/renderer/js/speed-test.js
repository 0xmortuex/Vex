// === Check my connection speed ============================================================================
//
// Ctrl+K "Check my connection speed": one press, one fixed 10 MB download from speed.cloudflare.com (done by main, listed in
// "what left this computer" as "Speed test"), and the time to a neutral host from the same measurement the Device check uses
// (VexDeviceCheck.lowestBaselineMs). Never runs by itself. The result is a plain dialog with Mbps and milliseconds.
const VexSpeedTest = {
  HOST: 'speed.cloudflare.com',
  _busy: false,
  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  // One decimal under 100 Mbps, none above. Pure.
  formatMbps(mbps) {
    if (!Number.isFinite(mbps) || mbps < 0) throw new Error('The speed is not a number');
    return mbps >= 100 ? String(Math.round(mbps)) : mbps.toFixed(1);
  },
  // What the speed is good for, in one sentence. Pure.
  describe(mbps) {
    if (!Number.isFinite(mbps)) throw new Error('The speed is not a number');
    if (mbps < 3) return this._t('Slow: web pages will load, video will struggle.');
    if (mbps < 10) return this._t('Fine for browsing and standard-definition video.');
    if (mbps < 25) return this._t('Good for HD video and video calls.');
    return this._t('Fast: 4K video and large downloads are fine.');
  },
  // The text of the result. latencyMs may be null (the neutral hosts did not answer). Pure.
  summary(mbps, latencyMs) {
    const lines = [
      this._t('Download speed: {1} Mbps').replace('{1}', this.formatMbps(mbps)),
      Number.isFinite(latencyMs) ? this._t('Latency: {1} ms').replace('{1}', String(Math.round(latencyMs))) : this._t('Latency: no answer'),
      this.describe(mbps),
    ];
    return lines.join('\n');
  },

  async run() {
    if (this._busy) { window.showToast?.(this._t('The speed test is already running')); return null; }
    if (!window.vex || typeof window.vex.speedTestRun !== 'function' || typeof window.vex.netLatency !== 'function') throw new Error('The speed test is not available in this window');
    this._busy = true;
    try {
      window.showToast?.(this._t('Measuring your connection…'));
      if (typeof VexDeviceCheck === 'undefined' && typeof VexLazy !== 'undefined') await VexLazy.ensure('js/device-check.js');
      if (typeof VexDeviceCheck === 'undefined') throw new Error('The connection check is not available in this window');
      const lat = await window.vex.netLatency();
      const latencyMs = VexDeviceCheck.lowestBaselineMs(lat);
      const r = await window.vex.speedTestRun();
      if (!r || !r.ok) throw new Error((r && r.error) || 'The speed test failed');
      const text = this.summary(r.mbps, latencyMs);
      if (typeof window.vexAlert === 'function') {
        await window.vexAlert({ title: this._t('Connection speed'), message: text + '\n\n' + this._t('Tested with a 10 MB file from speed.cloudflare.com. It is listed in "what left this computer" as Speed test.') });
      } else window.showToast?.(text.replace(/\n/g, ' '));
      return { mbps: r.mbps, latencyMs };
    } finally { this._busy = false; }
  },
};

if (typeof window !== 'undefined') {
  window.VexSpeedTest = VexSpeedTest;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'speed-test', label: 'Check My Connection Speed', hint: 'Downloads 10 MB once from speed.cloudflare.com and shows your speed and latency', icon: 'activity', action: async () => { try { await VexSpeedTest.run(); } catch (err) { window.VexProblems?.note('Speed test', 'the speed test failed', err); window.showToast?.(err.message, 'error'); } } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSpeedTest };
