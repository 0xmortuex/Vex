package com.vex.browser.speech;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Reading a page aloud.
 *
 * Android's own TextToSpeech, which every phone has and a Galaxy has a good one
 * of. The chrome sends the article a paragraph at a time rather than as one
 * wall of text: the engine has a 4,000-character limit per utterance, and
 * paragraph boundaries are also where a person wants to be able to stop, skip
 * and see where they are.
 *
 * It carries on with the screen off or from another app, as a listener on a
 * commute expects, and it behaves like anything else that plays: a
 * notification with Pause and Stop (see ReadAloud), the headset button, a
 * pause when a call comes in or another app starts playing, and a pause when
 * the headphones come out rather than reading the article to the carriage.
 *
 * Events, all relative to the parts the chrome last sent: "speaking" {index}
 * as each line starts, "finished" after the last, "paused" and "resumed" when
 * something other than the chrome paused or carried on, "stopped" when the
 * notification's Stop ended it, and "speakError".
 */
@CapacitorPlugin(name = "VexSpeak")
public class VexSpeakPlugin extends Plugin implements ReadAloud.Controls {

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Runnable> waiting = new ArrayList<>();

    // Main thread only, past this point.
    private TextToSpeech engine;
    private boolean ready;
    private boolean starting;
    private final List<String> queued = new ArrayList<>();
    private int at = -1;                 // the line being read, in `queued`
    private boolean paused;
    private boolean pausedForFocus;      // a call took the audio; carry on after it
    private float rate = 1f;
    private float pitch = 1f;
    private String voiceName = "";

    private MediaSession session;
    private AudioManager audio;
    private AudioFocusRequest focusRequest;
    private boolean noisyRegistered;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) pauseFromOutside();
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> main.post(() -> {
        if (queued.isEmpty()) return;
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            // Speech under a satnav instruction is speech you miss: pause even
            // where ducking is allowed, and carry on when it is over.
            if (!paused) {
                pausedForFocus = change != AudioManager.AUDIOFOCUS_LOSS;
                pauseFromOutside();
            }
        } else if (change == AudioManager.AUDIOFOCUS_GAIN && pausedForFocus && paused) {
            pausedForFocus = false;
            resumeFromOutside();
        }
    });

    // ── The engine ───────────────────────────────────────────────────────────

    private void ensureEngine(final Runnable then) {
        if (ready && engine != null) { then.run(); return; }
        // Two calls before the engine is up (the panel asking for voices while
        // the bar starts reading) both wait for the one engine.
        waiting.add(then);
        if (starting) return;
        // An engine that failed to start is not one to keep asking.
        if (engine != null) { engine.shutdown(); engine = null; }
        starting = true;
        engine = new TextToSpeech(getContext(), status -> main.post(() -> {
            starting = false;
            ready = status == TextToSpeech.SUCCESS;
            if (ready) {
                engine.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                engine.setOnUtteranceProgressListener(progress);
            }
            List<Runnable> run = new ArrayList<>(waiting);
            waiting.clear();
            for (Runnable next : run) next.run();
        }));
    }

    private final UtteranceProgressListener progress = new UtteranceProgressListener() {
        @Override public void onStart(String utteranceId) {
            int index = indexOf(utteranceId);
            main.post(() -> {
                if (index < 0) return;
                at = index;
                JSObject data = new JSObject();
                data.put("index", index);
                notifyListeners("speaking", data);
                present();
            });
        }

        @Override public void onDone(String utteranceId) {
            int index = indexOf(utteranceId);
            main.post(() -> {
                if (index < 0 || index != queued.size() - 1 || paused) return;
                notifyListeners("finished", new JSObject());
                release();
            });
        }

        @Override public void onError(String utteranceId) {
            int index = indexOf(utteranceId);
            main.post(() -> {
                JSObject data = new JSObject();
                data.put("index", index);
                notifyListeners("speakError", data);
                release();
            });
        }
    };

    private static int indexOf(String utteranceId) {
        try { return Integer.parseInt(String.valueOf(utteranceId).replace("vex-", "")); }
        catch (NumberFormatException error) { return -1; }
    }

    /** Hand the engine everything from `from` on. Ids stay the chrome's numbering. */
    private void queueFrom(int from) {
        engine.stop();
        at = Math.max(0, Math.min(from, queued.size() - 1));
        for (int index = at; index < queued.size(); index++) {
            HashMap<String, String> params = new HashMap<>();
            params.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "vex-" + index);
            engine.speak(queued.get(index), index == at ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, params);
        }
        paused = false;
        hold();
        present();
    }

    // ── Being something that plays ───────────────────────────────────────────

    private void hold() {
        Context context = getContext();
        if (audio == null) audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio != null && focusRequest == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build())
                    .setWillPauseWhenDucked(true)
                    .setOnAudioFocusChangeListener(focusListener, main)
                    .build();
            audio.requestAudioFocus(focusRequest);
        }
        if (!noisyRegistered) {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                context.registerReceiver(noisy, filter);
            }
            noisyRegistered = true;
        }
        if (session == null) {
            session = new MediaSession(context, "VexReadAloud");
            session.setCallback(new MediaSession.Callback() {
                @Override public void onPlay() { resumeFromOutside(); }
                @Override public void onPause() { pauseFromOutside(); }
                @Override public void onStop() { stop(); }
                @Override public void onSkipToNext() { skipFromOutside(1); }
                @Override public void onSkipToPrevious() { skipFromOutside(-1); }
            }, main);
        }
        session.setActive(true);
    }

    /** Let go of the audio, the headset button and the notification. */
    private void release() {
        paused = false;
        pausedForFocus = false;
        if (audio != null && focusRequest != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audio.abandonAudioFocusRequest(focusRequest);
        }
        focusRequest = null;
        if (noisyRegistered) {
            try { getContext().unregisterReceiver(noisy); } catch (IllegalArgumentException ignored) { }
            noisyRegistered = false;
        }
        if (session != null) session.setActive(false);
        ReadAloud.playing = false;
        ReadAloud.end();
    }

    /** Draw the notification and the session for where it has got to. */
    private void present() {
        if (queued.isEmpty()) return;
        String line = (Math.max(0, at) + 1) + " of " + queued.size();
        if (session != null) {
            session.setPlaybackState(new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                            | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                    .setState(paused ? PlaybackState.STATE_PAUSED : PlaybackState.STATE_PLAYING, Math.max(0, at), paused ? 0f : 1f)
                    .build());
            session.setMetadata(new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, ReadAloud.title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, "Vex · " + line)
                    .build());
        }
        ReadAloud.controls = this;
        ReadAloud.token = session == null ? null : session.getSessionToken();
        ReadAloud.progress = line;
        ReadAloud.playing = !paused;
        ReadAloud.update(getContext());
    }

    private void pauseFromOutside() {
        if (queued.isEmpty() || paused) return;
        pause();
        notifyListeners("paused", new JSObject());
    }

    private void resumeFromOutside() {
        if (queued.isEmpty() || !paused || engine == null || !ready) return;
        queueFrom(at);
        notifyListeners("resumed", new JSObject());
    }

    private void skipFromOutside(int by) {
        if (queued.isEmpty() || engine == null || !ready) return;
        int next = Math.max(0, Math.min(at + by, queued.size() - 1));
        if (paused) { at = next; present(); }
        else queueFrom(next);
        JSObject data = new JSObject();
        data.put("index", next);
        notifyListeners("speaking", data);
    }

    // ── ReadAloud.Controls: the notification's buttons ──────────────────────

    @Override
    public void play() { resumeFromOutside(); }

    @Override
    public void pause() {
        if (queued.isEmpty()) return;
        paused = true;
        if (engine != null) engine.stop();
        present();
    }

    @Override
    public void stop() {
        boolean was = !queued.isEmpty();
        if (engine != null) engine.stop();
        queued.clear();
        at = -1;
        release();
        if (was) notifyListeners("stopped", new JSObject());
    }

    // ── What the chrome calls ────────────────────────────────────────────────

    /** Is there an engine at all, and what can it speak with? */
    @PluginMethod
    public void available(PluginCall call) {
        main.post(() -> ensureEngine(() -> {
            JSObject result = new JSObject();
            result.put("available", ready);
            JSArray voices = new JSArray();
            if (ready) {
                try {
                    Set<Voice> all = engine.getVoices();
                    if (all != null) {
                        for (Voice voice : all) {
                            // Network voices are better and useless on a train;
                            // only the ones installed on the phone are offered.
                            if (voice.isNetworkConnectionRequired()) continue;
                            JSObject row = new JSObject();
                            row.put("name", voice.getName());
                            Locale locale = voice.getLocale();
                            row.put("language", locale == null ? "" : locale.toLanguageTag());
                            row.put("label", locale == null ? voice.getName() : locale.getDisplayName());
                            voices.put(row);
                        }
                    }
                } catch (Throwable ignored) {
                    // Some engines throw rather than returning an empty set.
                }
            }
            result.put("voices", voices);
            call.resolve(result);
        }));
    }

    @PluginMethod
    public void speak(PluginCall call) {
        final JSArray parts = call.getArray("parts");
        if (parts == null || parts.length() == 0) { call.reject("Nothing to read"); return; }
        final float wantRate = call.getFloat("rate", 1f);
        final String wantVoice = call.getString("voice", "");
        final String title = call.getString("title", "");

        main.post(() -> ensureEngine(() -> {
            if (!ready) { call.reject("This phone has no speech engine"); return; }
            List<String> lines = new ArrayList<>();
            try {
                for (int index = 0; index < parts.length(); index++) {
                    // Blank lines keep their place: the chrome counts lines by
                    // where they were in what it sent.
                    String text = String.valueOf(parts.get(index)).trim();
                    lines.add(text.isEmpty() ? " " : text);
                }
            } catch (Exception error) {
                call.reject("That text could not be read");
                return;
            }
            rate = wantRate;
            voiceName = wantVoice == null ? "" : wantVoice;
            engine.setSpeechRate(Math.max(0.5f, Math.min(2.5f, rate)));
            engine.setPitch(Math.max(0.5f, Math.min(2f, pitch)));
            if (!voiceName.isEmpty()) {
                try {
                    for (Voice voice : engine.getVoices()) {
                        if (voiceName.equals(voice.getName())) { engine.setVoice(voice); break; }
                    }
                } catch (Throwable ignored) { }
            }
            queued.clear();
            queued.addAll(lines);
            ReadAloud.title = title == null ? "" : title;
            pausedForFocus = false;
            queueFrom(0);
            JSObject result = new JSObject();
            result.put("parts", queued.size());
            call.resolve(result);
        }));
    }

    /** Pause where it is; the chrome carries on by sending the rest again. */
    @PluginMethod
    public void pause(PluginCall call) {
        main.post(() -> { pause(); call.resolve(); });
    }

    /** Stop, and put the notification away. */
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            if (engine != null) engine.stop();
            queued.clear();
            at = -1;
            release();
            call.resolve();
        });
    }

    @PluginMethod
    public void speaking(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            result.put("speaking", engine != null && ready && !paused && engine.isSpeaking());
            result.put("index", at);
            call.resolve(result);
        });
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (engine != null) engine.stop();
        queued.clear();
        release();
        if (session != null) { session.release(); session = null; }
        if (ReadAloud.controls == this) ReadAloud.controls = null;
        if (engine != null) { engine.shutdown(); engine = null; ready = false; }
    }
}
