package com.google.ai.edge.litertlm;

public abstract class Backend {
    public String getName() { return ""; }

    // CPU is a Kotlin data class with two nullable parameters and no
    // @JvmOverloads, so Java only gets the two-argument constructor.
    public static final class CPU extends Backend {
        public CPU(Integer threadCount, Integer numOfThreads) { }
    }
    public static final class GPU extends Backend {
        public GPU() { }
    }
    public static final class NPU extends Backend {
        public NPU(String nativeLibraryDir) { }
    }
}
