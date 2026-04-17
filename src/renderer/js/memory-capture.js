// === Vex Phase 17A: Memory Recorder — renderer-side mic capture ===
// Pulls 16 kHz mono WAV chunks out of getUserMedia and ships them to
// the main process every 15s for whisper.cpp transcription.

const MemoryCapture = (() => {
  const CHUNK_MS = 15000;
  let mediaStream = null;
  let audioContext = null;
  let running = false;

  async function start() {
    if (running) return { ok: true, already: true };
    console.log('[MemoryCapture] requesting microphone...');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        }
      });
      const track = mediaStream.getAudioTracks()[0];
      console.log('[MemoryCapture] mic acquired:', track?.label, track?.getSettings?.());
    } catch (err) {
      console.error('[MemoryCapture] getUserMedia failed:', err);
      throw new Error('Microphone access denied. Enable in Windows Settings → Privacy → Microphone.');
    }
    running = true;
    console.log('[MemoryCapture] starting chunk loop (' + CHUNK_MS + 'ms chunks)');
    _recordChunk();
    return { ok: true };
  }

  function stop() {
    running = false;
    if (mediaStream) {
      try { mediaStream.getTracks().forEach(t => t.stop()); } catch {}
      mediaStream = null;
    }
  }

  async function _recordChunk() {
    if (!running || !mediaStream) return;
    try {
      const rec = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          console.log('[MemoryCapture] chunk stopped, blob size:', blob.size, 'parts:', chunks.length);
          const wav = await _webmToWav(blob);
          console.log('[MemoryCapture] wav size:', wav.byteLength);
          if (!wav || wav.byteLength <= 44) {
            console.warn('[MemoryCapture] skip — empty WAV (decode failed?)');
          } else {
            const silent = _isSilent(wav);
            console.log('[MemoryCapture] silent?', silent);
            if (!silent) {
              console.log('[MemoryCapture] sending to main (' + wav.byteLength + ' bytes)...');
              const res = await window.vex.memoryIngestAudio(wav, { capturedAt: new Date().toISOString() });
              console.log('[MemoryCapture] ingest result:', res);
            } else {
              console.log('[MemoryCapture] skip — silent chunk');
            }
          }
        } catch (err) {
          console.warn('[MemoryCapture] chunk failed:', err);
        }
        if (running) _recordChunk();
      };
      rec.start();
      setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch {} }, CHUNK_MS);
    } catch (err) {
      console.error('[MemoryCapture] MediaRecorder failed:', err);
      stop();
    }
  }

  async function _webmToWav(webmBlob) {
    const arrayBuffer = await webmBlob.arrayBuffer();
    if (!audioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try { audioContext = new AC({ sampleRate: 16000 }); }
      catch { audioContext = new AC(); }
    }
    try {
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      return _audioBufferToWav(decoded);
    } catch (err) {
      console.warn('[MemoryCapture] decode failed:', err.message);
      return new ArrayBuffer(0);
    }
  }

  // Resample (if needed) + convert to 16-bit PCM mono WAV
  function _audioBufferToWav(buffer) {
    const targetRate = 16000;
    const numChannels = 1;
    const bitDepth = 16;

    // Downmix to mono
    let samples;
    if (buffer.numberOfChannels === 1) {
      samples = buffer.getChannelData(0);
    } else {
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      samples = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) samples[i] = (left[i] + right[i]) * 0.5;
    }

    // Resample (naive linear) if source isn't 16 kHz
    if (buffer.sampleRate !== targetRate) {
      const ratio = buffer.sampleRate / targetRate;
      const newLen = Math.floor(samples.length / ratio);
      const resampled = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const src = i * ratio;
        const i0 = Math.floor(src);
        const i1 = Math.min(i0 + 1, samples.length - 1);
        const frac = src - i0;
        resampled[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
      }
      samples = resampled;
    }

    const byteRate = targetRate * numChannels * bitDepth / 8;
    const blockAlign = numChannels * bitDepth / 8;
    const dataSize = samples.length * 2;
    const arr = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arr);

    _writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    _writeString(view, 8, 'WAVE');
    _writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);               // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, targetRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    _writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return arr;
  }

  function _writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function _isSilent(wav, threshold = 0.006) {
    if (!wav || wav.byteLength < 48) return true;
    const view = new DataView(wav, 44);
    const sampleCount = (wav.byteLength - 44) / 2;
    const step = Math.max(1, Math.floor(sampleCount / 500));
    let sum = 0, count = 0;
    for (let i = 0; i < sampleCount; i += step) {
      const s = view.getInt16(i * 2, true) / 0x7FFF;
      sum += Math.abs(s); count++;
    }
    return (sum / count) < threshold;
  }

  return { start, stop, isRunning: () => running };
})();

window.MemoryCapture = MemoryCapture;
