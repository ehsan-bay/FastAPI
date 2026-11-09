package ir.salamatyar.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ServerConfigPlugin.class);
        // Use the server address the user chose in the app, if any (default: the one built into the APK).
        this.config = ServerConfigPlugin.configWithSavedServer(this);
        super.onCreate(savedInstanceState);
    }
}
