package com.google.ai.edge.litertlm;

// A data class with one defaulted parameter and no @JvmOverloads: Java gets
// the full constructor only.
public class SamplerConfig {
    public SamplerConfig(int topK, double topP, double temperature, int seed) { }
}
