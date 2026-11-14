package com.google.ai.edge.litertlm;

import java.util.Map;

public class Conversation implements AutoCloseable {
    public Message sendMessage(String text) { return null; }
    public Message sendMessage(Contents contents) { return null; }
    public void sendMessageAsync(String text, MessageCallback callback) { }
    public void sendMessageAsync(Contents contents, MessageCallback callback) { }
    // The Flow-returning @JvmOverloads twin, which Java also sees: present so
    // an ambiguous call fails here as it would against the real library.
    public Object sendMessageAsync(Contents contents, Map<String, Object> extraContext) { return null; }
    public void cancelProcess() { }
    @Override public void close() { }
}
