package com.google.ai.edge.litertlm;

public class Engine implements AutoCloseable {
    public Engine(EngineConfig engineConfig) { }
    public boolean isInitialized() { return false; }
    public void initialize() { }
    public Conversation createConversation() { return null; }
    public Conversation createConversation(ConversationConfig config) { return null; }
    public ModelInfo getModelInfo() { return null; }
    @Override public void close() { }

    // Kotlin's companion object, and it has no @JvmStatic — so from Java this is
    // Engine.Companion.setNativeMinLogSeverity(...), not Engine.set…().
    public static final Companion Companion = new Companion();
    public static final class Companion {
        public void setNativeMinLogSeverity(LogSeverity level) { }
    }
}
