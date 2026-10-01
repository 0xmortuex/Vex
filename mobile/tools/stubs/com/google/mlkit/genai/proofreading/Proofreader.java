package com.google.mlkit.genai.proofreading;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;

// Declares close() but does NOT implement AutoCloseable — checked
// against the real library by a build that failed when this stub said
// otherwise. It cannot be used in try-with-resources.
public interface Proofreader {
    ListenableFuture<Integer> checkFeatureStatus();
    ListenableFuture<Void> downloadFeature(DownloadCallback callback);
    ListenableFuture<ProofreadingResult> runInference(ProofreadingRequest request);
    void close();
}
