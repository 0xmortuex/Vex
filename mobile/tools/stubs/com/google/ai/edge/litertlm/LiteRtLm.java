// Stub of com.google.ai.edge.litertlm (LiteRT-LM's Kotlin API as Java sees it).
//
// Traced from google-ai-edge/litert-lm kotlin/java/com/google/ai/edge/litertlm:
// every class there is annotated @JvmOverloads, so the defaulted parameters
// appear to Java as overloads — which is why Vex's native layer can stay Java
// and skip the Kotlin toolchain entirely. The suspend/Flow variants are the
// ones Java cannot see; they are deliberately absent here.
//
// Checked against: Engine.kt, Config.kt, Conversation.kt, Message.kt.
package com.google.ai.edge.litertlm;

public final class LiteRtLm { private LiteRtLm() { } }
