package com.vex.browser.localai;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaRecorder;
import android.net.Uri;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Sound for a model that can hear: 16 kHz, mono, 16-bit PCM in a WAV wrapper,
 * at most thirty seconds — what Gemma's audio encoder takes, and what the
 * Gallery hands it.
 *
 * Two ways in. Recording reads the microphone straight into that format. A
 * file from the phone can be anything Android can decode (m4a, mp3, ogg, wav),
 * so it is decoded, mixed down to one channel and resampled here, natively: a
 * minute of audio is megabytes, and the chrome has no reason to hold it.
 */
public class AudioClips {

    public static final int RATE = 16000;
    public static final int MAX_SECONDS = 30;

    public interface Level {
        void onLevel(int percent, int seconds);
    }

    private volatile boolean recording;
    private byte[] last;

    public boolean isRecording() { return recording; }

    /** The clip waiting to be asked about, as WAV bytes; null when there is none. */
    public synchronized byte[] last() { return last; }

    public synchronized void clear() { last = null; }

    public synchronized long lastMillis() {
        return last == null ? 0 : (long) (last.length - 44) * 1000 / (RATE * 2);
    }

    private synchronized void keep(byte[] pcm) {
        last = pcm == null || pcm.length == 0 ? null : wav(pcm);
    }

    /**
     * Record until stop() or thirty seconds, whichever comes first. Blocks the
     * calling thread, so call it from a worker.
     */
    @SuppressWarnings("MissingPermission")
    public void record(Level level) throws Exception {
        int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) throw new IllegalStateException("This phone will not record at 16 kHz");
        AudioRecord recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, RATE));
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            throw new IllegalStateException("The microphone is not available");
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(RATE * 2 * 8);
        byte[] buffer = new byte[RATE / 5 * 2];      // a fifth of a second
        long limit = (long) RATE * 2 * MAX_SECONDS;
        recording = true;
        try {
            recorder.startRecording();
            while (recording && out.size() < limit) {
                int read = recorder.read(buffer, 0, buffer.length);
                if (read <= 0) break;
                out.write(buffer, 0, read);
                if (level != null) level.onLevel(peak(buffer, read), out.size() / (RATE * 2));
            }
        } finally {
            recording = false;
            try { recorder.stop(); } catch (Throwable ignored) { }
            recorder.release();
        }
        keep(out.toByteArray());
    }

    public void stop() { recording = false; }

    private static int peak(byte[] pcm, int length) {
        int max = 0;
        for (int i = 0; i + 1 < length; i += 2) {
            int sample = Math.abs((short) ((pcm[i] & 0xff) | (pcm[i + 1] << 8)));
            if (sample > max) max = sample;
        }
        return Math.min(100, max * 100 / 32767);
    }

    /** Decode any audio file Android understands into the clip. */
    public void importFrom(Context context, Uri uri) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        try {
            extractor.setDataSource(context, uri, null);
            int track = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat candidate = extractor.getTrackFormat(i);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { track = i; format = candidate; break; }
            }
            if (track < 0) throw new IllegalArgumentException("That file has no sound in it");
            extractor.selectTrack(track);
            int rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            codec.configure(format, null, null, 0);
            codec.start();

            ByteArrayOutputStream mono = new ByteArrayOutputStream();
            long wanted = (long) rate * 2 * MAX_SECONDS;      // mono 16-bit at the source rate
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;
            while (!outputDone && mono.size() < wanted) {
                if (!inputDone) {
                    int in = codec.dequeueInputBuffer(10000);
                    if (in >= 0) {
                        ByteBuffer buffer = codec.getInputBuffer(in);
                        int size = buffer == null ? -1 : extractor.readSampleData(buffer, 0);
                        if (size < 0) {
                            codec.queueInputBuffer(in, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(in, 0, size, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }
                int out = codec.dequeueOutputBuffer(info, 10000);
                if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat changed = codec.getOutputFormat();
                    rate = changed.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    channels = changed.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    wanted = (long) rate * 2 * MAX_SECONDS;
                } else if (out >= 0) {
                    ByteBuffer buffer = codec.getOutputBuffer(out);
                    if (buffer != null && info.size > 0) {
                        buffer.position(info.offset);
                        buffer.limit(info.offset + info.size);
                        mixDown(buffer.slice().order(ByteOrder.LITTLE_ENDIAN), Math.max(1, channels), mono);
                    }
                    codec.releaseOutputBuffer(out, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                }
            }
            byte[] source = mono.toByteArray();
            if (source.length == 0) throw new IllegalArgumentException("Nothing could be decoded from that file");
            keep(resample(source, rate));
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (Throwable ignored) { }
                codec.release();
            }
            extractor.release();
        }
    }

    /** Interleaved 16-bit frames to one channel, averaged. */
    private static void mixDown(ByteBuffer pcm, int channels, ByteArrayOutputStream out) {
        while (pcm.remaining() >= channels * 2) {
            int sum = 0;
            for (int c = 0; c < channels; c++) sum += pcm.getShort();
            int sample = sum / channels;
            out.write(sample & 0xff);
            out.write((sample >> 8) & 0xff);
        }
    }

    /** Linear resampling to 16 kHz: speech, not music, is what it is for. */
    private static byte[] resample(byte[] pcm, int rate) {
        if (rate == RATE) return trim(pcm);
        int inSamples = pcm.length / 2;
        int outSamples = (int) Math.min((long) inSamples * RATE / rate, (long) RATE * MAX_SECONDS);
        byte[] out = new byte[outSamples * 2];
        for (int i = 0; i < outSamples; i++) {
            double at = (double) i * rate / RATE;
            int left = (int) at;
            int right = Math.min(inSamples - 1, left + 1);
            double t = at - left;
            int a = (short) ((pcm[left * 2] & 0xff) | (pcm[left * 2 + 1] << 8));
            int b = (short) ((pcm[right * 2] & 0xff) | (pcm[right * 2 + 1] << 8));
            int sample = (int) Math.round(a + (b - a) * t);
            out[i * 2] = (byte) (sample & 0xff);
            out[i * 2 + 1] = (byte) ((sample >> 8) & 0xff);
        }
        return out;
    }

    private static byte[] trim(byte[] pcm) {
        int limit = RATE * 2 * MAX_SECONDS;
        if (pcm.length <= limit) return pcm;
        byte[] out = new byte[limit];
        System.arraycopy(pcm, 0, out, 0, limit);
        return out;
    }

    /** A 44-byte RIFF header in front of 16 kHz mono 16-bit PCM. */
    public static byte[] wav(byte[] pcm) {
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put(new byte[] { 'R', 'I', 'F', 'F' });
        header.putInt(36 + pcm.length);
        header.put(new byte[] { 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ' });
        header.putInt(16);
        header.putShort((short) 1);              // PCM
        header.putShort((short) 1);              // mono
        header.putInt(RATE);
        header.putInt(RATE * 2);                 // bytes per second
        header.putShort((short) 2);              // bytes per frame
        header.putShort((short) 16);             // bits per sample
        header.put(new byte[] { 'd', 'a', 't', 'a' });
        header.putInt(pcm.length);
        byte[] out = new byte[44 + pcm.length];
        System.arraycopy(header.array(), 0, out, 0, 44);
        System.arraycopy(pcm, 0, out, 44, pcm.length);
        return out;
    }
}
