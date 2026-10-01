package com.google.ai.edge.litertlm;

public class Conversation implements AutoCloseable {
    public Message sendMessage(String text) { return null; }
    public void sendMessageAsync(String text, MessageCallback callback) { }
    public void cancelProcess() { }
    @Override public void close() { }
}
