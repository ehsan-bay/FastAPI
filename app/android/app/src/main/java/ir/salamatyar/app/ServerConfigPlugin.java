package ir.salamatyar.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.Field;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Lets the user point the app at another server. The default address is the one built into the APK
 * (server.url in capacitor.config.ts, i.e. VITE_API_URL in app/.env.production). A chosen address is kept
 * on the phone and used the next time the app starts; reset() goes back to the default.
 */
@CapacitorPlugin(name = "ServerConfig")
public class ServerConfigPlugin extends Plugin {
    private static final String PREFS = "salamat_server";
    private static final String KEY = "server_url";

    static String saved(Context c) {
        String v = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        return (v == null || v.isEmpty()) ? null : v;
    }

    static String builtIn(Context c) {
        return CapConfig.loadDefault(c).getServerUrl();
    }

    /** The app config with the saved server address, or null to use the built-in config unchanged. */
    static CapConfig configWithSavedServer(Context c) {
        String url = saved(c);
        if (url == null) return null;
        try {
            CapConfig cfg = CapConfig.loadDefault(c);
            Field f = CapConfig.class.getDeclaredField("serverUrl");
            f.setAccessible(true);
            f.set(cfg, url);
            return cfg;
        } catch (Exception e) {
            return null; // fall back to the built-in address
        }
    }

    private static String clean(String url) {
        if (url == null) return null;
        url = url.trim();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        Uri u = Uri.parse(url);
        String s = u.getScheme();
        if (s == null || !(s.equals("https") || s.equals("http")) || u.getHost() == null || u.getHost().isEmpty()) return null;
        return url;
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        String s = saved(getContext());
        String d = builtIn(getContext());
        r.put("url", s != null ? s : d);
        r.put("defaultUrl", d);
        r.put("custom", s != null);
        call.resolve(r);
    }

    /** set({ url, skipCheck? }): checks <url>/api/health, saves the address and restarts the app on it. */
    @PluginMethod
    public void set(PluginCall call) {
        String url = clean(call.getString("url"));
        if (url == null) {
            call.reject("آدرس معتبر نیست؛ باید با https:// شروع شود");
            return;
        }
        boolean skip = Boolean.TRUE.equals(call.getBoolean("skipCheck", false));
        new Thread(() -> {
            if (!skip && !healthy(url)) {
                call.reject("سرور سلامت‌یار در این آدرس پاسخ نداد");
                return;
            }
            String def = builtIn(getContext());
            SharedPreferences.Editor e = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            if (url.equals(def)) e.remove(KEY); else e.putString(KEY, url);
            e.commit();
            call.resolve();
            restart();
        }).start();
    }

    @PluginMethod
    public void reset(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).commit();
        call.resolve();
        restart();
    }

    private void restart() {
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    private static boolean healthy(String base) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(base + "/api/health").openConnection();
            con.setConnectTimeout(8000);
            con.setReadTimeout(8000);
            int code = con.getResponseCode();
            // 503 = server up but its database is down; still the right server.
            return code == 200 || code == 503;
        } catch (Exception e) {
            return false;
        } finally {
            if (con != null) con.disconnect();
        }
    }
}
