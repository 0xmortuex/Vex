package com.google.ai.edge.litertlm;

public class Message {
    public static final Companion Companion = new Companion();
    public static final class Companion {
        public Message user(String text) { return null; }
        public Message model(String text) { return null; }
        public Message system(String text) { return null; }
    }
    @Override public String toString() { return ""; }
}
