package com.google.mlkit.genai.proofreading;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;

public interface Proofreader extends AutoCloseable {
    ListenableFuture<Integer> checkFeatureStatus();
    ListenableFuture<Void> downloadFeature(DownloadCallback callback);
    ListenableFuture<ProofreadingResult> runInference(ProofreadingRequest request);
    @Override void close();
}
