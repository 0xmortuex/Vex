package com.vex.browser.translate;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.nl.languageid.LanguageIdentification;
import com.google.mlkit.nl.languageid.LanguageIdentifier;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.TranslateRemoteModel;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Translating a page on the device.
 *
 * ML Kit's translation models run here, offline, once the pair has been
 * downloaded — so a page translated in Vex is a page nobody else read. Neither
 * Samsung Internet nor Chrome does that: both send the page to a server.
 *
 * Three things shape this class:
 *
 *   1. Every ML Kit call answers with a GMS Task, and every method here runs on
 *      one background thread and blocks on Tasks.await. Awaiting on the main
 *      thread would deadlock against the Task's own callback, and one thread
 *      means the Translator instances below need no locking.
 *   2. Models are downloaded on request and never behind the person's back: a
 *      language pair is thirty-odd megabytes, and a browser that spends that on
 *      a mobile connection without asking is a browser with a data bill.
 *   3. Translators are cached per pair and closed together, because creating one
 *      per paragraph would load the model per paragraph.
 */
@CapacitorPlugin(name = "VexTranslate")
public class VexTranslatePlugin extends Plugin {

    /** A page has hundreds of text nodes; one Translator does all of them. */
    private final Map<String, Translator> translators = new HashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LanguageIdentifier identifier;

    private static String tag(String language) {
        if (language == null) return null;
        return TranslateLanguage.fromLanguageTag(language.trim());
    }

    private Translator translatorFor(String from, String to) {
        String key = from + '>' + to;
        Translator held = translators.get(key);
        if (held != null) return held;
        Translator made = Translation.getClient(new TranslatorOptions.Builder()
                .setSourceLanguage(from)
                .setTargetLanguage(to)
                .build());
        translators.put(key, made);
        return made;
    }

    /**
     * Every language the library can translate, with the name the phone would
     * call it, and which of them are already on the device.
     */
    @PluginMethod
    public void languages(PluginCall call) {
        worker.execute(() -> {
            try {
                Set<TranslateRemoteModel> here = Tasks.await(
                        RemoteModelManager.getInstance().getDownloadedModels(TranslateRemoteModel.class));
                List<String> downloaded = new ArrayList<>();
                if (here != null) {
                    for (TranslateRemoteModel model : here) downloaded.add(model.getLanguage());
                }
                JSArray all = new JSArray();
                List<String> supported = TranslateLanguage.getAllLanguages();
                if (supported != null) {
                    for (String language : supported) {
                        JSObject row = new JSObject();
                        row.put("language", language);
                        row.put("label", new Locale(language).getDisplayLanguage());
                        row.put("downloaded", downloaded.contains(language));
                        all.put(row);
                    }
                }
                JSObject result = new JSObject();
                result.put("languages", all);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not read the translation models: " + error.getMessage());
            }
        });
    }

    /** What a piece of text is written in: a BCP-47 tag, or "" for no idea. */
    @PluginMethod
    public void identify(PluginCall call) {
        final String text = call.getString("text", "");
        worker.execute(() -> {
            try {
                if (identifier == null) identifier = LanguageIdentification.getClient();
                String found = Tasks.await(identifier.identifyLanguage(text));
                JSObject result = new JSObject();
                // "und" is the library saying it cannot tell, which is not a
                // failure and must not be handed on as a language.
                result.put("language", found == null || "und".equals(found) ? "" : found);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not work out the language: " + error.getMessage());
            }
        });
    }

    /**
     * Make sure the pair is on the device. `wifiOnly` is the default: thirty
     * megabytes over a mobile connection is a decision, not a side effect.
     */
    @PluginMethod
    public void ensureModel(PluginCall call) {
        final String from = tag(call.getString("from", ""));
        final String to = tag(call.getString("to", ""));
        final boolean wifiOnly = !Boolean.FALSE.equals(call.getBoolean("wifiOnly", true));
        if (from == null || to == null) { call.reject("That pair of languages is not supported"); return; }
        worker.execute(() -> {
            try {
                DownloadConditions.Builder conditions = new DownloadConditions.Builder();
                if (wifiOnly) conditions.requireWifi();
                Tasks.await(translatorFor(from, to).downloadModelIfNeeded(conditions.build()));
                JSObject result = new JSObject();
                result.put("ready", true);
                result.put("from", from);
                result.put("to", to);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The translation model could not be downloaded: " + error.getMessage());
            }
        });
    }

    /**
     * Translate a batch of strings. The chrome sends a page's text nodes in
     * chunks and writes each chunk back as it arrives, so the page fills in
     * rather than waiting for the last paragraph.
     */
    @PluginMethod
    public void translate(PluginCall call) {
        final String from = tag(call.getString("from", ""));
        final String to = tag(call.getString("to", ""));
        final JSArray texts = call.getArray("texts");
        if (from == null || to == null) { call.reject("That pair of languages is not supported"); return; }
        if (texts == null) { call.reject("Nothing to translate"); return; }
        worker.execute(() -> {
            try {
                Translator translator = translatorFor(from, to);
                JSArray out = new JSArray();
                for (int index = 0; index < texts.length(); index++) {
                    String text = String.valueOf(texts.get(index));
                    if (text == null || text.trim().isEmpty()) { out.put(""); continue; }
                    // One failed string must not lose the paragraph it was in:
                    // an empty answer tells the chrome to leave that node alone.
                    try { out.put(Tasks.await(translator.translate(text))); }
                    catch (Exception ignored) { out.put(""); }
                }
                JSObject result = new JSObject();
                result.put("texts", out);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not translate that: " + error.getMessage());
            }
        });
    }

    /** Give the space back. One language at a time, from the panel. */
    @PluginMethod
    public void deleteModel(PluginCall call) {
        final String language = tag(call.getString("language", ""));
        if (language == null) { call.reject("No such language"); return; }
        worker.execute(() -> {
            try {
                Tasks.await(RemoteModelManager.getInstance().deleteDownloadedModel(
                        new TranslateRemoteModel.Builder(language).build()));
                // A cached Translator for that pair would go on working from a
                // model that is no longer there.
                closeTranslatorsFor(language);
                JSObject result = new JSObject();
                result.put("deleted", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not delete that model: " + error.getMessage());
            }
        });
    }

    private void closeTranslatorsFor(String language) {
        List<String> stale = new ArrayList<>();
        for (String key : translators.keySet()) {
            if (key.startsWith(language + '>') || key.endsWith('>' + language)) stale.add(key);
        }
        for (String key : stale) {
            Translator translator = translators.remove(key);
            if (translator != null) {
                try { translator.close(); } catch (Throwable ignored) { }
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        for (Translator translator : translators.values()) {
            try { translator.close(); } catch (Throwable ignored) { }
        }
        translators.clear();
        if (identifier != null) {
            try { identifier.close(); } catch (Throwable ignored) { }
            identifier = null;
        }
        worker.shutdownNow();
    }
}
