// A stub for check:java, which cannot reach Google's Maven.
//
// ML Kit's translation and language-id libraries answer with GMS Tasks rather
// than the ListenableFutures its GenAI libraries use. Only what Vex calls is
// described here: a stub for a method the real library does not have is how 33
// compile errors once reached CI.
package com.google.android.gms.tasks;

public interface Task<TResult> {
    boolean isComplete();
    boolean isSuccessful();
    TResult getResult();
    Exception getException();
}
