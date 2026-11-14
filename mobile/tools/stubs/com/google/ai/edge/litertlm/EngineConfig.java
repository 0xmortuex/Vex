package com.google.ai.edge.litertlm;

public class EngineConfig {
    public EngineConfig(String modelPath) { }
    public EngineConfig(String modelPath, Backend backend) { }
    public EngineConfig(String modelPath, Backend backend, Backend visionBackend) { }
    public EngineConfig(String modelPath, Backend backend, Backend visionBackend, Backend audioBackend) { }
    public EngineConfig(String modelPath, Backend backend, Backend visionBackend, Backend audioBackend,
                        Integer maxNumTokens) { }
    public EngineConfig(String modelPath, Backend backend, Backend visionBackend, Backend audioBackend,
                        Integer maxNumTokens, Integer maxNumImages) { }
    public EngineConfig(String modelPath, Backend backend, Backend visionBackend, Backend audioBackend,
                        Integer maxNumTokens, Integer maxNumImages, String cacheDir) { }
    public String getModelPath() { return ""; }
}
