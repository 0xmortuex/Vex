package com.google.android.gms.tasks;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

// await() blocks, which is why every call to it in Vex is already on a worker
// thread: on the main thread it would deadlock against the Task's own callback.
public final class Tasks {
    private Tasks() { }

    public static <TResult> TResult await(Task<TResult> task)
            throws ExecutionException, InterruptedException {
        throw new UnsupportedOperationException("stub");
    }

    public static <TResult> TResult await(Task<TResult> task, long timeout, TimeUnit unit)
            throws ExecutionException, InterruptedException, TimeoutException {
        throw new UnsupportedOperationException("stub");
    }
}
