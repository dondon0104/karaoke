package com.karaoke.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        initialPlugins.add(NativeFluidSynthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
