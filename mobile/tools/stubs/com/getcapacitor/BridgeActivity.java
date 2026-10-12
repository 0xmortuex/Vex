package com.getcapacitor;

import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

public class BridgeActivity extends AppCompatActivity {
    protected Bridge bridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) { }

    public void registerPlugin(Class<? extends Plugin> plugin) { }

    public Bridge getBridge() { return bridge; }
}
