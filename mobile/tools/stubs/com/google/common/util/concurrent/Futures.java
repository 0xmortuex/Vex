package com.google.common.util.concurrent;

import java.util.concurrent.Executor;

public final class Futures {
    private Futures() { }
    public static <V> void addCallback(ListenableFuture<V> future, FutureCallback<? super V> callback,
                                      Executor executor) { }
}
