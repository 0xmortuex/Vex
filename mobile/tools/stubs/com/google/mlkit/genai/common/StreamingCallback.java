package com.google.mlkit.genai.common;

public interface StreamingCallback {
    void onNewText(String additionalText);
    void onNewThought(String additionalThought);
}
