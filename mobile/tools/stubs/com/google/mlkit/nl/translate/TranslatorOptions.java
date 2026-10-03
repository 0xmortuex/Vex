package com.google.mlkit.nl.translate;

public class TranslatorOptions {
    public static class Builder {
        public Builder setSourceLanguage(String language) { return this; }
        public Builder setTargetLanguage(String language) { return this; }
        public TranslatorOptions build() { return new TranslatorOptions(); }
    }
}
