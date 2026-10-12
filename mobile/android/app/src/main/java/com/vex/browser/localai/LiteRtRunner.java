package com.vex.browser.localai;

import android.content.Context;

import com.google.ai.edge.litertlm.Backend;
import com.google.ai.edge.litertlm.Content;
import com.google.ai.edge.litertlm.Contents;
import com.google.ai.edge.litertlm.Conversation;
import com.google.ai.edge.litertlm.ConversationConfig;
import com.google.ai.edge.litertlm.Engine;
import com.google.ai.edge.litertlm.EngineConfig;
import com.google.ai.edge.litertlm.LogSeverity;
import com.google.ai.edge.litertlm.Message;
import com.google.ai.edge.litertlm.MessageCallback;
import com.google.ai.edge.litertlm.OpenApiTool;
import com.google.ai.edge.litertlm.SamplerConfig;
import com.google.ai.edge.litertlm.ToolKt;
import com.google.ai.edge.litertlm.ToolProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The on-device model: LiteRT-LM holding a .litertlm file, with the GPU doing
 * the arithmetic where the phone has one worth using.
 *
 * LiteRT-LM's API is Kotlin, but every entry point Vex needs is annotated
 * @JvmOverloads and the streaming variant takes a plain callback interface, so
 * this stays Java and the app needs no Kotlin toolchain. The suspend and Flow
 * overloads are the ones Java cannot see, and they are not needed. Tools come
 * in through OpenApiTool — a name, a JSON schema and an execute(String) — which
 * is the one tool shape that needs no Kotlin reflection.
 *
 * Two lifetimes. The engine holds the weights: loading it takes seconds and a
 * gigabyte or more, so it stays as long as the model, backend and the vision
 * and audio encoders asked for stay the same. The conversation holds the chat
 * — its system prompt, sampling and tools — and is cheap: every feature that
 * wants a clean slate or different settings gets a new one from the same
 * engine.
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

    /** A tool the model asked for, answered by whoever declared it. */
    public interface ToolHandler {
        /** Runs off the main thread and may block; returns the result as JSON. */
        String call(String name, String argumentsJson);
    }

    public interface Ready {
        void onReady(String model, String backend);
        void onError(String message);
    }

    /** What the engine was built with: a change to any of it means a reload. */
    public static final class EngineSpec {
        public String backend = "cpu";
        public boolean vision;
        public boolean audio;
        public int maxTokens;          // 0: the model's own default

        String key(File model) {
            return model.getAbsolutePath() + "|" + backend + "|" + vision + "|" + audio + "|" + maxTokens;
        }
    }

    /** What one conversation is set up with. */
    public static final class ChatSpec {
        public String system = "";
        public int topK;               // 0: the model's own sampling
        public double topP;
        public double temperature;
        public String toolsJson = "";  // a JSON array of OpenAPI function descriptions
    }

    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private Engine engine;
    private Conversation conversation;
    private String engineKey = "";
    private String loadedModel = "";
    private String loadedBackend = "";
    private boolean loadedVision;
    private boolean loadedAudio;
    private volatile boolean busy;
    private volatile ToolHandler toolHandler;

    public LiteRtRunner(Context context) {
        this.context = context;
    }

    public boolean isLoaded() { return engine != null && conversation != null; }
    public boolean isBusy() { return busy; }
    public String loadedModel() { return loadedModel; }
    public String loadedBackend() { return loadedBackend; }
    public boolean hasVision() { return loadedVision; }
    public boolean hasAudio() { return loadedAudio; }

    public void setToolHandler(ToolHandler handler) { this.toolHandler = handler; }

    /** Is there any chance of this working on this device? */
    public static boolean supported() {
        // 64-bit only: the published native libraries are arm64-v8a and
        // x86_64, and a 32-bit phone cannot address a model this size anyway.
        for (String abi : android.os.Build.SUPPORTED_64_BIT_ABIS) {
            if (abi != null && !abi.isEmpty()) return true;
        }
        return false;
    }

    private Backend backendFor(String name) {
        if ("gpu".equalsIgnoreCase(name)) return new Backend.GPU();
        if ("npu".equalsIgnoreCase(name)) return new Backend.NPU(context.getApplicationInfo().nativeLibraryDir);
        return new Backend.CPU(null, null);
    }

    /**
     * Load a model — or keep the one already loaded, when it was built the same
     * way — and start a fresh conversation on it.
     */
    public void load(final File model, final EngineSpec spec, final ChatSpec chat, final Ready ready) {
        worker.execute(() -> {
            busy = false;
            try {
                String key = spec.key(model);
                if (engine == null || !key.equals(engineKey)) {
                    unloadNow();
                    // A Kotlin companion object with no @JvmStatic, so Java goes
                    // through Companion rather than calling it on the class.
                    Engine.Companion.setNativeMinLogSeverity(LogSeverity.WARNING);
                    EngineConfig config = new EngineConfig(
                            model.getAbsolutePath(),
                            backendFor(spec.backend),
                            // The Gallery's rule for Gemma's encoders: pictures on
                            // the GPU, sound on the CPU — the audio encoder does
                            // not run on the GPU.
                            spec.vision ? new Backend.GPU() : null,
                            spec.audio ? new Backend.CPU(null, null) : null,
                            spec.maxTokens > 0 ? Integer.valueOf(spec.maxTokens) : null,
                            spec.vision ? Integer.valueOf(4) : null,
                            // A writable cache directory makes every load after the
                            // first one much faster.
                            context.getCacheDir().getAbsolutePath());
                    Engine created = new Engine(config);
                    created.initialize();
                    engine = created;
                    engineKey = key;
                    loadedModel = model.getName();
                    loadedBackend = spec.backend == null ? "cpu" : spec.backend.toLowerCase();
                    loadedVision = spec.vision;
                    loadedAudio = spec.audio;
                }
                startConversation(chat);
                ready.onReady(loadedModel, loadedBackend);
            } catch (Throwable error) {
                unloadNow();
                ready.onError(describe(error, spec.backend));
            }
        });
    }

    /** A clean slate on the engine already loaded: new prompt, sampling and tools. */
    public void reset(final ChatSpec chat, final Ready ready) {
        worker.execute(() -> {
            if (engine == null) { ready.onError("No model is loaded"); return; }
            try {
                startConversation(chat);
                ready.onReady(loadedModel, loadedBackend);
            } catch (Throwable error) {
                ready.onError(message(error));
            }
        });
    }

    private void startConversation(ChatSpec chat) throws Exception {
        busy = false;
        if (conversation != null) {
            try { conversation.close(); } catch (Throwable ignored) { }
            conversation = null;
        }
        ChatSpec spec = chat == null ? new ChatSpec() : chat;
        Contents system = spec.system == null || spec.system.isEmpty()
                ? null : Contents.Companion.of(spec.system);
        SamplerConfig sampler = spec.topK > 0
                ? new SamplerConfig(spec.topK, clamp(spec.topP, 0, 1), Math.max(0, spec.temperature), 0)
                : null;
        List<ToolProvider> tools = toolsFrom(spec.toolsJson);
        ConversationConfig config = system == null && sampler == null && tools.isEmpty()
                ? new ConversationConfig()
                : new ConversationConfig(system, Collections.<Message>emptyList(), tools, sampler);
        conversation = engine.createConversation(config);
    }

    private static double clamp(double value, double low, double high) {
        return Math.max(low, Math.min(high, value));
    }

    /**
     * The chrome declares tools as OpenAPI function descriptions; each becomes
     * an OpenApiTool whose execute() asks the chrome and waits for its answer.
     * LiteRT-LM calls execute() itself, mid-reply, and feeds the result back to
     * the model before it carries on — so the chrome never has to drive a loop.
     */
    private List<ToolProvider> toolsFrom(String json) throws Exception {
        List<ToolProvider> tools = new ArrayList<>();
        if (json == null || json.trim().isEmpty()) return tools;
        JSONArray declared = new JSONArray(json);
        for (int i = 0; i < declared.length(); i++) {
            final JSONObject description = declared.getJSONObject(i);
            final String name = description.optString("name", "");
            if (name.isEmpty()) continue;
            final String descriptionJson = description.toString();
            tools.add(ToolKt.tool(new OpenApiTool() {
                @Override public String getToolDescriptionJsonString() { return descriptionJson; }
                @Override public String execute(String paramsJsonString) {
                    ToolHandler handler = toolHandler;
                    if (handler == null) return "{\"error\":\"Nothing can run " + name + " right now\"}";
                    String result = handler.call(name, paramsJsonString == null ? "{}" : paramsJsonString);
                    return result == null ? "{}" : result;
                }
            }));
        }
        return tools;
    }

    /**
     * A GPU or NPU backend that the phone turns out not to support fails inside
     * native code with a message nobody can act on. Say which backend it was,
     * because the answer is almost always "try CPU".
     */
    private static String describe(Throwable error, String backendName) {
        String message = message(error);
        if (backendName != null && !"cpu".equalsIgnoreCase(backendName)) {
            return message + " (on the " + backendName.toUpperCase() + " backend — CPU may still work)";
        }
        return message;
    }

    private static String message(Throwable error) {
        return error.getMessage() == null ? error.toString() : error.getMessage();
    }

    public void generate(final String prompt, final Tokens tokens) {
        generate(prompt, Collections.<byte[]>emptyList(), Collections.<byte[]>emptyList(), tokens);
    }

    /**
     * One turn: pictures first, then sound, then the words — the order the
     * Gallery uses, and the one Gemma's prompt template expects.
     */
    public void generate(final String prompt, final List<byte[]> images, final List<byte[]> audio, final Tokens tokens) {
        if (!isLoaded()) { tokens.onError("No model is loaded"); return; }
        if (busy) { tokens.onError("The model is already answering"); return; }
        if (!images.isEmpty() && !loadedVision) { tokens.onError("This model was loaded without its image reader"); return; }
        if (!audio.isEmpty() && !loadedAudio) { tokens.onError("This model was loaded without its audio reader"); return; }
        busy = true;
        worker.execute(() -> {
            final StringBuilder whole = new StringBuilder();
            try {
                List<Content> parts = new ArrayList<>();
                for (byte[] image : images) parts.add(new Content.ImageBytes(image));
                for (byte[] clip : audio) parts.add(new Content.AudioBytes(clip));
                if (prompt != null && !prompt.isEmpty()) parts.add(new Content.Text(prompt));
                conversation.sendMessageAsync(Contents.Companion.of(parts), new MessageCallback() {
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
                        tokens.onError(message(throwable));
                    }
                });
            } catch (Throwable error) {
                busy = false;
                tokens.onError(message(error));
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
        engineKey = "";
        loadedModel = "";
        loadedBackend = "";
        loadedVision = false;
        loadedAudio = false;
    }
}
