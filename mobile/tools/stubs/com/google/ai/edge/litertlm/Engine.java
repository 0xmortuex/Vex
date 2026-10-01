package com.google.ai.edge.litertlm;

public class Engine implements AutoCloseable {
    public Engine(EngineConfig engineConfig) { }
    public boolean isInitialized() { return false; }
    public void initialize() { }
    public Conversation createConversation() { return null; }
    public Conversation createConversation(ConversationConfig config) { return null; }
    public ModelInfo getModelInfo() { return null; }
    @Override public void close() { }
    public static void setNativeMinLogSeverity(LogSeverity level) { }
}
