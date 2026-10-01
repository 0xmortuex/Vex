// Guava, as much of it as Vex's native layer touches. It arrives transitively
// with the ML Kit GenAI libraries, whose APIs return ListenableFutures.
package com.google.common.util.concurrent;

import java.util.concurrent.Future;

public interface ListenableFuture<V> extends Future<V> {
    void addListener(Runnable listener, java.util.concurrent.Executor executor);
}
