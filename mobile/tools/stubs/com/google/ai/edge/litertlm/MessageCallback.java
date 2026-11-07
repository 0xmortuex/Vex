package com.google.ai.edge.litertlm;

public interface MessageCallback {
    void onMessage(Message message);
    void onDone();
    void onError(Throwable throwable);
}
