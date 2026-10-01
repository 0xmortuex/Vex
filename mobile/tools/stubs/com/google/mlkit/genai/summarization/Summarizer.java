package com.google.mlkit.genai.summarization;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.StreamingCallback;

public interface Summarizer extends AutoCloseable {
    ListenableFuture<Integer> checkFeatureStatus();
    ListenableFuture<Void> downloadFeature(DownloadCallback callback);
    ListenableFuture<String> getBaseModelName();
    ListenableFuture<SummarizationResult> runInference(SummarizationRequest request);
    ListenableFuture<SummarizationResult> runInference(SummarizationRequest request, StreamingCallback callback);
    @Override void close();
}
