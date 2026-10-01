package com.vex.browser.speech;

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
 * It does not pretend to be a media app. There is no foreground service and no
 * notification, so reading stops when Vex goes to the background — a browser
 * that keeps talking after you have left it is a browser you uninstall.
 */
@CapacitorPlugin(name = "VexSpeak")
public class VexSpeakPlugin extends Plugin {

    private TextToSpeech engine;
    private boolean ready;
    private final List<String> queued = new ArrayList<>();
    private int at = -1;
    private float rate = 1f;
    private float pitch = 1f;
    private String voiceName = "";

    private void ensureEngine(final Runnable then) {
        if (ready && engine != null) { then.run(); return; }
        if (engine != null) { engine.shutdown(); engine = null; }
        engine = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready) {
                engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String utteranceId) {
                        at = indexOf(utteranceId);
                        JSObject data = new JSObject();
                        data.put("index", at);
                        notifyListeners("speaking", data);
                    }

                    @Override public void onDone(String utteranceId) {
                        int index = indexOf(utteranceId);
                        if (index >= 0 && index == queued.size() - 1) {
                            notifyListeners("finished", new JSObject());
                        }
                    }

                    @Override public void onError(String utteranceId) {
                        JSObject data = new JSObject();
                        data.put("index", indexOf(utteranceId));
                        notifyListeners("speakError", data);
                    }
                });
            }
            // The callback arrives on a binder thread; everything after it
            // touches the engine, so put it back on the main one.
            getActivity().runOnUiThread(then);
        });
    }

    private static int indexOf(String utteranceId) {
        try { return Integer.parseInt(String.valueOf(utteranceId).replace("vex-", "")); }
        catch (NumberFormatException error) { return -1; }
    }

    /** Is there an engine at all, and what can it speak with? */
    @PluginMethod
    public void available(PluginCall call) {
        ensureEngine(() -> {
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
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        final JSArray parts = call.getArray("parts");
        if (parts == null || parts.length() == 0) { call.reject("Nothing to read"); return; }
        rate = call.getFloat("rate", 1f);
        pitch = call.getFloat("pitch", 1f);
        voiceName = call.getString("voice", "");

        ensureEngine(() -> {
            if (!ready) { call.reject("This phone has no speech engine"); return; }
            engine.stop();
            queued.clear();
            try {
                for (int index = 0; index < parts.length(); index++) {
                    String text = String.valueOf(parts.get(index));
                    if (text != null && !text.trim().isEmpty()) queued.add(text.trim());
                }
            } catch (Exception error) {
                call.reject("That text could not be read");
                return;
            }
            engine.setSpeechRate(Math.max(0.5f, Math.min(2.5f, rate)));
            engine.setPitch(Math.max(0.5f, Math.min(2f, pitch)));
            if (!voiceName.isEmpty()) {
                try {
                    for (Voice voice : engine.getVoices()) {
                        if (voiceName.equals(voice.getName())) { engine.setVoice(voice); break; }
                    }
                } catch (Throwable ignored) { }
            }

            at = 0;
            for (int index = 0; index < queued.size(); index++) {
                HashMap<String, String> params = new HashMap<>();
                params.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "vex-" + index);
                engine.speak(queued.get(index),
                        index == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, params);
            }
            JSObject result = new JSObject();
            result.put("parts", queued.size());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (engine != null) engine.stop();
        at = -1;
        call.resolve();
    }

    @PluginMethod
    public void speaking(PluginCall call) {
        JSObject result = new JSObject();
        result.put("speaking", engine != null && ready && engine.isSpeaking());
        result.put("index", at);
        call.resolve(result);
    }

    /**
     * Leaving Vex stops the reading. Without this the engine keeps talking from
     * a dead app, and the only way to silence it is to kill the process.
     */
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (engine != null) engine.stop();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (engine != null) { engine.shutdown(); engine = null; ready = false; }
    }
}
