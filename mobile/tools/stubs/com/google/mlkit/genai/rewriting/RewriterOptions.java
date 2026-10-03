package com.google.mlkit.genai.rewriting;

import android.content.Context;

public class RewriterOptions {
    public static Builder builder(Context context) { return null; }
    public static class Builder {
        public Builder setOutputType(int outputType) { return this; }
        public Builder setLanguage(int language) { return this; }
        public RewriterOptions build() { return null; }
    }
    public static final class OutputType {
        private OutputType() { }
        public static final int ELABORATE = 0;
        public static final int EMOJIFY = 1;
        public static final int SHORTEN = 2;
        public static final int FRIENDLY = 3;
        public static final int PROFESSIONAL = 4;
        public static final int REPHRASE = 5;
    }
    public static final class Language {
        private Language() { }
        public static final int ENGLISH = 0;
    }
}
