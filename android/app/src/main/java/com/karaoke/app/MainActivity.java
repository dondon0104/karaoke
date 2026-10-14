package com.karaoke.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeFluidSynthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
