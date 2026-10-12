# Compile stubs

`npm run check:java` compiles `android/app/src/main/java` against the real
Android framework (Robolectric's `android-all` jar — the actual
`android.webkit` classes, not approximations) plus the small stubs in here for
the two libraries that only live on Google's Maven, which CI runners and this
repo's checks may not be able to reach: **androidx** and **Capacitor**.

The stubs exist to type-check *our* code — wrong arity, wrong types, a missing
import, an unhandled exception. They are not a substitute for a real Gradle
build: if a stub's signature drifts from the library's, the check passes and
Gradle fails. Keep them honest, and keep them minimal — only what the app
actually calls.
