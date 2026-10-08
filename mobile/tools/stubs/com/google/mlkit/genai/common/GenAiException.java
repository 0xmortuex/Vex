package com.google.mlkit.genai.common;

public class GenAiException extends Exception {
    public GenAiException(String message) { super(message); }
    public int getErrorCode() { return 0; }
}
