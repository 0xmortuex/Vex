package com.google.ai.edge.litertlm;

public interface OpenApiTool {
    String getToolDescriptionJsonString();
    String execute(String paramsJsonString);
}
