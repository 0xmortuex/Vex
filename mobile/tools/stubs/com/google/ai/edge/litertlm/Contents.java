package com.google.ai.edge.litertlm;

import java.util.List;

// A Kotlin companion object with no @JvmStatic: Java reaches the factories
// through Contents.Companion.
public class Contents {
    public static final Companion Companion = new Companion();
    public static final class Companion {
        public Contents of(String text) { return null; }
        public Contents of(Content... contents) { return null; }
        public Contents of(List<? extends Content> contents) { return null; }
    }
    @Override public String toString() { return ""; }
}
