package com.google.mlkit.genai.summarization;

import android.content.Context;

public class SummarizerOptions {
    public static Builder builder(Context context) { return null; }

    public static class Builder {
        public Builder setInputType(int inputType) { return this; }
        public Builder setOutputType(int outputType) { return this; }
        public Builder setLanguage(int language) { return this; }
        public SummarizerOptions build() { return null; }
    }

    public static final class InputType {
        private InputType() { }
        public static final int ARTICLE = 0;
        public static final int CONVERSATION = 1;
    }
    public static final class OutputType {
        private OutputType() { }
        public static final int ONE_BULLET = 0;
        public static final int TWO_BULLETS = 1;
        public static final int THREE_BULLETS = 2;
    }
    public static final class Language {
        private Language() { }
        public static final int ENGLISH = 0;
        public static final int JAPANESE = 1;
        public static final int KOREAN = 2;
    }
}
