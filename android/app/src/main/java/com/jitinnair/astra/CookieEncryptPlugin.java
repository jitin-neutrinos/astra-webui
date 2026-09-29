package com.jitinnair.astra;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CookieEncrypt")
public class CookieEncryptPlugin extends Plugin {

    private SharedPreferences getEncryptedPrefs() throws Exception {
        Context context = getContext();
        MasterKey masterKey = new MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
        return EncryptedSharedPreferences.create(
                context,
                "secret_cookies",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        long timestamp = System.currentTimeMillis();
        if (key == null || value == null) {
            call.reject("Must provide key and value");
            return;
        }
        try {
            getEncryptedPrefs().edit()
                .putString(key, value)
                .putLong(key + "_time", timestamp)
                .apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Encryption failed", e);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("Must provide key");
            return;
        }
        try {
            String val = getEncryptedPrefs().getString(key, null);
            long time = getEncryptedPrefs().getLong(key + "_time", 0);
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            ret.put("value", val);
            ret.put("time", time);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Decryption failed", e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("Must provide key");
            return;
        }
        try {
            getEncryptedPrefs().edit()
                .remove(key)
                .remove(key + "_time")
                .apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Remove failed", e);
        }
    }

    @PluginMethod
    public void getWebViewCookies(PluginCall call) {
        String url = call.getString("url", "https://astra.jitinnair.com");
        String cookies = CookieManager.getInstance().getCookie(url);
        com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
        ret.put("value", cookies);
        call.resolve(ret);
    }
    
    @PluginMethod
    public void setWebViewCookie(PluginCall call) {
        String url = call.getString("url", "https://astra.jitinnair.com");
        String value = call.getString("value");
        CookieManager.getInstance().setCookie(url, value);
        CookieManager.getInstance().flush();
        call.resolve();
    }
    
    @PluginMethod
    public void clearWebViewCookies(PluginCall call) {
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        call.resolve();
    }
}
