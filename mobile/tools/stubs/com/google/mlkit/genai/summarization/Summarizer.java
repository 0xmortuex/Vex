package com.google.mlkit.genai.summarization;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.StreamingCallback;

// Declares close() but does NOT implement AutoCloseable — checked
// against the real library by a build that failed when this stub said
// otherwise. It cannot be used in try-with-resources.
public interface Summarizer {
    ListenableFuture<Integer> checkFeatureStatus();
    ListenableFuture<Void> downloadFeature(DownloadCallback callback);
    ListenableFuture<String> getBaseModelName();
    ListenableFuture<SummarizationResult> runInference(SummarizationRequest request);
    ListenableFuture<SummarizationResult> runInference(SummarizationRequest request, StreamingCallback callback);
    void close();
}
