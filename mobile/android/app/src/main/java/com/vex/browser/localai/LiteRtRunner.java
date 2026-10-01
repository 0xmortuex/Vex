package com.vex.browser.localai;

import android.content.Context;

import com.google.ai.edge.litertlm.Backend;
import com.google.ai.edge.litertlm.Contents;
import com.google.ai.edge.litertlm.Conversation;
import com.google.ai.edge.litertlm.ConversationConfig;
import com.google.ai.edge.litertlm.Engine;
import com.google.ai.edge.litertlm.EngineConfig;
import com.google.ai.edge.litertlm.LogSeverity;
import com.google.ai.edge.litertlm.Message;
import com.google.ai.edge.litertlm.MessageCallback;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The on-device model: LiteRT-LM holding a .litertlm file, with the GPU doing
 * the arithmetic where the phone has one worth using.
 *
 * LiteRT-LM's API is Kotlin, but every entry point Vex needs is annotated
 * @JvmOverloads and the streaming variant takes a plain callback interface, so
 * this stays Java and the app needs no Kotlin toolchain. The suspend and Flow
 * overloads are the ones Java cannot see, and they are not needed.
 *
 * Everything runs on one thread. initialize() takes seconds, a reply takes tens
 * of seconds, and two conversations against one engine is how you get a native
 * crash rather than an exception.
 */
public class LiteRtRunner {

    public interface Tokens {
        void onToken(String text);
        void onDone(String whole);
        void onError(String message);
    }

    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private Engine engine;
    private Conversation conversation;
    private String loadedModel = "";
    private String loadedBackend = "";
    private volatile boolean busy;

    public LiteRtRunner(Context context) {
        this.context = context;
    }

    public boolean isLoaded() { return engine != null && conversation != null; }
    public boolean isBusy() { return busy; }
    public String loadedModel() { return loadedModel; }
    public String loadedBackend() { return loadedBackend; }

    /** Is there any chance of this working on this device? */
    public static boolean supported() {
        // 64-bit arm only: the published native libraries are arm64-v8a and
        // x86_64, and a 32-bit phone cannot address a model this size anyway.
        for (String abi : android.os.Build.SUPPORTED_64_BIT_ABIS) {
            if (abi != null && !abi.isEmpty()) return true;
        }
        return false;
    }

    public interface Ready {
        void onReady(String model, String backend);
        void onError(String message);
    }

    public void load(final File model, final String backendName, final String systemPrompt, final Ready ready) {
        worker.execute(() -> {
            try {
                unloadNow();
                // A Kotlin companion object with no @JvmStatic, so Java goes
                // through Companion rather than calling it on the class.
                Engine.Companion.setNativeMinLogSeverity(LogSeverity.WARNING);
                Backend backend;
                if ("gpu".equalsIgnoreCase(backendName)) backend = new Backend.GPU();
                else if ("npu".equalsIgnoreCase(backendName)) {
                    backend = new Backend.NPU(context.getApplicationInfo().nativeLibraryDir);
                } else backend = new Backend.CPU(null, null);

                EngineConfig config = new EngineConfig(
                        model.getAbsolutePath(), backend, null, null, null, null,
                        // A writable cache directory makes every load after the
                        // first one much faster.
                        context.getCacheDir().getAbsolutePath());
                Engine created = new Engine(config);
                created.initialize();
                ConversationConfig conversationConfig = systemPrompt == null || systemPrompt.isEmpty()
                        ? new ConversationConfig()
                        : new ConversationConfig(Contents.Companion.of(systemPrompt));
                engine = created;
                conversation = created.createConversation(conversationConfig);
                loadedModel = model.getName();
                loadedBackend = backendName == null ? "cpu" : backendName.toLowerCase();
                ready.onReady(loadedModel, loadedBackend);
            } catch (Throwable error) {
                unloadNow();
                ready.onError(describe(error, backendName));
            }
        });
    }

    /**
     * A GPU or NPU backend that the phone turns out not to support fails inside
     * native code with a message nobody can act on. Say which backend it was,
     * because the answer is almost always "try CPU".
     */
    private static String describe(Throwable error, String backendName) {
        String message = error.getMessage() == null ? error.toString() : error.getMessage();
        if (backendName != null && !"cpu".equalsIgnoreCase(backendName)) {
            return message + " (on the " + backendName.toUpperCase() + " backend — CPU may still work)";
        }
        return message;
    }

    public void generate(final String prompt, final Tokens tokens) {
        if (!isLoaded()) { tokens.onError("No model is loaded"); return; }
        if (busy) { tokens.onError("The model is already answering"); return; }
        busy = true;
        worker.execute(() -> {
            final StringBuilder whole = new StringBuilder();
            try {
                conversation.sendMessageAsync(prompt, new MessageCallback() {
                    @Override public void onMessage(Message message) {
                        String chunk = message.toString();
                        if (chunk == null || chunk.isEmpty()) return;
                        whole.append(chunk);
                        tokens.onToken(chunk);
                    }

                    @Override public void onDone() {
                        busy = false;
                        tokens.onDone(whole.toString());
                    }

                    @Override public void onError(Throwable throwable) {
                        busy = false;
                        tokens.onError(throwable.getMessage() == null
                                ? throwable.toString() : throwable.getMessage());
                    }
                });
            } catch (Throwable error) {
                busy = false;
                tokens.onError(error.getMessage() == null ? error.toString() : error.getMessage());
            }
        });
    }

    public void stop() {
        if (conversation == null) return;
        try { conversation.cancelProcess(); } catch (Throwable ignored) { }
        busy = false;
    }

    public void unload() {
        worker.execute(this::unloadNow);
    }

    private void unloadNow() {
        busy = false;
        if (conversation != null) {
            try { conversation.close(); } catch (Throwable ignored) { }
            conversation = null;
        }
        if (engine != null) {
            try { engine.close(); } catch (Throwable ignored) { }
            engine = null;
        }
        loadedModel = "";
        loadedBackend = "";
    }
}
