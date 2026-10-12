package com.google.ai.edge.litertlm;

import java.util.List;

// @JvmOverloads: Java gets one constructor per trailing default dropped.
public class ConversationConfig {
    public ConversationConfig() { }
    public ConversationConfig(Contents systemInstruction) { }
    public ConversationConfig(Contents systemInstruction, List<Message> initialMessages) { }
    public ConversationConfig(Contents systemInstruction, List<Message> initialMessages, List<ToolProvider> tools) { }
    public ConversationConfig(Contents systemInstruction, List<Message> initialMessages, List<ToolProvider> tools,
                              SamplerConfig samplerConfig) { }
    public ConversationConfig(Contents systemInstruction, List<Message> initialMessages, List<ToolProvider> tools,
                              SamplerConfig samplerConfig, boolean automaticToolCalling) { }
}
