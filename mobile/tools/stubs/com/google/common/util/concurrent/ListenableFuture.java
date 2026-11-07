// The ONLY Guava class on this app's classpath.
//
// ML Kit's GenAI libraries return ListenableFutures, but they depend on
// com.google.guava:listenablefuture — a shim artifact containing this interface
// and nothing else. Futures, FutureCallback and the rest of Guava are not there,
// and adding full Guava for two helper methods is three megabytes of dex for
// nothing. NanoRunner.whenDone() does the same job in six lines.
//
// This file exists as a stub for check:java, which cannot reach Google's Maven.
// It deliberately does NOT describe anything else in that package: a stub for a
// class the build does not have is how 33 compile errors reached CI once already.
package com.google.common.util.concurrent;

import java.util.concurrent.Future;

public interface ListenableFuture<V> extends Future<V> {
    void addListener(Runnable listener, java.util.concurrent.Executor executor);
}
